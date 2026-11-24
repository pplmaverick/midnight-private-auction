/**
 * Read-only wallet check — syncs the deploy wallet and reports balances. Sends NO transaction
 * (it never calls registerForDustGeneration, balanceTx, or submitTransaction).
 *
 * Required env vars:
 *   WALLET_SEED        — hex master seed (read from the environment inside this process only)
 *   MIDNIGHT_NETWORK   — "mainnet" or "preview" (default: preview)
 *   MIDNIGHT_PROOF_SERVER (optional) — only used to build the wallet config; no proving happens
 *   CHECK_WALLET_TIMEOUT_SEC (optional, default 300) — overall deadline for the sync
 *   CHECK_WALLET_MAX_SYNC_ERRORS (optional, default 8) — abort after this many Wallet.* errors
 *
 * Mainnet endpoints (Blockfrost) are resolved by src/config.ts from BLOCKFROST_PROJECT_ID in
 * .env.local / the environment; the token is never printed.
 *
 * Output: a progress line every 30 s while syncing, then these lines:
 *   network: <mainnet|preview>
 *   checkpoint_restored: <true|false>
 *   sync: <complete|failed>
 *   night_balance_raw: <integer, smallest unit>
 *   dust_balance_raw: <integer, smallest unit>
 *   dust_coins: <count of spendable DUST coins>
 *
 * The seed, derived keys and addresses are never printed. Error text is passed through a
 * redactor that strips project_id=… query strings and the seed value itself.
 *
 * Side effect (local only): after syncing, buildWallet() refreshes the wallet checkpoints in
 * .wallet-state/v9/ so the next run restores in seconds.
 */

import { inspect } from 'node:util';
import * as Rx from 'rxjs';
import { Cause } from 'effect';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/v9';
import { readFileSync } from 'node:fs';
import { MainnetConfig, PreviewConfig } from '../src/config.js';
import { buildWallet } from '../src/api.js';

const TIMEOUT_MS = Number(process.env.CHECK_WALLET_TIMEOUT_SEC ?? 300) * 1000;
const MAX_SYNC_ERRORS = Number(process.env.CHECK_WALLET_MAX_SYNC_ERRORS ?? 8);
const PROGRESS_EVERY_MS = 30_000;

// ── redaction ────────────────────────────────────────────────────────────────
// Strips: project_id=… ; the query string of ANY http(s)/ws(s) URL ; the Blockfrost token shape ;
// the seed (hex, either case). Applied to every line this script prints, including intercepted
// SDK log output.
const redact = (text: string): string => {
  let out = text;
  const seed = process.env.WALLET_SEED;
  if (seed) out = out.split(seed).join('***').split(seed.toLowerCase()).join('***').split(seed.toUpperCase()).join('***');
  out = out.replace(/\b(https?|wss?):\/\/[^\s"'<>)]*/gi, (url) => url.split('?')[0] + (url.includes('?') ? '?***' : ''));
  out = out.replace(/project_id=[^&\s"')]+/gi, 'project_id=***');
  out = out.replace(/\bnight(mainnet|preprod|preview)[A-Za-z0-9]+/g, 'night$1***');
  out = out.replace(/\b[0-9a-fA-F]{64}\b/g, '<64hex>'); // any 64-hex string (seeds / keys / hashes)
  return out;
};

// Full expansion of an error / Effect Cause / arbitrary object: message, cause chain, status codes.
const describe = (value: unknown): string => {
  try {
    if (Cause.isCause(value)) return Cause.pretty(value);
    if (value instanceof Error || (typeof value === 'object' && value !== null)) {
      return inspect(value, { depth: 6, breakLength: 160, maxStringLength: 600, getters: true, showHidden: false });
    }
  } catch {
    /* fall through */
  }
  return String(value);
};
const clip = (text: string, max = 1500): string => (text.length > max ? `${text.slice(0, max)}…[truncated]` : text);
const safe = (value: unknown): string => clip(redact(describe(value)));

// ── intercept SDK logging (Effect's default logger writes to console) ────────
let syncErrorCount = 0;
let lastSyncError = '';
let onTooManyErrors: (() => void) | undefined;
const origLog = console.log.bind(console);
const origError = console.error.bind(console);
const origWarn = console.warn.bind(console);

const intercept =
  (orig: (...a: unknown[]) => void) =>
  (...args: unknown[]): void => {
    const text = args.map((a) => (typeof a === 'string' ? a : describe(a))).join(' ');
    if (/Wallet\.[A-Za-z]+|ECONN|ENOTFOUND|ETIMEDOUT|WebSocket|Failed to|statusCode|status code|HTTP [45]\d\d/i.test(text)) {
      syncErrorCount += 1;
      lastSyncError = clip(redact(text));
      orig(`[sdk-error #${syncErrorCount}] ${lastSyncError}`);
      if (syncErrorCount >= MAX_SYNC_ERRORS) onTooManyErrors?.();
      return;
    }
    orig(redact(text)); // anything else is passed through redacted
  };

// ── progress line ────────────────────────────────────────────────────────────
interface Prog {
  appliedIndex?: bigint;
  highestIndex?: bigint;
  highestRelevantIndex?: bigint;
  isConnected?: boolean;
}
const fmtProg = (name: string, p: Prog | undefined): string =>
  p
    ? `${name}=${p.appliedIndex ?? '?'}/${p.highestIndex ?? '?'}(rel ${p.highestRelevantIndex ?? '?'}) conn=${p.isConnected ?? '?'}`
    : `${name}=n/a`;

const startProgressReporter = (wallet: WalletFacade, startedAt: number): NodeJS.Timeout => {
  let latest: unknown;
  wallet.state().subscribe({ next: (s) => (latest = s), error: () => undefined });
  return setInterval(() => {
    const s = latest as { shielded?: { progress?: Prog }; unshielded?: { progress?: Prog }; dust?: { progress?: Prog }; isSynced?: boolean } | undefined;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    origLog(
      `[progress ${elapsed}s] synced=${s?.isSynced ?? false} ` +
        [fmtProg('shielded', s?.shielded?.progress), fmtProg('unshielded', s?.unshielded?.progress), fmtProg('dust', s?.dust?.progress)].join(' ') +
        ` sdk_errors=${syncErrorCount}`,
    );
  }, PROGRESS_EVERY_MS);
};

const fail = (reason: string): never => {
  origLog('sync: failed');
  origError(`Error: ${reason}`);
  origError(`Last SDK error (redacted): ${lastSyncError || 'none captured'}`);
  process.exit(2);
};

async function main(): Promise<void> {
  // WALLET_SEED_FILE lets a throwaway seed live in a 600-permission file instead of the shell.
  if (!process.env.WALLET_SEED && process.env.WALLET_SEED_FILE) {
    process.env.WALLET_SEED = readFileSync(process.env.WALLET_SEED_FILE, 'utf-8').trim();
  }
  const seed = process.env.WALLET_SEED;
  if (!seed) {
    console.error('Error: WALLET_SEED (or WALLET_SEED_FILE) is required.');
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    console.error('Error: WALLET_SEED must be a 64-character hex string.');
    process.exit(1);
  }

  const network = process.env.MIDNIGHT_NETWORK ?? 'preview';
  if (network !== 'mainnet' && network !== 'preview') {
    console.error('Error: MIDNIGHT_NETWORK must be "mainnet" or "preview" (preprod endpoints are retired).');
    process.exit(1);
  }
  const config = network === 'mainnet' ? new MainnetConfig() : new PreviewConfig();

  console.log(`network: ${network}`);
  console.log(`limits: timeout=${TIMEOUT_MS / 1000}s max_sdk_errors=${MAX_SYNC_ERRORS}`);
  console.log = intercept(origLog);
  console.error = intercept(origError);
  console.warn = intercept(origWarn);

  const startedAt = Date.now();
  let reporter: NodeJS.Timeout | undefined;
  const deadline = setTimeout(() => fail(`overall timeout of ${TIMEOUT_MS / 1000}s reached before sync completed`), TIMEOUT_MS);
  onTooManyErrors = () => fail(`${syncErrorCount} SDK errors (limit ${MAX_SYNC_ERRORS}) — aborting instead of retrying forever`);

  let ctx;
  try {
    ctx = await buildWallet(config, seed, {
      mode: 'auto',
      quiet: true,
      onWalletStarted: (w) => {
        reporter = startProgressReporter(w, startedAt);
      },
    });
  } catch (err) {
    fail(safe(err));
    return;
  }
  clearTimeout(deadline);
  if (reporter) clearInterval(reporter);

  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const night = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());

  origLog(`checkpoint_restored: ${ctx.restoredFromCheckpoint}`);
  origLog('sync: complete');
  origLog(`night_balance_raw: ${night}`);
  origLog(`dust_balance_raw: ${dust}`);
  origLog(`dust_coins: ${state.dust.availableCoins.length}`);

  await ctx.wallet.stop();
  process.exit(0);
}

main().catch((err) => {
  origError(`Error: ${safe(err)}`);
  process.exit(1);
});

/**
 * Read-only wallet check — syncs the deploy wallet and reports balances. Sends NO transaction
 * (it never calls registerForDustGeneration, balanceTx, or submitTransaction).
 *
 * Required env vars:
 *   WALLET_SEED        — hex master seed (read from the environment inside this process only)
 *   MIDNIGHT_NETWORK   — "mainnet" or "preview" (default: preview)
 *   MIDNIGHT_PROOF_SERVER (optional) — only used to build the wallet config; no proving happens
 *   CHECK_WALLET_TIMEOUT_SEC (optional, default 21600 = 6 h) — overall deadline for the sync
 *   CHECK_WALLET_STALL_SEC (optional, default 600) — abort only if neither the dust nor the
 *       shielded appliedIndex has increased for this long. SDK errors are logged, never fatal:
 *       the SDK retries and resumes from its cursor on its own.
 *   CHECK_WALLET_CHECKPOINT_SEC (optional, default 600, 0 = off) — intermediate snapshots
 *   CHECK_WALLET_SKIP_V8_DUST=1 (optional) — fresh dust start skips the ledger-v8 dust history
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

const TIMEOUT_MS = Number(process.env.CHECK_WALLET_TIMEOUT_SEC ?? 21_600) * 1000;
const STALL_MS = Number(process.env.CHECK_WALLET_STALL_SEC ?? 600) * 1000;
const CHECKPOINT_MS = Number(process.env.CHECK_WALLET_CHECKPOINT_SEC ?? 600) * 1000;
const SKIP_V8_DUST = process.env.CHECK_WALLET_SKIP_V8_DUST === '1';
const PROGRESS_EVERY_MS = 30_000;
const MAX_ERRORS_PRINTED = 40; // full text for the first N SDK errors; the rest are only counted

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
      if (syncErrorCount <= MAX_ERRORS_PRINTED) orig(`[sdk-error #${syncErrorCount}] ${lastSyncError}`);
      return;
    }
    orig(redact(text)); // anything else is passed through redacted
  };

// ── WebSocket close/error diagnostics ───────────────────────────────────────
// Why the SDK prints "[object Object]": WsSubscriptionClient.js (indexer-client, lines 34 and 111)
// wraps a stream failure as `new ServerError({ message: String(err) })`; when `err` is a plain
// close/error event object, String() yields "[object Object]" and the real content is gone before
// the dust Sync.js wrapper (`new SyncWalletError(error)`) or Effect's logger ever see it. So the
// information has to be captured at the socket, which is what this wrapper does: every WebSocket
// the SDK opens reports its close code / reason / error type, with the URL reduced to host+path.
let wsOpened = 0;
let wsClosed = 0;
const installWebSocketDiagnostics = (): void => {
  const Base = (globalThis as { WebSocket?: new (url: string | URL, protocols?: string | string[]) => WebSocket }).WebSocket;
  if (!Base) return;
  class Diagnosed extends Base {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const where = redact(String(url)).replace(/\?\*\*\*$/, '');
      wsOpened += 1;
      this.addEventListener('close', (ev) => {
        wsClosed += 1;
        const e = ev as { code?: number; reason?: string; wasClean?: boolean };
        origLog(`[ws-close] ${where} code=${e.code} clean=${e.wasClean} reason=${redact(String(e.reason ?? '')) || '-'}`);
      });
      this.addEventListener('error', (ev) => {
        const e = ev as { type?: string; message?: unknown; error?: unknown };
        origLog(`[ws-error] ${where} type=${e.type} message=${safe(e.message ?? e.error ?? '-')}`);
      });
    }
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = Diagnosed;
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

interface Snapshot {
  shielded?: { progress?: Prog };
  unshielded?: { progress?: Prog };
  dust?: { progress?: Prog };
  isSynced?: boolean;
}

// Reports every 30 s and calls onStall() once neither dust nor shielded appliedIndex has increased
// for STALL_MS. SDK errors never end the run: the SDK retries and resumes from its cursor.
const startProgressReporter = (wallet: WalletFacade, startedAt: number, onStall: (idleSec: number) => void): NodeJS.Timeout => {
  let latest: Snapshot | undefined;
  wallet.state().subscribe({ next: (s) => (latest = s as unknown as Snapshot), error: () => undefined });
  let bestDust = -1n;
  let bestShielded = -1n;
  let lastAdvance = Date.now();
  return setInterval(() => {
    const dust = latest?.dust?.progress?.appliedIndex;
    const shielded = latest?.shielded?.progress?.appliedIndex;
    if ((dust !== undefined && dust > bestDust) || (shielded !== undefined && shielded > bestShielded)) {
      lastAdvance = Date.now();
      if (dust !== undefined && dust > bestDust) bestDust = dust;
      if (shielded !== undefined && shielded > bestShielded) bestShielded = shielded;
    }
    const idle = Math.round((Date.now() - lastAdvance) / 1000);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    origLog(
      `[progress ${elapsed}s] synced=${latest?.isSynced ?? false} ` +
        [fmtProg('shielded', latest?.shielded?.progress), fmtProg('unshielded', latest?.unshielded?.progress), fmtProg('dust', latest?.dust?.progress)].join(' ') +
        ` idle=${idle}s sdk_errors=${syncErrorCount} ws_open=${wsOpened} ws_closed=${wsClosed} rss=${(process.memoryUsage().rss / 1024 ** 3).toFixed(1)}GB`,
    );
    if (!latest?.isSynced && Date.now() - lastAdvance >= STALL_MS) onStall(idle);
  }, PROGRESS_EVERY_MS);
};

let saveNow: (() => Promise<void>) | undefined;
let failing = false;
const fail = async (reason: string): Promise<never> => {
  if (!failing) {
    failing = true;
    origLog('sync: failed');
    origError(`Error: ${reason}`);
    origError(`Last SDK error (redacted): ${lastSyncError || 'none captured'}`);
    if (saveNow) {
      // best effort, 30 s cap: keep whatever progress was made for the next run
      const saved = await Promise.race([
        saveNow().then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 30_000)),
      ]);
      origLog(`final_checkpoint: ${saved ? 'saved' : 'not saved'}`);
    }
  }
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
  console.log(
    `limits: timeout=${TIMEOUT_MS / 1000}s stall=${STALL_MS / 1000}s checkpoint_every=${CHECKPOINT_MS / 1000}s skip_v8_dust=${SKIP_V8_DUST} (sdk errors are logged, not fatal)`,
  );
  installWebSocketDiagnostics();
  console.log = intercept(origLog);
  console.error = intercept(origError);
  console.warn = intercept(origWarn);

  const startedAt = Date.now();
  let reporter: NodeJS.Timeout | undefined;
  const deadline = setTimeout(() => void fail(`overall timeout of ${TIMEOUT_MS / 1000}s reached before sync completed`), TIMEOUT_MS);

  let ctx;
  try {
    ctx = await buildWallet(config, seed, {
      mode: 'auto',
      quiet: true,
      periodicCheckpointMs: CHECKPOINT_MS,
      skipLedgerV8DustHistory: SKIP_V8_DUST,
      onWalletStarted: (w, controls) => {
        saveNow = controls.saveCheckpoints;
        reporter = startProgressReporter(w, startedAt, (idle) =>
          void fail(`stalled: neither dust nor shielded appliedIndex advanced for ${idle}s`),
        );
      },
    });
  } catch (err) {
    await fail(safe(err));
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

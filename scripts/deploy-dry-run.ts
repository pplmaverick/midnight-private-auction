/**
 * Deploy DRY RUN — restores the wallet from checkpoints, builds and proves the auction deploy
 * transaction, balances it (when DUST is available) and reports the estimated fee. It NEVER
 * submits: the midnight provider handed to deployContract throws on submitTx, and nothing in this
 * file calls wallet.submitTransaction.
 *
 * Deliberately a separate script (not a flag on deploy-only.ts) so a typo can never turn a dry run
 * into a real deploy. It also does NOT call registerForDustGeneration: if the wallet has no DUST it
 * only reports the registration that the real deploy would send first, and its estimated fee.
 *
 * Env:
 *   WALLET_SEED or WALLET_SEED_FILE — master seed (never printed)
 *   MIDNIGHT_NETWORK                — "mainnet" (default) or "preview"
 *   MIDNIGHT_PROOF_SERVER           — default http://127.0.0.1:6300 (must run proof-server 9.0.2)
 *   DRY_RUN_ALLOW_SYNC=1            — allow a full genesis sync if no checkpoint exists
 *                                     (default: fail fast, checkpoints are required)
 *
 * Output (lines): network, dust_balance, deploy_fee_estimate, verdict, plus registration lines.
 */
import { readFileSync } from 'node:fs';
import * as Rx from 'rxjs';
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import * as api from '../src/api.js';
import { MainnetConfig, PreviewConfig } from '../src/config.js';
import { redact as redactText, installConsoleRedaction } from '../src/redact.js';

const redact = (t: string): string => redactText(t).slice(0, 400);
import { createAuctionPrivateState } from '../contract/src/index.js';

const SPECK_PER_DUST = 10n ** 15n;
const fmt = (speck: bigint): string => {
  const whole = speck / SPECK_PER_DUST;
  const frac = (speck % SPECK_PER_DUST).toString().padStart(15, '0').replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac : ''} DUST (${speck} SPECK)`;
};
class DryRunStop extends Error {
  constructor() {
    super('dry-run: submission intentionally blocked');
  }
}

async function main(): Promise<void> {
  if (!process.env.WALLET_SEED && process.env.WALLET_SEED_FILE) {
    process.env.WALLET_SEED = readFileSync(process.env.WALLET_SEED_FILE, 'utf-8').trim();
  }
  const seed = process.env.WALLET_SEED;
  if (!seed || !/^[0-9a-fA-F]{64}$/.test(seed)) {
    console.error('Error: WALLET_SEED (64 hex) or WALLET_SEED_FILE is required.');
    process.exit(1);
  }
  const network = process.env.MIDNIGHT_NETWORK ?? 'mainnet';
  if (network !== 'mainnet' && network !== 'preview') {
    console.error('Error: MIDNIGHT_NETWORK must be "mainnet" or "preview".');
    process.exit(1);
  }
  const config = network === 'mainnet' ? new MainnetConfig() : new PreviewConfig();
  installConsoleRedaction(); // SDK/Effect console output is redacted from here on (seed, tokens, URL queries, 64-hex)
  console.log(`network: ${network}`);

  // Proving needs the ledger-9 proof server; check it is reachable before the slow wallet restore.
  try {
    const r = await fetch(new URL('/version', config.proofServer), { signal: AbortSignal.timeout(5000) });
    console.log(`proof_server: reachable (HTTP ${r.status}) version=${(await r.text()).trim().slice(0, 40)}`);
  } catch (e) {
    console.error(`Error: proof server not reachable (${redact(e instanceof Error ? e.message : String(e))}). Start proof-server 9.0.2 first.`);
    process.exit(1);
  }

  const ctx = await api.buildWallet(config, seed, {
    mode: process.env.DRY_RUN_ALLOW_SYNC === '1' ? 'auto' : 'restore',
    quiet: true,
  });
  console.log(`checkpoint_restored: ${ctx.restoredFromCheckpoint}`);

  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const dust = state.dust.balance(new Date());
  const hasDust = state.dust.availableCoins.length > 0 && dust > 0n;
  console.log(`dust_balance: ${fmt(dust)}`);
  console.log(`dust_coins: ${state.dust.availableCoins.length}`);

  // ── Registration (only reported, never sent) ──────────────────────────────
  let registrationFee = 0n;
  if (!hasDust) {
    const unregistered = state.unshielded.availableCoins.filter((c: any) => c.meta?.registeredForDustGeneration !== true);
    console.log(`registration_needed: yes — the real deploy would FIRST send a "register NIGHT for DUST generation" transaction`);
    console.log(`night_utxos_unregistered: ${unregistered.length}`);
    if (unregistered.length > 0) {
      try {
        const est = await ctx.wallet.estimateRegistration(unregistered);
        registrationFee = est.fee;
        console.log(`registration_fee_estimate: ${fmt(est.fee)}`);
      } catch (e) {
        console.log(`registration_fee_estimate: unavailable (${redact(e instanceof Error ? e.message : String(e))})`);
      }
    } else {
      console.log('registration_fee_estimate: n/a — no NIGHT UTXOs at all (fund the wallet first)');
    }
    console.log('note: DUST accrues over time after registration; the deploy cannot be balanced until it has accrued');
  } else {
    console.log('registration_needed: no (DUST already available)');
  }

  // ── Build + prove + (balance) the deploy tx, but never submit ─────────────
  const base = await api.configureDryRunProviders(ctx, config);
  let deployFee: bigint | undefined;
  let balanced = false;
  let balanceError = '';

  const walletProvider = createLedger9WalletProvider({
    getCoinPublicKey: () => base.walletProvider.getCoinPublicKey(),
    getEncryptionPublicKey: () => base.walletProvider.getEncryptionPublicKey(),
    async balanceTx(tx, ttl) {
      const handle = ctx.wallet.adoptTransaction(tx.serialize(), 'Unbound');
      const ttlDate = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
      try {
        // fee of the tx itself + the fee of the balancing tx
        deployFee = await ctx.wallet.estimateTransactionFee(handle, { ttl: ttlDate });
      } catch (e) {
        balanceError = `estimateTransactionFee failed: ${redact(e instanceof Error ? e.message : String(e))}`;
      }
      if (hasDust) {
        try {
          await ctx.wallet.balanceUnboundTransaction(handle, { ttl: ttlDate });
          balanced = true; // recipe built; deliberately not signed, finalized or submitted
        } catch (e) {
          balanceError = `balance failed: ${redact(e instanceof Error ? e.message : String(e))}`;
        }
      }
      throw new DryRunStop();
    },
  });
  const midnightProvider = createLedger9MidnightProvider(async () => {
    throw new DryRunStop(); // belt and braces: submission is impossible in this script
  });
  const providers = { ...base, walletProvider, midnightProvider };

  try {
    await api.withStatus('Building and proving deploy transaction (dry run)', () =>
      api.deployAuction(providers, createAuctionPrivateState(api.randomBytes32())),
    );
    console.error('UNEXPECTED: deployAuction returned — this must never happen in a dry run');
    process.exit(3);
  } catch (e) {
    const stopped = e instanceof DryRunStop || (e instanceof Error && /dry-run: submission intentionally blocked/.test(`${e.message} ${String((e as { cause?: unknown }).cause)}`));
    if (!stopped) {
      console.log('deploy_tx_build: failed');
      console.error(`Error: ${redact(e instanceof Error ? e.message : String(e))}`);
      await ctx.wallet.stop();
      process.exit(1);
    }
  }

  console.log('deploy_tx_build: ok (proved)');
  console.log(`deploy_fee_estimate: ${deployFee !== undefined ? fmt(deployFee) : `unavailable (${balanceError || 'unknown'})`}`);
  console.log(`deploy_tx_balanced: ${hasDust ? (balanced ? 'yes (not submitted)' : `no (${balanceError || 'unknown'})`) : 'skipped (no DUST)'}`);

  // ── Verdict ───────────────────────────────────────────────────────────────
  if (deployFee === undefined) {
    console.log('verdict: UNKNOWN — fee could not be estimated');
  } else {
    const needed = deployFee + registrationFee;
    if (hasDust && dust >= needed) console.log(`verdict: SUFFICIENT — balance ${fmt(dust)} >= needed ${fmt(needed)}`);
    else if (hasDust) console.log(`verdict: INSUFFICIENT — balance ${fmt(dust)} < needed ${fmt(needed)}`);
    else console.log(`verdict: NOT READY — no DUST; need at least ${fmt(needed)} after registration (registration ${fmt(registrationFee)} + deploy ${fmt(deployFee)})`);
  }
  console.log('submitted: no (dry run)');
  await ctx.wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(`Error: ${redact(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
});

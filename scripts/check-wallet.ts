/**
 * Read-only wallet check — syncs the deploy wallet and reports balances. Sends NO transaction
 * (it never calls registerForDustGeneration, balanceTx, or submitTransaction).
 *
 * Required env vars:
 *   WALLET_SEED        — hex master seed (read from the environment inside this process only)
 *   MIDNIGHT_NETWORK   — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_PROOF_SERVER (optional) — only used to build the wallet config; no proving happens
 *
 * Mainnet endpoints (Blockfrost) are resolved by src/config.ts from BLOCKFROST_PROJECT_ID in
 * .env.local / the environment; the token is never printed.
 *
 * Output is exactly these lines (and nothing else besides the sync spinner):
 *   network: <mainnet|preprod>
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

import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/v9';
import { MainnetConfig, PreprodConfig } from '../src/config.js';
import { buildWallet } from '../src/api.js';

const redact = (text: string, seed: string | undefined): string => {
  let out = text.replace(/project_id=[^&\s"')]+/g, 'project_id=***');
  if (seed) out = out.split(seed).join('***');
  return out.slice(0, 300);
};

async function main(): Promise<void> {
  const seed = process.env.WALLET_SEED;
  if (!seed) {
    console.error('Error: WALLET_SEED is required (set it in the environment for this one command).');
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    console.error('Error: WALLET_SEED must be a 64-character hex string.');
    process.exit(1);
  }

  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  if (network !== 'mainnet' && network !== 'preprod') {
    console.error('Error: MIDNIGHT_NETWORK must be "mainnet" or "preprod".');
    process.exit(1);
  }
  const config = network === 'mainnet' ? new MainnetConfig() : new PreprodConfig();

  console.log(`network: ${network}`);
  let ctx;
  try {
    ctx = await buildWallet(config, seed, { mode: 'auto', quiet: true });
  } catch (err) {
    console.log('sync: failed');
    console.error(`Error: ${redact(err instanceof Error ? err.message : String(err), seed)}`);
    process.exit(1);
  }

  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const night = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());

  console.log(`checkpoint_restored: ${ctx.restoredFromCheckpoint}`);
  console.log('sync: complete');
  console.log(`night_balance_raw: ${night}`);
  console.log(`dust_balance_raw: ${dust}`);
  console.log(`dust_coins: ${state.dust.availableCoins.length}`);

  await ctx.wallet.stop();
  process.exit(0);
}

main().catch((err) => {
  console.error(`Error: ${redact(err instanceof Error ? err.message : String(err), process.env.WALLET_SEED)}`);
  process.exit(1);
});

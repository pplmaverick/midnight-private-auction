/**
 * Deploy-only script — deploys the auction contract and exits.
 *
 * SAFETY (ledger-9 / M6):
 *   - Refuses to run on mainnet unless CONFIRM_MAINNET_DEPLOY=1.
 *   - Wallet is built in 'restore' mode ONLY: no checkpoint => hard failure, never a silent
 *     genesis sync. Run `npm run check-wallet:mainnet` first to create the checkpoints.
 *   - Never sends a DUST-registration transaction implicitly: no DUST => exit with instructions.
 *   - All console output (incl. SDK logging) is redacted; the final result lines are printed through a
 *     strict whitelist (64-hex address / tx hash, integer block height) so they stay readable.
 *
 * Env vars:
 *   WALLET_SEED or WALLET_SEED_FILE — 64-hex seed
 *   MIDNIGHT_NETWORK     — "mainnet" or "preview" (REQUIRED; preprod endpoints are retired)
 *   CONFIRM_MAINNET_DEPLOY=1 — required for mainnet
 *   BLOCKFROST_PROJECT_ID — mainnet endpoints (from .env.local or the shell)
 *   MIDNIGHT_DEPLOY_NODE — optional private node RPC (used only for contractDeploy). Unset => the
 *                          public Blockfrost node RPC from MainnetConfig is used.
 *   MIDNIGHT_PROOF_SERVER — default http://127.0.0.1:6300 (proof-server 9.0.2)
 */

import { readFileSync } from 'node:fs';
import * as Rx from 'rxjs';
import { PreviewConfig, MainnetConfig } from './config.js';
import * as api from './api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import type { AuctionProviders } from './common-types.js';
import { redact, installConsoleRedaction, registerSecret, printResult } from './redact.js';

const DIVIDER = '══════════════════════════════════════════════════════════════';
const SPECK_PER_DUST = 10n ** 15n;
const fmtDust = (speck: bigint): string => {
  const whole = speck / SPECK_PER_DUST;
  const frac = (speck % SPECK_PER_DUST).toString().padStart(15, '0').replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac : ''} DUST (${speck} SPECK)`;
};

async function main() {
  if (!process.env.WALLET_SEED && process.env.WALLET_SEED_FILE) {
    process.env.WALLET_SEED = readFileSync(process.env.WALLET_SEED_FILE, 'utf-8').trim();
  }
  const deployNodeUrl = process.env.MIDNIGHT_DEPLOY_NODE;
  registerSecret(deployNodeUrl);
  installConsoleRedaction();

  const network = process.env.MIDNIGHT_NETWORK;
  if (network !== 'mainnet' && network !== 'preview') {
    console.error('Error: MIDNIGHT_NETWORK must be set to "mainnet" or "preview" (preprod endpoints are retired).');
    process.exit(1);
  }

  // ── Guard 1: explicit confirmation for mainnet ────────────────────────────
  if (network === 'mainnet' && process.env.CONFIRM_MAINNET_DEPLOY !== '1') {
    console.error('Refusing to deploy to mainnet: CONFIRM_MAINNET_DEPLOY=1 is not set.');
    console.error('Nothing was done. Run `npm run deploy:dry-run` first; then re-run with CONFIRM_MAINNET_DEPLOY=1.');
    process.exit(1);
  }

  const seed = process.env.WALLET_SEED;
  if (!seed || !/^[0-9a-fA-F]{64}$/.test(seed)) {
    console.error('Error: WALLET_SEED (64 hex) or WALLET_SEED_FILE is required.');
    process.exit(1);
  }

  const config = network === 'mainnet' ? new MainnetConfig() : new PreviewConfig();

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Auction — Deploy Only (${network})`);
  console.log(DIVIDER);
  console.log(`  RPC for deploy: ${deployNodeUrl ? 'private (MIDNIGHT_DEPLOY_NODE)' : 'public Blockfrost node RPC (default)'}`);

  // ── Guard 2: restore-only wallet (throws if checkpoints are missing; never syncs from genesis) ──
  const walletCtx = await api.buildWalletFromCheckpoints(config, seed);
  console.log(`  checkpoint_restored: ${walletCtx.restoredFromCheckpoint}`);
  const synced = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const dustBalance = synced.dust.balance(new Date());
  if (synced.dust.availableCoins.length === 0 || dustBalance <= 0n) {
    console.error('Error: wallet has no DUST. This script never sends a registration transaction implicitly.');
    console.error('Run `npm run deploy:dry-run` to see the registration step and fee, then register and wait for DUST.');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  console.log(`  dust_balance: ${fmtDust(dustBalance)}`);

  const aucSecretKey = api.randomBytes32();
  const aucPrivState = createAuctionPrivateState(aucSecretKey);

  // Wraps balanceTx: AFTER the deploy tx is proved and BEFORE it is balanced/signed/submitted, print the
  // estimated fee and stop if the balance cannot cover it. (The fee is only known once the tx exists.)
  const withFeeAnnouncement = (providers: AuctionProviders, ctx: api.WalletContext): AuctionProviders => {
    const inner = providers.walletProvider;
    return {
      ...providers,
      walletProvider: {
        ...inner,
        async balanceTx(tx, ttl) {
          const ttlDate = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
          const handle = ctx.wallet.adoptTransaction(tx.serialize(), 'Unbound');
          const fee = await ctx.wallet.estimateTransactionFee(handle, { ttl: ttlDate });
          console.log(`\n  即將部署到 ${network}，估計費用 ${fmtDust(fee)}（目前餘額 ${fmtDust(dustBalance)}）`);
          if (dustBalance < fee) throw new Error('DUST balance is below the estimated fee — aborting before submission.');
          return inner.balanceTx(tx, ttl);
        },
      },
    };
  };

  let contractAddress: string;
  let txId: string;
  let blockHeight: number;

  if (deployNodeUrl) {
    // ── Deploy with private RPC (second, short-lived restored wallet pointed at the private node) ──
    console.log('\n  Private RPC deploy (URL withheld)');
    const deployConfig = { ...config, node: deployNodeUrl };
    const deployWalletCtx = await api.buildWalletFromCheckpoints(deployConfig, seed);
    const deployProviders = withFeeAnnouncement(await api.configureDeployProviders(deployWalletCtx, deployConfig), deployWalletCtx);
    const deployed = await api.withStatus('Deploying auction contract (private RPC)', () =>
      api.deployAuction(deployProviders, aucPrivState),
    );
    contractAddress = deployed.deployTxData.public.contractAddress;
    txId = deployed.deployTxData.public.txId;
    blockHeight = deployed.deployTxData.public.blockHeight;
    await deployWalletCtx.wallet.stop();
    console.log('  ✓ Deploy wallet stopped — back on public RPC');
  } else {
    // ── Deploy with the public Blockfrost RPC (MainnetConfig.node) ────────────
    const mainProviders = withFeeAnnouncement(await api.configureProviders(walletCtx, config), walletCtx);
    const deployed = await api.withStatus('Deploying auction contract', () =>
      api.deployAuction(mainProviders, aucPrivState),
    );
    contractAddress = deployed.deployTxData.public.contractAddress;
    txId = deployed.deployTxData.public.txId;
    blockHeight = deployed.deployTxData.public.blockHeight;
  }

  // Result lines: whitelisted shapes, NOT subject to the 64-hex mask.
  console.log(DIVIDER);
  console.log('  Deploy Complete');
  console.log(DIVIDER);
  printResult('Contract Address', contractAddress, 'hex64', '  ');
  printResult('Deploy Tx Hash  ', txId, 'hex64', '  ');
  printResult('Block Height    ', blockHeight, 'int', '  ');
  console.log(`  Network          : ${network}`);
  console.log(`${DIVIDER}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(redact(err.stack));
  process.exit(1);
});

/**
 * Deploy-only script — deploys the auction contract and exits.
 *
 * Required env vars:
 *   WALLET_SEED         — hex seed
 *   MIDNIGHT_NETWORK    — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_INDEXER    — indexer GraphQL HTTP endpoint
 *   MIDNIGHT_INDEXER_WS — indexer GraphQL WebSocket endpoint
 *   MIDNIGHT_NODE       — public node RPC (for wallet sync)
 *   MIDNIGHT_DEPLOY_NODE — private node RPC (used only for contractDeploy)
 */

import { PreprodConfig, MainnetConfig } from './config.js';
import * as api from './api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import { AUCTIONEER_STATE_ID } from './common-types.js';
import { Buffer } from 'buffer';

const DIVIDER = '══════════════════════════════════════════════════════════════';

async function main() {
  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  const config = network === 'mainnet' ? new MainnetConfig() : new PreprodConfig();

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Auction — Deploy Only (${network})`);
  console.log(DIVIDER);

  const seed = process.env.WALLET_SEED;
  if (!seed) {
    console.error('Error: WALLET_SEED is required.');
    process.exit(1);
  }

  const deployNodeUrl = process.env.MIDNIGHT_DEPLOY_NODE;

  // ── Wallet sync ──────────────────────────────────────────────────────────
  const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);

  const aucSecretKey = api.randomBytes32();
  const aucPrivState = createAuctionPrivateState(aucSecretKey);

  let contractAddress: string;
  let txId: string;
  let blockHeight: number;

  if (deployNodeUrl) {
    // ── Deploy with private RPC ────────────────────────────────────────────
    const maskedUrl = deployNodeUrl.replace(/(\/mk_)[^/]+/, '$1***');
    console.log(`\n  Private RPC deploy: ${maskedUrl}`);
    const deployConfig = { ...config, node: deployNodeUrl };
    const deployWalletCtx = await api.buildWalletFromCheckpoints(deployConfig, seed);
    const deployProviders = await api.configureDeployProviders(deployWalletCtx, deployConfig);
    const deployed = await api.withStatus('Deploying auction contract (private RPC)', () =>
      api.deployAuction(deployProviders, aucPrivState),
    );
    contractAddress = deployed.deployTxData.public.contractAddress;
    txId = deployed.deployTxData.public.txId;
    blockHeight = deployed.deployTxData.public.blockHeight;
    await deployWalletCtx.wallet.stop();
    console.log('  ✓ Deploy wallet stopped — back on public RPC');
  } else {
    // ── Deploy with main (public) RPC ─────────────────────────────────────
    const mainProviders = await api.configureProviders(walletCtx, config);
    const deployed = await api.withStatus('Deploying auction contract', () =>
      api.deployAuction(mainProviders, aucPrivState),
    );
    contractAddress = deployed.deployTxData.public.contractAddress;
    txId = deployed.deployTxData.public.txId;
    blockHeight = deployed.deployTxData.public.blockHeight;
  }

  console.log(DIVIDER);
  console.log('  Deploy Complete');
  console.log(DIVIDER);
  console.log(`  Contract Address : ${contractAddress}`);
  console.log(`  Deploy Tx Hash   : ${txId}`);
  console.log(`  Block Height     : ${blockHeight}`);
  console.log(`  Network          : ${network}`);
  console.log(`${DIVIDER}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

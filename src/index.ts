/**
 * Midnight Private Auction — End-to-End Demo Script
 *
 * Runs a full sealed-bid auction demonstrating Midnight's ZK privacy:
 *   1. Create auction  (auctioneer)
 *   2. Bidder1 places sealed bid  (100 Night)  ← only commitment hash on-chain
 *   3. Bidder2 places sealed bid  (200 Night)  ← higher, but hidden during bidding
 *   4. Close auction              (auctioneer)
 *   5. Bidder1 reveals bid        (100 revealed on-chain)
 *   6. Bidder2 reveals bid        (200 revealed, becomes winner)
 *   7. Bidder2 claims item
 *
 * Environment variables:
 *   WALLET_SEED            — reuse an existing wallet (hex seed); if unset, a fresh
 *                            wallet is generated and the script exits to let you fund it
 *   MIDNIGHT_NETWORK       — "preprod" (default) or "mainnet"
 *   MIDNIGHT_PROOF_SERVER  — override local proof server URL (default: http://127.0.0.1:6300)
 *
 * Mainnet-only (required when MIDNIGHT_NETWORK=mainnet):
 *   MIDNIGHT_INDEXER       — indexer GraphQL HTTP endpoint
 *   MIDNIGHT_INDEXER_WS    — indexer GraphQL WebSocket endpoint
 *   MIDNIGHT_NODE          — node RPC endpoint
 */

import { PreprodConfig, MainnetConfig } from './config.js';
import * as api from './api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import { AUCTIONEER_STATE_ID, BIDDER1_STATE_ID, BIDDER2_STATE_ID } from './common-types.js';
import { Buffer } from 'buffer';

const DIVIDER = '══════════════════════════════════════════════════════════════';

function printStep(n: number, label: string) {
  console.log(`\n${DIVIDER}`);
  console.log(`  Step ${n}: ${label}`);
  console.log(DIVIDER);
}

function printTxHash(label: string, txData: { txId: string; blockHeight: number }) {
  console.log(`  tx hash : ${txData.txId}`);
  console.log(`  block   : ${txData.blockHeight}`);
}

async function main() {
  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  const config = network === 'mainnet' ? new MainnetConfig() : new PreprodConfig();

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Private Auction — Sealed-Bid Demo (${network})`);
  console.log(`${DIVIDER}\n`);

  // ── Wallet ──────────────────────────────────────────────────────────────────
  const seed = process.env.WALLET_SEED;
  let walletCtx: Awaited<ReturnType<typeof api.buildWalletAndWaitForFunds>>;
  if (seed) {
    walletCtx = await api.buildWalletAndWaitForFunds(config, seed);
  } else {
    walletCtx = await api.buildFreshWallet(config);
  }

  console.log('\n  Configuring providers...');
  const providers = await api.configureProviders(walletCtx, config);
  console.log('  ✓ Providers ready\n');

  // ── Generate role-specific private states ────────────────────────────────────
  // Each "bidder" has their own secret key → distinct on-chain public key identity.
  // Bid amounts and salts stay in local private state until the reveal phase.
  const aucSecretKey = api.randomBytes32();
  const bid1SecretKey = api.randomBytes32();
  const bid2SecretKey = api.randomBytes32();
  const bid1Salt = api.randomBytes32();
  const bid2Salt = api.randomBytes32();
  const BID1_AMOUNT = 100n;
  const BID2_AMOUNT = 200n;

  const aucPrivState = createAuctionPrivateState(aucSecretKey, 0n, new Uint8Array(32));
  const bid1PrivState = createAuctionPrivateState(bid1SecretKey, BID1_AMOUNT, bid1Salt);
  const bid2PrivState = createAuctionPrivateState(bid2SecretKey, BID2_AMOUNT, bid2Salt);

  const txHashes: Record<string, string> = {};

  // ── Step 1: Deploy + createAuction ──────────────────────────────────────────
  printStep(1, 'Deploy contract and create auction');
  const deployNodeUrl = process.env.MIDNIGHT_DEPLOY_NODE;
  let contractAddress: string;

  if (deployNodeUrl && seed) {
    // Private RPC for contractDeploy only — all other steps use public RPC.
    const maskedUrl = deployNodeUrl.replace(/(\/mk_)[^/]+/, '$1***');
    console.log(`\n  Private RPC deploy: ${maskedUrl}`);
    const deployConfig = { ...config, node: deployNodeUrl };
    const deployWalletCtx = await api.buildWalletFromCheckpoints(deployConfig, seed);
    const deployProviders = await api.configureDeployProviders(deployWalletCtx, deployConfig);
    const deployed = await api.withStatus('Deploying auction contract (private RPC)', () =>
      api.deployAuction(deployProviders, aucPrivState),
    );
    contractAddress = deployed.deployTxData.public.contractAddress;
    console.log(`  address : ${contractAddress}`);
    await deployWalletCtx.wallet.stop();
    console.log('  ✓ Deploy wallet stopped — back on public RPC');
  } else {
    const deployed = await api.withStatus('Deploying auction contract', () =>
      api.deployAuction(providers, aucPrivState),
    );
    contractAddress = deployed.deployTxData.public.contractAddress;
    console.log(`  address : ${contractAddress}`);
  }

  // createAuction uses main providers (public RPC)
  const aucContractMain = await api.joinAs(providers, contractAddress, AUCTIONEER_STATE_ID, aucPrivState);
  const createTx = await api.withStatus('createAuction("Vintage Watch")', () =>
    api.createAuction(aucContractMain, 'Vintage Watch'),
  );
  txHashes['createAuction'] = createTx.txId;
  printTxHash('createAuction', createTx);

  // ── Step 2: Bidder1 places sealed bid ───────────────────────────────────────
  printStep(2, 'Bidder1 places sealed bid (amount: 100 — hidden on-chain)');
  const bid1Contract = await api.joinAs(providers, contractAddress, BIDDER1_STATE_ID, bid1PrivState);
  const bid1Tx = await api.withStatus('placeBid() as Bidder1', () => api.placeBid(bid1Contract));
  txHashes['placeBid_bidder1'] = bid1Tx.txId;
  printTxHash('placeBid (Bidder1)', bid1Tx);
  console.log(`  On-chain: commitment hash only — amount 100 is NOT visible`);

  // ── Step 3: Bidder2 places sealed bid ───────────────────────────────────────
  printStep(3, 'Bidder2 places sealed bid (amount: 200 — hidden on-chain)');
  const bid2Contract = await api.joinAs(providers, contractAddress, BIDDER2_STATE_ID, bid2PrivState);
  const bid2Tx = await api.withStatus('placeBid() as Bidder2', () => api.placeBid(bid2Contract));
  txHashes['placeBid_bidder2'] = bid2Tx.txId;
  printTxHash('placeBid (Bidder2)', bid2Tx);
  console.log(`  On-chain: commitment hash only — amount 200 is NOT visible`);

  // ── Step 4: Close auction ────────────────────────────────────────────────────
  printStep(4, 'Auctioneer closes bidding phase');
  const aucContract2 = await api.joinAs(providers, contractAddress, AUCTIONEER_STATE_ID, aucPrivState);
  const closeTx = await api.withStatus('closeAuction()', () => api.closeAuction(aucContract2));
  txHashes['closeAuction'] = closeTx.txId;
  printTxHash('closeAuction', closeTx);

  // ── Step 5: Bidder1 reveals ──────────────────────────────────────────────────
  printStep(5, 'Bidder1 reveals bid (100)');
  const reveal1Tx = await api.withStatus('revealBid(100, salt1) as Bidder1', () =>
    api.revealBid(bid1Contract, BID1_AMOUNT, bid1Salt),
  );
  txHashes['revealBid_bidder1'] = reveal1Tx.txId;
  printTxHash('revealBid (Bidder1)', reveal1Tx);
  console.log(`  On-chain: highestBid = 100, highestBidder = Bidder1`);

  // ── Step 6: Bidder2 reveals ──────────────────────────────────────────────────
  printStep(6, 'Bidder2 reveals bid (200) — overtakes Bidder1');
  const reveal2Tx = await api.withStatus('revealBid(200, salt2) as Bidder2', () =>
    api.revealBid(bid2Contract, BID2_AMOUNT, bid2Salt),
  );
  txHashes['revealBid_bidder2'] = reveal2Tx.txId;
  printTxHash('revealBid (Bidder2)', reveal2Tx);
  console.log(`  On-chain: highestBid = 200, highestBidder = Bidder2`);

  // ── Step 7: Bidder2 claims item ──────────────────────────────────────────────
  printStep(7, 'Bidder2 claims item (winner)');
  const claimTx = await api.withStatus('claimItem() as Bidder2', () => api.claimItem(bid2Contract));
  txHashes['claimItem'] = claimTx.txId;
  printTxHash('claimItem (Bidder2)', claimTx);

  // ── Final ledger state ───────────────────────────────────────────────────────
  const finalState = await providers.publicDataProvider
    .queryContractState(contractAddress as any)
    .then((s) => (s != null ? api.getLedgerState(providers, contractAddress as any) : null));

  console.log(`\n${DIVIDER}`);
  console.log('  Auction Complete — Final State');
  console.log(DIVIDER);
  if (finalState) {
    console.log(`  item      : ${finalState.itemName}`);
    console.log(`  phase     : CLOSED`);
    console.log(`  highestBid: ${finalState.highestBid}`);
    console.log(`  bidCount  : ${finalState.bidCount}`);
    console.log(`  claimed   : ${finalState.itemClaimed}`);
  }

  console.log(`\n${DIVIDER}`);
  console.log('  Transaction Hashes');
  console.log(DIVIDER);
  for (const [step, hash] of Object.entries(txHashes)) {
    console.log(`  ${step.padEnd(22)}: ${hash}`);
  }
  console.log(`\n  Contract Address: ${contractAddress}`);
  console.log(`  Network: ${network}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

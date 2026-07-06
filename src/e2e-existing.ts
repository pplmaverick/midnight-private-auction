/**
 * Midnight Private Auction — M2 e2e against an already-deployed contract
 *
 * Joins the existing multi-auction contract via joinAs() (no deploy) and runs
 * the full sealed-bid flow with a single bidder:
 *   1. createAuction
 *   2. placeBid
 *   3. closeAuction
 *   4. revealBid
 *   5. claimItem
 *
 * All operations use the public RPC (MIDNIGHT_NODE). MIDNIGHT_DEPLOY_NODE is
 * never read — this script does not deploy anything.
 *
 * Environment variables:
 *   WALLET_SEED           — hex seed (required)
 *   MIDNIGHT_NETWORK       — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_NODE          — public node RPC (mainnet only)
 *   MIDNIGHT_INDEXER       — indexer GraphQL HTTP endpoint (mainnet only)
 *   MIDNIGHT_INDEXER_WS    — indexer GraphQL WebSocket endpoint (mainnet only)
 *   MIDNIGHT_PROOF_SERVER  — local proof server (default: http://127.0.0.1:6300)
 */

import { PreprodConfig, MainnetConfig } from './config.js';
import * as api from './api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import { AUCTIONEER_STATE_ID, BIDDER1_STATE_ID } from './common-types.js';

const CONTRACT_ADDRESS = '19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80';
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
  console.log(`  Midnight Private Auction — M2 e2e (existing contract, ${network})`);
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`${DIVIDER}\n`);

  const seed = process.env.WALLET_SEED;
  if (!seed) {
    console.error('Error: WALLET_SEED is required.');
    process.exit(1);
  }

  const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);

  console.log('\n  Configuring providers (public RPC only)...');
  const providers = await api.configureProviders(walletCtx, config);
  console.log('  ✓ Providers ready\n');

  const aucSecretKey = api.randomBytes32();
  const bidSecretKey = api.randomBytes32();
  const bidSalt = api.randomBytes32();
  const BID_AMOUNT = 100n;

  const aucPrivState = createAuctionPrivateState(aucSecretKey);

  const txHashes: Record<string, string> = {};

  // ── Step 1: createAuction ───────────────────────────────────────────────────
  printStep(1, 'createAuction — join existing contract as auctioneer');
  const aucContract = await api.joinAs(providers, CONTRACT_ADDRESS, AUCTIONEER_STATE_ID, aucPrivState);
  const createResult = await api.withStatus('createAuction("M2 e2e Item")', () =>
    api.createAuction(
      aucContract,
      'M2 e2e Item',
      'M3 test item',
      0n,
      BigInt(Math.floor(Date.now() / 1000)) + BigInt(86400),
      BigInt(Math.floor(Date.now() / 1000)) + BigInt(86400 + 21600),
    ),
  );
  const auctionId = createResult.auctionId;
  txHashes['createAuction'] = createResult.txData.txId;
  printTxHash('createAuction', createResult.txData);
  console.log(`  auctionId : ${auctionId}`);

  const bidPrivState = createAuctionPrivateState(bidSecretKey, {
    [auctionId.toString()]: { bidAmount: BID_AMOUNT, bidSalt },
  });

  // ── Step 2: placeBid ─────────────────────────────────────────────────────────
  printStep(2, `placeBid (amount: ${BID_AMOUNT} — hidden on-chain)`);
  const bidContract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER1_STATE_ID, bidPrivState);
  const bidTx = await api.withStatus('placeBid()', () => api.placeBid(bidContract, auctionId));
  txHashes['placeBid'] = bidTx.txId;
  printTxHash('placeBid', bidTx);

  // ── Step 3: closeAuction ─────────────────────────────────────────────────────
  printStep(3, 'closeAuction');
  const closeTx = await api.withStatus('closeAuction()', () => api.closeAuction(aucContract, auctionId));
  txHashes['closeAuction'] = closeTx.txId;
  printTxHash('closeAuction', closeTx);

  // ── Step 4: revealBid ────────────────────────────────────────────────────────
  printStep(4, `revealBid (${BID_AMOUNT})`);
  const revealTx = await api.withStatus(`revealBid(${BID_AMOUNT}, salt)`, () =>
    api.revealBid(bidContract, auctionId, BID_AMOUNT, bidSalt),
  );
  txHashes['revealBid'] = revealTx.txId;
  printTxHash('revealBid', revealTx);

  // ── Step 5: claimItem ────────────────────────────────────────────────────────
  printStep(5, 'claimItem');
  const claimTx = await api.withStatus('claimItem()', () => api.claimItem(bidContract, auctionId));
  txHashes['claimItem'] = claimTx.txId;
  printTxHash('claimItem', claimTx);

  // ── Final ledger state ───────────────────────────────────────────────────────
  const finalState = await api.getLedgerState(providers, CONTRACT_ADDRESS as any);

  console.log(`\n${DIVIDER}`);
  console.log('  Auction Complete — Final State');
  console.log(DIVIDER);
  if (finalState) {
    console.log(`  item      : ${finalState.itemName.lookup(auctionId)}`);
    console.log(`  highestBid: ${finalState.highestBid.lookup(auctionId)}`);
    console.log(`  bidCount  : ${finalState.bidCount.lookup(auctionId).read()}`);
    console.log(`  claimed   : ${finalState.itemClaimed.lookup(auctionId)}`);
  }

  console.log(`\n${DIVIDER}`);
  console.log('  Transaction Hashes');
  console.log(DIVIDER);
  for (const [step, hash] of Object.entries(txHashes)) {
    console.log(`  ${step.padEnd(22)}: ${hash}`);
  }
  console.log(`\n  Contract Address: ${CONTRACT_ADDRESS}`);
  console.log(`  Network: ${network}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

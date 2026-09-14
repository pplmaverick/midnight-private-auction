/**
 * Midnight Private Auction — close an auction only, then stop. (one-off test script)
 *
 * Joins the existing multi-auction contract and runs only:
 *   1. closeAuction(auctionId) — as the auctioneer
 * revealBid / claimItem are NOT run — this is meant for auctions where the bid(s) were
 * placed manually from the browser, so there's no logs/pending-reveals/<id>.json to read.
 *
 * The auctioneer's secretKey was never written to disk — this script recovers it via
 * api.joinExisting() instead of generating a new one, since closeAuction only succeeds
 * if the caller's derived public key matches the one recorded at createAuction time.
 * It only works as long as nothing else has since reused the 'auctioneer' slot in the
 * local leveldb.
 *
 * Usage:
 *   AUCTION_ID=4 npm run close-only-test
 *
 * Environment variables:
 *   AUCTION_ID             — auction id to close (required)
 *   WALLET_SEED            — hex seed (required)
 *   MIDNIGHT_NETWORK        — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_NODE           — public node RPC (mainnet only)
 *   MIDNIGHT_INDEXER        — indexer GraphQL HTTP endpoint (mainnet only)
 *   MIDNIGHT_INDEXER_WS     — indexer GraphQL WebSocket endpoint (mainnet only)
 *   MIDNIGHT_PROOF_SERVER   — local proof server (default: http://127.0.0.1:6300)
 */

import { PreprodConfig, MainnetConfig } from '../src/config.js';
import * as api from '../src/api.js';
import { AUCTIONEER_STATE_ID } from '../src/common-types.js';

const CONTRACT_ADDRESS = 'f7a1e5df0e42ff659b1e44bc26075bbd705f91facaad5f7a58209067bf90f8f6';
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

  const auctionIdArg = process.env.AUCTION_ID;
  if (!auctionIdArg) {
    throw new Error('AUCTION_ID is required.');
  }
  const auctionId = BigInt(auctionIdArg);

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Private Auction — close only (${network})`);
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  Auction ID: ${auctionId}`);
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

  const txHashes: Record<string, string> = {};

  // ── Step 1: closeAuction ─────────────────────────────────────────────────────
  printStep(1, `closeAuction(${auctionId}) — as auctioneer`);
  const aucContract = await api.joinExisting(providers, CONTRACT_ADDRESS, AUCTIONEER_STATE_ID);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const newRevealDeadline = BigInt(nowSeconds) + 21600n;
  const closeTx = await api.withStatus('closeAuction()', () => api.closeAuction(aucContract, auctionId, newRevealDeadline));
  txHashes['closeAuction'] = closeTx.txId;
  printTxHash('closeAuction', closeTx);

  console.log(`\n${DIVIDER}`);
  console.log('  Close Complete');
  console.log(DIVIDER);
  console.log(`  newRevealDeadline : ${newRevealDeadline} (${new Date(Number(newRevealDeadline) * 1000).toISOString()})`);

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

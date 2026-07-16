/**
 * Midnight Private Auction — close an auction and reveal our bid, then stop.
 *
 * Companion to scripts/create-and-bid.ts. Joins the existing multi-auction contract
 * and runs:
 *   1. closeAuction(auctionId)  — as the auctioneer
 *   2. revealBid(auctionId)     — as the bidder, using the secret data saved by
 *                                 create-and-bid.ts to logs/pending-reveals/<id>.json
 *
 * The auctioneer's secretKey was never written to disk (only the leveldb-persisted
 * private state provider has it, under the 'auctioneer' slot) — this script recovers
 * it via api.joinExisting() instead of generating a new one, since closeAuction only
 * succeeds if the caller's derived public key matches the one recorded at
 * createAuction time. It only works as long as nothing else has since reused the
 * 'auctioneer' slot in the local leveldb.
 *
 * claimItem is NOT run — that's a separate step once the highest bid is settled.
 *
 * Usage:
 *   AUCTION_ID=4 npm run close-and-reveal:mainnet
 *
 * Environment variables:
 *   AUCTION_ID             — auction id to close + reveal (required)
 *   WALLET_SEED            — hex seed (required)
 *   MIDNIGHT_NETWORK        — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_NODE           — public node RPC (mainnet only)
 *   MIDNIGHT_INDEXER        — indexer GraphQL HTTP endpoint (mainnet only)
 *   MIDNIGHT_INDEXER_WS     — indexer GraphQL WebSocket endpoint (mainnet only)
 *   MIDNIGHT_PROOF_SERVER   — local proof server (default: http://127.0.0.1:6300)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { PreprodConfig, MainnetConfig } from '../src/config.js';
import * as api from '../src/api.js';
import { AUCTIONEER_STATE_ID, BIDDER1_STATE_ID } from '../src/common-types.js';
import { createAuctionPrivateState } from '../contract/src/index.js';

const CONTRACT_ADDRESS = '4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5';
const DIVIDER = '══════════════════════════════════════════════════════════════';

type PendingReveal = {
  network: string;
  contractAddress: string;
  auctionId: string;
  bidAmount: string;
  bidSecretKeyHex: string;
  bidSaltHex: string;
  endTime: string;
  endTimeIso: string;
};

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
    console.error('Error: AUCTION_ID is required.');
    process.exit(1);
  }
  const auctionId = BigInt(auctionIdArg);

  const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
  const pendingPath = path.resolve(currentDir, '..', 'logs', 'pending-reveals', `${auctionIdArg}.json`);
  const pending: PendingReveal = JSON.parse(readFileSync(pendingPath, 'utf8'));

  if (pending.contractAddress !== CONTRACT_ADDRESS) {
    console.error(`Error: pending-reveal contract (${pending.contractAddress}) does not match ${CONTRACT_ADDRESS}`);
    process.exit(1);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds < Number(pending.endTime)) {
    console.error(`Error: endTime (${pending.endTimeIso}) has not passed yet — closeAuction would be rejected.`);
    process.exit(1);
  }

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Private Auction — close + reveal (${network})`);
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
  const closeTx = await api.withStatus('closeAuction()', () => api.closeAuction(aucContract, auctionId));
  txHashes['closeAuction'] = closeTx.txId;
  printTxHash('closeAuction', closeTx);

  // ── Step 2: revealBid ────────────────────────────────────────────────────────
  const bidAmount = BigInt(pending.bidAmount);
  const bidSalt = new Uint8Array(Buffer.from(pending.bidSaltHex, 'hex'));
  const bidSecretKey = new Uint8Array(Buffer.from(pending.bidSecretKeyHex, 'hex'));
  const bidPrivState = createAuctionPrivateState(bidSecretKey, {
    [auctionId.toString()]: { bidAmount, bidSalt },
  });

  printStep(2, `revealBid(${auctionId}, ${bidAmount})`);
  const bidContract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER1_STATE_ID, bidPrivState);
  const revealTx = await api.withStatus(`revealBid(${bidAmount}, salt)`, () =>
    api.revealBid(bidContract, auctionId, bidAmount, bidSalt),
  );
  txHashes['revealBid'] = revealTx.txId;
  printTxHash('revealBid', revealTx);

  // ── Final ledger state ───────────────────────────────────────────────────────
  const finalState = await api.getLedgerState(providers, CONTRACT_ADDRESS as any);

  console.log(`\n${DIVIDER}`);
  console.log('  Close + Reveal Complete');
  console.log(DIVIDER);
  if (finalState) {
    console.log(`  item        : ${finalState.itemName.lookup(auctionId)}`);
    console.log(`  highestBid  : ${finalState.highestBid.lookup(auctionId)}`);
    console.log(`  bidCount    : ${finalState.bidCount.lookup(auctionId).read()}`);
    console.log(`  itemClaimed : ${finalState.itemClaimed.lookup(auctionId)}`);
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

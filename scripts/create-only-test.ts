/**
 * Midnight Private Auction — create one auction only, then stop. (one-off test script)
 *
 * Joins the existing multi-auction contract via joinAs() (no deploy) and runs only:
 *   1. createAuction
 * placeBid / closeAuction / revealBid / claimItem are NOT run — this is meant for manually
 * placing a bid from the browser afterwards.
 *
 * The auctioneer's secretKey is written to logs/pending-reveals/<auctionId>.json (gitignored
 * — logs/ is excluded) in case a later script run needs to reconstruct the auctioneer's
 * private state for this auction.
 *
 * Environment variables:
 *   WALLET_SEED             — hex seed (required)
 *   MIDNIGHT_NETWORK         — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_NODE            — public node RPC (mainnet only)
 *   MIDNIGHT_INDEXER         — indexer GraphQL HTTP endpoint (mainnet only)
 *   MIDNIGHT_INDEXER_WS      — indexer GraphQL WebSocket endpoint (mainnet only)
 *   MIDNIGHT_PROOF_SERVER    — local proof server (default: http://127.0.0.1:6300)
 *   ITEM_NAME                — auction item name (default: "Cardano Midnight Pioneer Badge #001")
 *   BIDDING_DURATION_SECONDS — seconds until endTime (default: 300 — 5 minutes)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toHex } from '@midnight-ntwrk/midnight-js/utils';
import { PreprodConfig, MainnetConfig } from '../src/config.js';
import * as api from '../src/api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import { AUCTIONEER_STATE_ID } from '../src/common-types.js';

const CONTRACT_ADDRESS = '5de1a75b560c1fad56bd4b41eece7ec15f16e8e0734617b46afd0a664a1e4069';
const DIVIDER = '══════════════════════════════════════════════════════════════';

const ITEM_NAME = process.env.ITEM_NAME ?? 'Cardano Midnight Pioneer Badge #001';
const ITEM_DESCRIPTION =
  "A commemorative digital badge representing early participation in Midnight Network's mainnet era. " +
  'Provenance recorded on-chain via zero-knowledge sealed auction — your bid stays private until reveal.';
const STARTING_PRICE = 0n;
const BIDDING_DURATION_SECONDS = BigInt(process.env.BIDDING_DURATION_SECONDS ?? '300'); // default: 5 minutes
const REVEAL_WINDOW_SECONDS = 21600n; // +6 hours after endTime

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
  console.log(`  Midnight Private Auction — create only (${network})`);
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

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const endTime = nowSeconds + BIDDING_DURATION_SECONDS;
  const revealDeadline = endTime + REVEAL_WINDOW_SECONDS;

  const aucPrivState = createAuctionPrivateState(aucSecretKey);

  const txHashes: Record<string, string> = {};

  // ── Step 1: createAuction ───────────────────────────────────────────────────
  printStep(1, `createAuction("${ITEM_NAME}")`);
  const aucContract = await api.joinAs(providers, CONTRACT_ADDRESS, AUCTIONEER_STATE_ID, aucPrivState);
  const createResult = await api.withStatus(`createAuction("${ITEM_NAME}")`, () =>
    api.createAuction(aucContract, ITEM_NAME, ITEM_DESCRIPTION, STARTING_PRICE, endTime, revealDeadline),
  );
  const auctionId = createResult.auctionId;
  txHashes['createAuction'] = createResult.txData.txId;
  printTxHash('createAuction', createResult.txData);
  console.log(`  auctionId      : ${auctionId}`);
  console.log(`  startingPrice  : ${STARTING_PRICE}`);
  console.log(`  endTime        : ${endTime} (${new Date(Number(endTime) * 1000).toISOString()})`);
  console.log(`  revealDeadline : ${revealDeadline} (${new Date(Number(revealDeadline) * 1000).toISOString()})`);

  // ── Persist auctioneer secret for any later script run ──────────────────────
  const pendingReveal = {
    network,
    contractAddress: CONTRACT_ADDRESS,
    auctionId: auctionId.toString(),
    itemName: ITEM_NAME,
    startingPrice: STARTING_PRICE.toString(),
    aucSecretKeyHex: toHex(aucSecretKey),
    endTime: endTime.toString(),
    endTimeIso: new Date(Number(endTime) * 1000).toISOString(),
    revealDeadline: revealDeadline.toString(),
    revealDeadlineIso: new Date(Number(revealDeadline) * 1000).toISOString(),
    txHashes,
  };
  const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
  const outDir = path.resolve(currentDir, '..', 'logs', 'pending-reveals');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${auctionId.toString()}.json`);
  writeFileSync(outPath, JSON.stringify(pendingReveal, null, 2));
  console.log(`\n  Auctioneer secret saved: ${outPath}`);
  console.log('  (gitignored)');

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${DIVIDER}`);
  console.log('  Done — auction created, stopping here');
  console.log(DIVIDER);
  console.log(`  auctionId       : ${auctionId}`);
  console.log(`  createAuction tx: ${txHashes['createAuction']}`);
  console.log(`  endTime         : ${endTime} (${new Date(Number(endTime) * 1000).toISOString()})`);
  console.log(`  revealDeadline  : ${revealDeadline} (${new Date(Number(revealDeadline) * 1000).toISOString()})`);
  console.log(`  Contract Address: ${CONTRACT_ADDRESS}`);
  console.log(`  Network: ${network}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

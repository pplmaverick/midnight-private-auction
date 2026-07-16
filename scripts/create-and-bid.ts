/**
 * Midnight Private Auction — create one auction and place one sealed bid, then stop.
 *
 * Joins the existing multi-auction contract via joinAs() (no deploy) and runs only:
 *   1. createAuction
 *   2. placeBid
 * closeAuction / revealBid / claimItem are NOT run — this is meant to be followed later
 * by a separate reveal + finalize script once endTime has passed.
 *
 * The auctioneer's secretKey and the bidder's secretKey, bidSalt and bidAmount are all
 * written to logs/pending-reveals/<auctionId>.json (gitignored — logs/ is excluded) so a
 * future close/reveal/claim run can reconstruct the exact private state for both roles,
 * even if the shared 'auctioneer' / 'bidder1' private-state-provider slots get
 * overwritten by another run before then.
 *
 * Environment variables:
 *   WALLET_SEED           — hex seed (required)
 *   MIDNIGHT_NETWORK       — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_NODE          — public node RPC (mainnet only)
 *   MIDNIGHT_INDEXER       — indexer GraphQL HTTP endpoint (mainnet only)
 *   MIDNIGHT_INDEXER_WS    — indexer GraphQL WebSocket endpoint (mainnet only)
 *   MIDNIGHT_PROOF_SERVER  — local proof server (default: http://127.0.0.1:6300)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { toHex } from '@midnight-ntwrk/midnight-js/utils';
import { PreprodConfig, MainnetConfig } from '../src/config.js';
import * as api from '../src/api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import { AUCTIONEER_STATE_ID, BIDDER1_STATE_ID } from '../src/common-types.js';

const CONTRACT_ADDRESS = '4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5';
const DIVIDER = '══════════════════════════════════════════════════════════════';

const ITEM_NAME = 'Cardano Midnight Pioneer Badge #001';
const ITEM_DESCRIPTION =
  "A commemorative digital badge representing early participation in Midnight Network's mainnet era. " +
  'Provenance recorded on-chain via zero-knowledge sealed auction — your bid stays private until reveal.';
const STARTING_PRICE = 100n;
const BID_AMOUNT = 200n;
const BIDDING_DURATION_SECONDS = 3600n; // 1 hour
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
  console.log(`  Midnight Private Auction — create + bid only (${network})`);
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

  const bidPrivState = createAuctionPrivateState(bidSecretKey, {
    [auctionId.toString()]: { bidAmount: BID_AMOUNT, bidSalt },
  });

  // ── Step 2: placeBid ─────────────────────────────────────────────────────────
  printStep(2, `placeBid (amount: ${BID_AMOUNT} — hidden on-chain)`);
  const bidContract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER1_STATE_ID, bidPrivState);
  const bidTx = await api.withStatus('placeBid()', () => api.placeBid(bidContract, auctionId));
  txHashes['placeBid'] = bidTx.txId;
  printTxHash('placeBid', bidTx);
  console.log('  On-chain: commitment hash only — bid amount is NOT visible until reveal');

  // ── Persist reveal secrets for the later reveal + finalize run ───────────────
  const pendingReveal = {
    network,
    contractAddress: CONTRACT_ADDRESS,
    auctionId: auctionId.toString(),
    itemName: ITEM_NAME,
    startingPrice: STARTING_PRICE.toString(),
    aucSecretKeyHex: toHex(aucSecretKey),
    bidAmount: BID_AMOUNT.toString(),
    bidSecretKeyHex: toHex(bidSecretKey),
    bidSaltHex: toHex(bidSalt),
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
  console.log(`\n  Reveal secrets saved: ${outPath}`);
  console.log('  (gitignored — needed to reveal this bid after endTime passes)');

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${DIVIDER}`);
  console.log('  Done — auction created, bid placed, stopping here');
  console.log(DIVIDER);
  console.log(`  auctionId       : ${auctionId}`);
  console.log(`  createAuction tx: ${txHashes['createAuction']}`);
  console.log(`  placeBid tx     : ${txHashes['placeBid']}`);
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

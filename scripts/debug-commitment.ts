/**
 * Midnight Private Auction — debug-commitment
 *
 * Diagnostic tool for "Bid commitment verification failed" on revealBid, when the
 * bid was placed through the browser dapp (wallet extension), not this project's
 * CLI scripts. There is no WALLET_SEED / levelPrivateStateProvider store involved —
 * the browser's private state lives in its own IndexedDB, encrypted with a password
 * this script has no access to. All four inputs to the commitment (secretKey,
 * auctionId, bidAmount, bidSalt) are supplied directly as arguments, e.g. printed
 * from the browser console after decrypting via the app's own unlock flow.
 *
 * What it does:
 *   1. Queries the on-chain sealedBids commitment for (auctionId, bidderPK) —
 *      read-only, via indexerPublicDataProvider, no wallet needed.
 *   2. Recomputes the commitment locally via Auction.pureCircuits.computeCommitment
 *      from the secretKey/bidAmount/bidSalt you provide.
 *   3. Prints both hex values side by side, plus a MATCH/MISMATCH verdict.
 *
 * Usage:
 *   AUCTION_ID=7 BIDDER_PK=<hex64> SECRET_KEY_HEX=<hex64> BID_AMOUNT=150 BID_SALT_HEX=<hex64> \
 *     npm run debug-commitment:mainnet
 *
 * Environment variables (all required):
 *   AUCTION_ID       — auction id to check
 *   BIDDER_PK        — bidder's public key, hex, as stored under sealedBids[auctionId]
 *   SECRET_KEY_HEX   — secretKey from the browser's private state, hex
 *   BID_AMOUNT       — bidAmount from the browser's private state, integer
 *   BID_SALT_HEX     — bidSalt from the browser's private state, hex
 *   MIDNIGHT_NETWORK — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_NODE / MIDNIGHT_INDEXER / MIDNIGHT_INDEXER_WS / MIDNIGHT_PROOF_SERVER
 *                    — same as other scripts (mainnet only)
 */

import { Buffer } from 'node:buffer';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js/utils';
import { PreprodConfig, MainnetConfig } from '../src/config.js';
import { Auction } from '../contract/src/index.js';

const CONTRACT_ADDRESS = '4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5';
const DIVIDER = '══════════════════════════════════════════════════════════════';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: ${name} is required.`);
    console.error(
      'Usage: AUCTION_ID=<n> BIDDER_PK=<hex64> SECRET_KEY_HEX=<hex64> BID_AMOUNT=<n> BID_SALT_HEX=<hex64> npm run debug-commitment:mainnet',
    );
    process.exit(1);
  }
  return value;
}

async function main() {
  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  const config = network === 'mainnet' ? new MainnetConfig() : new PreprodConfig();

  const auctionId = BigInt(requireEnv('AUCTION_ID'));
  const bidderPkArg = requireEnv('BIDDER_PK');
  const secretKeyArg = requireEnv('SECRET_KEY_HEX');
  const bidAmount = BigInt(requireEnv('BID_AMOUNT'));
  const bidSaltArg = requireEnv('BID_SALT_HEX');

  const bidderPK = new Uint8Array(Buffer.from(bidderPkArg, 'hex'));
  if (bidderPK.length !== 32) {
    console.error(`Error: BIDDER_PK must be 32 bytes / 64 hex chars — got ${bidderPK.length} bytes.`);
    process.exit(1);
  }
  const secretKey = new Uint8Array(Buffer.from(secretKeyArg, 'hex'));
  if (secretKey.length !== 32) {
    console.error(`Error: SECRET_KEY_HEX must be 32 bytes / 64 hex chars — got ${secretKey.length} bytes.`);
    process.exit(1);
  }
  const bidSalt = new Uint8Array(Buffer.from(bidSaltArg, 'hex'));
  if (bidSalt.length !== 32) {
    console.error(`Error: BID_SALT_HEX must be 32 bytes / 64 hex chars — got ${bidSalt.length} bytes.`);
    process.exit(1);
  }

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Private Auction — debug-commitment (${network})`);
  console.log(`  Contract  : ${CONTRACT_ADDRESS}`);
  console.log(`  Auction ID: ${auctionId}`);
  console.log(`  Bidder PK : ${bidderPkArg}`);
  console.log(`${DIVIDER}\n`);

  // ── Step 1: on-chain commitment (read-only, no wallet needed) ─────────────
  assertIsContractAddress(CONTRACT_ADDRESS);
  const publicDataProvider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  const state = await publicDataProvider.queryContractState(CONTRACT_ADDRESS);
  if (state == null) {
    console.error(`Error: contract ${CONTRACT_ADDRESS} not found on ${network}.`);
    process.exit(1);
  }
  const ledgerState = Auction.ledger(state.data);

  if (!ledgerState.phase.member(auctionId)) {
    console.error(`Error: auction #${auctionId} does not exist on-chain.`);
    process.exit(1);
  }
  const sealedForAuction = ledgerState.sealedBids.lookup(auctionId);
  if (!sealedForAuction.member(bidderPK)) {
    console.error(`Error: no sealedBids entry for this bidderPK in auction #${auctionId} on-chain.`);
    process.exit(1);
  }
  const onChainCommitment = sealedForAuction.lookup(bidderPK);
  const onChainHex = Buffer.from(onChainCommitment).toString('hex');

  console.log(`${DIVIDER}`);
  console.log('  On-chain sealedBids commitment');
  console.log(DIVIDER);
  console.log(`  ${onChainHex}\n`);

  // ── Step 2: local recompute from the values you provided ──────────────────
  const recomputed = Auction.pureCircuits.computeCommitment(secretKey, auctionId, bidAmount, bidSalt);
  const recomputedHex = Buffer.from(recomputed).toString('hex');
  const recomputedPK = Auction.pureCircuits.bidderPublicKey(secretKey);
  const recomputedPKHex = Buffer.from(recomputedPK).toString('hex');

  console.log(`${DIVIDER}`);
  console.log('  Recomputed commitment (from SECRET_KEY_HEX / BID_AMOUNT / BID_SALT_HEX)');
  console.log(DIVIDER);
  console.log(`  secretKey : ${secretKeyArg}`);
  console.log(
    `  derived PK: ${recomputedPKHex}  (${
      recomputedPKHex === bidderPkArg.toLowerCase() ? 'matches BIDDER_PK ✓' : 'DOES NOT MATCH BIDDER_PK ✗'
    })`,
  );
  console.log(`  bidAmount : ${bidAmount}`);
  console.log(`  bidSalt   : ${bidSaltArg}`);
  console.log(`  commitment: ${recomputedHex}\n`);

  // ── Step 3: side-by-side comparison ────────────────────────────────────────
  console.log(`${DIVIDER}`);
  console.log('  Comparison');
  console.log(DIVIDER);
  console.log(`  on-chain  : ${onChainHex}`);
  console.log(`  recomputed: ${recomputedHex}`);
  console.log(
    `  ${
      onChainHex === recomputedHex
        ? '✓ MATCH — commitment is consistent with the values you provided'
        : '✗ MISMATCH — secretKey/bidAmount/bidSalt you provided does not match what was actually committed on-chain'
    }`,
  );
  console.log(`${DIVIDER}\n`);
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

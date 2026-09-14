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
 * Environment variables (all required unless noted):
 *   AUCTION_ID       — auction id to check
 *   BIDDER_PK        — bidder's public key, hex, as stored under sealedBids[auctionId]
 *   SECRET_KEY_HEX   — secretKey from the browser's private state, hex
 *   BID_AMOUNT       — bidAmount from the browser's private state, integer
 *   BID_SALT_HEX     — bidSalt from the browser's private state, hex
 *   MIDNIGHT_NETWORK — "mainnet" or "preprod" (default: preprod)
 *   MIDNIGHT_INDEXER / MIDNIGHT_INDEXER_WS
 *                    — optional overrides (mainnet only). This script only ever calls
 *                      indexerPublicDataProvider — it never touches MIDNIGHT_NODE or a
 *                      proof server, so unlike the other *:mainnet scripts it does NOT
 *                      go through src/config.ts's MainnetConfig (whose constructor would
 *                      otherwise demand MIDNIGHT_NODE for no reason this script needs).
 *                      Defaults match frontend/src/midnight/publicDataProvider.ts's v3
 *                      endpoint (the one the deployed dapp actually uses) — NOT the v1
 *                      URL documented in src/config.ts's MainnetConfig comment, which is
 *                      for the CLI scripts' wallet/RPC path and unrelated to this script.
 *
 * ─── Brute-force mode ───────────────────────────────────────────────────────
 * Set BRUTE_FORCE_TARGET to switch modes entirely: fixes secretKey/auctionId/bidSalt
 * and scans bidAmount over a range, stopping at the first value whose recomputed
 * commitment matches BRUTE_FORCE_TARGET. Purely local (Auction.pureCircuits), no
 * indexer/network call at all — BIDDER_PK and BID_AMOUNT are not read in this mode.
 *
 *   AUCTION_ID=7 SECRET_KEY_HEX=<hex64> BID_SALT_HEX=<hex64> \
 *     BRUTE_FORCE_TARGET=<hex64> [BRUTE_FORCE_MIN=1] [BRUTE_FORCE_MAX=10000] \
 *     npm run debug-commitment
 *
 *   BRUTE_FORCE_TARGET — on-chain commitment hex to match (required to enable this mode)
 *   BRUTE_FORCE_MIN    — lowest bidAmount to try, inclusive (default: 1)
 *   BRUTE_FORCE_MAX    — highest bidAmount to try, inclusive (default: 10000)
 */

import { Buffer } from 'node:buffer';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js/utils';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { PreprodConfig } from '../src/config.js';
import { Auction } from '../contract/src/index.js';

const CONTRACT_ADDRESS = '5de1a75b560c1fad56bd4b41eece7ec15f16e8e0734617b46afd0a664a1e4069';
const DIVIDER = '══════════════════════════════════════════════════════════════';

// v3 endpoint — matches frontend/src/midnight/publicDataProvider.ts's MAINNET_INDEXER /
// MAINNET_INDEXER_WS, i.e. what the deployed dapp itself actually queries. Deliberately
// NOT src/config.ts's documented v1 URL (that's the CLI/wallet path, different host).
const DEFAULT_MAINNET_INDEXER = 'https://indexer.mainnet.midnight.network/api/v3/graphql';
const DEFAULT_MAINNET_INDEXER_WS = 'wss://indexer.mainnet.midnight.network/api/v3/graphql/ws';

// This script only ever calls indexerPublicDataProvider(indexer, indexerWS) — resolve
// just those two values instead of constructing a full Config (MainnetConfig's
// constructor would otherwise require MIDNIGHT_NODE, which nothing here reads).
function resolveIndexerEndpoints(network: string): { indexer: string; indexerWS: string } {
  if (network === 'mainnet') {
    setNetworkId('mainnet');
    return {
      indexer: process.env.MIDNIGHT_INDEXER ?? DEFAULT_MAINNET_INDEXER,
      indexerWS: process.env.MIDNIGHT_INDEXER_WS ?? DEFAULT_MAINNET_INDEXER_WS,
    };
  }
  const preprod = new PreprodConfig(); // hardcoded values, no required env vars, sets networkId
  return { indexer: preprod.indexer, indexerWS: preprod.indexerWS };
}

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

// Fixed secretKey/auctionId/bidSalt, scans bidAmount in [min, max] for the value whose
// commitment matches target. Purely local — no indexer/network call needed.
function runBruteForce(target: string): void {
  const auctionId = BigInt(requireEnv('AUCTION_ID'));
  const secretKeyArg = requireEnv('SECRET_KEY_HEX');
  const bidSaltArg = requireEnv('BID_SALT_HEX');

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
  const targetHex = target.toLowerCase();
  if (Buffer.from(targetHex, 'hex').length !== 32) {
    console.error(`Error: BRUTE_FORCE_TARGET must be 32 bytes / 64 hex chars — got ${Buffer.from(targetHex, 'hex').length} bytes.`);
    process.exit(1);
  }

  const min = BigInt(process.env.BRUTE_FORCE_MIN ?? '1');
  const max = BigInt(process.env.BRUTE_FORCE_MAX ?? '10000');

  console.log(`\n${DIVIDER}`);
  console.log('  Midnight Private Auction — debug-commitment (brute-force mode)');
  console.log(`  Auction ID: ${auctionId}`);
  console.log(`  secretKey : ${secretKeyArg}`);
  console.log(`  bidSalt   : ${bidSaltArg}`);
  console.log(`  target    : ${targetHex}`);
  console.log(`  range     : bidAmount in [${min}, ${max}]`);
  console.log(`${DIVIDER}\n`);

  let found: bigint | null = null;
  for (let amount = min; amount <= max; amount++) {
    const commitment = Auction.pureCircuits.computeCommitment(secretKey, auctionId, amount, bidSalt);
    const hex = Buffer.from(commitment).toString('hex');
    if (hex === targetHex) {
      found = amount;
      break;
    }
  }

  console.log(`${DIVIDER}`);
  if (found !== null) {
    console.log(`  ✓ FOUND — bidAmount = ${found} reproduces the target commitment.`);
  } else {
    console.log(`  ✗ NOT FOUND — no bidAmount in [${min}, ${max}] reproduces the target commitment`);
    console.log('    with this secretKey/auctionId/bidSalt. Either the range is wrong, or one of');
    console.log('    secretKey/auctionId/bidSalt itself (not bidAmount) is what actually diverged.');
  }
  console.log(`${DIVIDER}\n`);
}

async function main() {
  const bruteForceTarget = process.env.BRUTE_FORCE_TARGET;
  if (bruteForceTarget) {
    runBruteForce(bruteForceTarget);
    return;
  }

  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  const { indexer, indexerWS } = resolveIndexerEndpoints(network);

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
  const publicDataProvider = indexerPublicDataProvider(indexer, indexerWS);
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
  const recomputedPK = Auction.pureCircuits.bidderPublicKey(secretKey, auctionId);
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

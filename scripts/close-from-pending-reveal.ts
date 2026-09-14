/**
 * Midnight Private Auction — close an auction using the auctioneer secretKey recovered
 * from logs/pending-reveals/<id>.json, instead of joinExisting()'s local leveldb slot.
 * (one-off test script)
 *
 * Why this exists: create-only-test.ts / close-only-test.ts have a known bug — each
 * create-only-test.ts run writes a fresh random auctioneer secretKey into the shared
 * AUCTIONEER_STATE_ID leveldb slot via joinAs(), unconditionally overwriting whatever
 * was there before. Running it twice (once per test auction) leaves that slot holding
 * only the LAST auction's auctioneer identity — close-only-test.ts's joinExisting()
 * then fails for every earlier auction, because the derived public key no longer
 * matches what's recorded on-chain for them.
 *
 * The fix is NOT applied to those two scripts (they're one-off test scripts, to be
 * deleted after this test run) — this script instead sidesteps the bug by rebuilding
 * the auctioneer's private state directly from the aucSecretKeyHex that
 * create-only-test.ts already saved to logs/pending-reveals/<auctionId>.json at
 * creation time, independent of whatever the leveldb slot currently holds.
 *
 * Usage:
 *   AUCTION_ID=4 npm run close-from-pending-reveal
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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { PreprodConfig, MainnetConfig } from '../src/config.js';
import * as api from '../src/api.js';
import { AUCTIONEER_STATE_ID } from '../src/common-types.js';
import { createAuctionPrivateState } from '../contract/src/index.js';

const CONTRACT_ADDRESS = '5de1a75b560c1fad56bd4b41eece7ec15f16e8e0734617b46afd0a664a1e4069';
const DIVIDER = '══════════════════════════════════════════════════════════════';

type PendingReveal = {
  network: string;
  contractAddress: string;
  auctionId: string;
  aucSecretKeyHex: string;
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
    throw new Error('AUCTION_ID is required.');
  }
  const auctionId = BigInt(auctionIdArg);

  const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
  const pendingPath = path.resolve(currentDir, '..', 'logs', 'pending-reveals', `${auctionIdArg}.json`);
  const pending: PendingReveal = JSON.parse(readFileSync(pendingPath, 'utf8'));

  if (pending.contractAddress !== CONTRACT_ADDRESS) {
    throw new Error(`pending-reveal contract (${pending.contractAddress}) does not match ${CONTRACT_ADDRESS}`);
  }
  if (pending.auctionId !== auctionIdArg) {
    throw new Error(`pending-reveal file auctionId (${pending.auctionId}) does not match AUCTION_ID=${auctionIdArg}`);
  }
  if (!pending.aucSecretKeyHex) {
    throw new Error(`No aucSecretKeyHex in ${pendingPath} — cannot rebuild auctioneer identity.`);
  }

  const aucSecretKey = new Uint8Array(Buffer.from(pending.aucSecretKeyHex, 'hex'));
  const aucPrivState = createAuctionPrivateState(aucSecretKey);

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Private Auction — close from pending-reveal secretKey (${network})`);
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
  // joinAs() here overwrites the shared AUCTIONEER_STATE_ID leveldb slot again —
  // same known bug as create-only-test.ts, deliberately not fixed (see file header).
  printStep(1, `closeAuction(${auctionId}) — as auctioneer (rebuilt from pending-reveal)`);
  const aucContract = await api.joinAs(providers, CONTRACT_ADDRESS, AUCTIONEER_STATE_ID, aucPrivState);
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

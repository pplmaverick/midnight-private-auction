/**
 * Midnight Private Auction — claim the item as the winning bidder, then stop.
 *
 * Companion to scripts/create-and-bid.ts and scripts/close-and-reveal.ts. Rejoins as
 * the bidder using the secret data saved by create-and-bid.ts to
 * logs/pending-reveals/<id>.json and calls claimItem(auctionId). Only succeeds if this
 * bidder's revealed bid is the current highestBid for the auction.
 *
 * Usage:
 *   AUCTION_ID=4 npm run claim-item:mainnet
 *
 * Environment variables:
 *   AUCTION_ID             — auction id to claim (required)
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
import { BIDDER1_STATE_ID } from '../src/common-types.js';
import { createAuctionPrivateState } from '../contract/src/index.js';

const CONTRACT_ADDRESS = '4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5';
const DIVIDER = '══════════════════════════════════════════════════════════════';

type PendingReveal = {
  contractAddress: string;
  bidAmount: string;
  bidSecretKeyHex: string;
  bidSaltHex: string;
};

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

  console.log(`\n${DIVIDER}`);
  console.log(`  Midnight Private Auction — claimItem (${network})`);
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

  const bidAmount = BigInt(pending.bidAmount);
  const bidSalt = new Uint8Array(Buffer.from(pending.bidSaltHex, 'hex'));
  const bidSecretKey = new Uint8Array(Buffer.from(pending.bidSecretKeyHex, 'hex'));
  const bidPrivState = createAuctionPrivateState(bidSecretKey, {
    [auctionId.toString()]: { bidAmount, bidSalt },
  });

  const bidContract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER1_STATE_ID, bidPrivState);
  const claimTx = await api.withStatus('claimItem()', () => api.claimItem(bidContract, auctionId));
  printTxHash('claimItem', claimTx);

  const finalState = await api.getLedgerState(providers, CONTRACT_ADDRESS as any);

  console.log(`\n${DIVIDER}`);
  console.log('  Claim Complete');
  console.log(DIVIDER);
  if (finalState) {
    console.log(`  item        : ${finalState.itemName.lookup(auctionId)}`);
    console.log(`  highestBid  : ${finalState.highestBid.lookup(auctionId)}`);
    console.log(`  itemClaimed : ${finalState.itemClaimed.lookup(auctionId)}`);
  }
  console.log(`\n  claimItem tx: ${claimTx.txId}`);
  console.log(`  block       : ${claimTx.blockHeight}`);
  console.log(`  Network: ${network}\n`);

  await walletCtx.wallet.stop();
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

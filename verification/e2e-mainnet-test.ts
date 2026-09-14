/**
 * Midnight Private Auction — mainnet e2e verification of the 8-item self-audit fix (M4).
 *
 * Fully automated, no manual intervention: runs createAuction -> placeBid -> (wait past
 * endTime) -> reject late bid -> closeAuction -> revealBid -> (reject early claim) ->
 * (wait past revealDeadline) -> claimItem, then a second auction that specifically
 * exercises the revealBid-after-deadline rejection. Every step prints the function
 * called, the expected result, the actual result, and a PASS/FAIL verdict; the script
 * ends with a summary (PASS/FAIL counts + an estimated DUST cost from wallet balance
 * deltas) and exits non-zero if anything failed.
 *
 * This intentionally reuses scripts/create-and-bid.ts's construction pattern
 * (joinAs/createAuction/placeBid) rather than importing that script directly, since
 * that script is a one-shot CLI tool (calls process.exit(0) at the end) not designed
 * to be composed into a longer flow.
 *
 * What this does NOT need manual intervention for: every wait is a plain `sleep` to a
 * wall-clock deadline computed up front (endTime / revealDeadline are fixed the moment
 * each auction is created or closed); every expected-failure step is asserted by
 * matching the thrown error's message, not by reading console output.
 *
 * Environment variables:
 *   WALLET_SEED           — hex seed (required)
 *   MIDNIGHT_NETWORK       — must be "mainnet" for this script to mean anything
 *   MIDNIGHT_NODE          — public node RPC (mainnet only)
 *   MIDNIGHT_INDEXER       — indexer GraphQL HTTP endpoint (mainnet only)
 *   MIDNIGHT_INDEXER_WS    — indexer GraphQL WebSocket endpoint (mainnet only)
 *   MIDNIGHT_PROOF_SERVER  — local proof server (default: http://127.0.0.1:6300) — must
 *                            be reachable (docker start <proof-server-container>) before
 *                            running this script, or every callTx below will fail at the
 *                            proving step instead of exercising the assert logic.
 */

import * as Rx from 'rxjs';
import { PreprodConfig, MainnetConfig } from '../src/config.js';
import * as api from '../src/api.js';
import { createAuctionPrivateState } from '../contract/src/index.js';
import { AUCTIONEER_STATE_ID, BIDDER1_STATE_ID, BIDDER2_STATE_ID } from '../src/common-types.js';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';

const CONTRACT_ADDRESS = '5de1a75b560c1fad56bd4b41eece7ec15f16e8e0734617b46afd0a664a1e4069';
const DIVIDER = '══════════════════════════════════════════════════════════════';

const STARTING_PRICE = 0n;
const BID_AMOUNT = 100n;

// Auction 1 timing: short bidding window, short reveal window — see steps 1-8 below.
const AUCTION1_ENDTIME_OFFSET_SECONDS = 180n; // endTime = now + 3 min
const AUCTION1_REVEAL_WINDOW_SECONDS = 60n; // newRevealDeadline = close-time + 60s

// Auction 2 timing: only exercises the revealBid-after-deadline rejection (step 9), so
// both windows are kept short to minimise total wall-clock run time.
const AUCTION2_ENDTIME_OFFSET_SECONDS = 60n; // endTime = now + 60s
const AUCTION2_REVEAL_WINDOW_SECONDS = 30n; // newRevealDeadline = close-time + 30s

const SLEEP_BUFFER_SECONDS = 10;

type StepResult = {
  step: number;
  fn: string;
  expected: string;
  actual: string;
  pass: boolean;
};

const results: StepResult[] = [];

function record(step: number, fn: string, expected: string, actual: string, pass: boolean): void {
  results.push({ step, fn, expected, actual, pass });
  console.log(`\n${DIVIDER}`);
  console.log(`  Step ${step}: ${fn}`);
  console.log(`  Expected : ${expected}`);
  console.log(`  Actual   : ${actual}`);
  console.log(`  Result   : ${pass ? '✓ PASS' : '✗ FAIL'}`);
  console.log(DIVIDER);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Runs a call expected to SUCCEED. On an unexpected throw, records a FAIL and returns
// null so the caller can decide whether to abort (blocking) or continue (non-blocking).
async function expectSuccess<T>(
  step: number,
  fn: string,
  expected: string,
  run: () => Promise<T>,
  describe: (result: T) => string,
): Promise<T | null> {
  try {
    const result = await run();
    record(step, fn, expected, describe(result), true);
    return result;
  } catch (e) {
    record(step, fn, expected, `threw unexpectedly — ${errorMessage(e)}`, false);
    return null;
  }
}

// Runs a call expected to FAIL with an error message containing `expectedSubstring`.
async function expectFailureContaining(
  step: number,
  fn: string,
  expectedSubstring: string,
  run: () => Promise<unknown>,
): Promise<void> {
  const expected = `throws with message containing "${expectedSubstring}"`;
  try {
    await run();
    record(step, fn, expected, 'succeeded unexpectedly — no error thrown', false);
  } catch (e) {
    const msg = errorMessage(e);
    const pass = msg.includes(expectedSubstring);
    record(step, fn, expected, `threw: "${msg}"`, pass);
  }
}

async function sleepUntil(targetEpochSeconds: bigint, bufferSeconds: number, label: string): Promise<void> {
  const targetMs = Number(targetEpochSeconds) * 1000 + bufferSeconds * 1000;
  const waitMs = targetMs - Date.now();
  if (waitMs > 0) {
    console.log(
      `\n  ⏳ Sleeping ${(waitMs / 1000).toFixed(0)}s until ${label} + ${bufferSeconds}s buffer (${new Date(targetMs).toISOString()})...`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } else {
    console.log(`\n  (${label} + ${bufferSeconds}s buffer already passed — no sleep needed)`);
  }
}

async function snapshotDustBalance(wallet: WalletFacade): Promise<bigint> {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return state.dust.balance(new Date());
}

async function main() {
  const network = process.env.MIDNIGHT_NETWORK ?? 'preprod';
  if (network !== 'mainnet') {
    console.error('Error: this script verifies the mainnet deployment — set MIDNIGHT_NETWORK=mainnet.');
    process.exit(1);
  }
  const config = network === 'mainnet' ? new MainnetConfig() : new PreprodConfig();

  const seed = process.env.WALLET_SEED;
  if (!seed) {
    console.error('Error: WALLET_SEED is required.');
    process.exit(1);
  }

  console.log(`\n${DIVIDER}`);
  console.log('  Midnight Private Auction — M4 mainnet e2e verification (8-item fix)');
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`${DIVIDER}\n`);

  const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);
  console.log('\n  Configuring providers (public RPC only)...');
  const providers = await api.configureProviders(walletCtx, config);
  console.log('  ✓ Providers ready\n');

  const dustBefore = await snapshotDustBalance(walletCtx.wallet);

  // ═══════════════════════════════════════════════════════════════════════
  // Auction 1 — full happy path + the four fixes gated by reveal-window/
  // endTime enforcement (fixes #3, #5, #6 from the 8-item set).
  // ═══════════════════════════════════════════════════════════════════════

  const aucSecretKey = api.randomBytes32();
  const bidder1SecretKey = api.randomBytes32();
  const bidder1Salt = api.randomBytes32();

  const now1 = BigInt(Math.floor(Date.now() / 1000));
  const auction1EndTime = now1 + AUCTION1_ENDTIME_OFFSET_SECONDS;
  // createAuction requires revealDeadline > endTime (fix #2) — any value works here
  // since closeAuction (step 4) overwrites revealDeadline unconditionally on success.
  const auction1InitialRevealDeadline = auction1EndTime + 1n;

  const aucPrivState = createAuctionPrivateState(aucSecretKey);
  const aucContract1 = await api.joinAs(providers, CONTRACT_ADDRESS, AUCTIONEER_STATE_ID, aucPrivState);

  // Step 1: createAuction
  const create1 = await expectSuccess(
    1,
    `createAuction(endTime=now+${AUCTION1_ENDTIME_OFFSET_SECONDS}s)`,
    'succeeds, returns a new auctionId',
    () => api.createAuction(aucContract1, 'E2E Test Item #1', 'M4 e2e verification', STARTING_PRICE, auction1EndTime, auction1InitialRevealDeadline),
    (r) => `succeeded — auctionId=${r.auctionId}, tx=${r.txData.txId}`,
  );
  if (!create1) {
    await printFinalSummary(dustBefore, walletCtx.wallet);
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  const auction1Id = create1.auctionId;

  const bidder1PrivState = createAuctionPrivateState(bidder1SecretKey, {
    [auction1Id.toString()]: { bidAmount: BID_AMOUNT, bidSalt: bidder1Salt },
  });
  const bidder1Contract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER1_STATE_ID, bidder1PrivState);

  // Step 2: placeBid (bidder 1, immediately)
  const bid1 = await expectSuccess(
    2,
    `placeBid(auctionId=${auction1Id}, amount=${BID_AMOUNT}) as bidder1`,
    'succeeds',
    () => api.placeBid(bidder1Contract, auction1Id),
    (r) => `succeeded — tx=${r.txId}`,
  );
  if (!bid1) {
    await printFinalSummary(dustBefore, walletCtx.wallet);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // Step 3: after endTime, a second bidder's placeBid must be rejected (fix #3).
  await sleepUntil(auction1EndTime, SLEEP_BUFFER_SECONDS, 'auction1 endTime');
  const bidder2SecretKey = api.randomBytes32();
  const bidder2Salt = api.randomBytes32();
  const bidder2PrivState = createAuctionPrivateState(bidder2SecretKey, {
    [auction1Id.toString()]: { bidAmount: BID_AMOUNT, bidSalt: bidder2Salt },
  });
  const bidder2Contract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER2_STATE_ID, bidder2PrivState);
  await expectFailureContaining(
    3,
    `placeBid(auctionId=${auction1Id}) as bidder2, after endTime`,
    'Bidding period has ended',
    () => api.placeBid(bidder2Contract, auction1Id),
  );

  // Step 4: closeAuction with a short reveal window (fix #4's new signature).
  const closeNow = BigInt(Math.floor(Date.now() / 1000));
  const auction1RevealDeadline = closeNow + AUCTION1_REVEAL_WINDOW_SECONDS;
  const close1 = await expectSuccess(
    4,
    `closeAuction(auctionId=${auction1Id}, newRevealDeadline=now+${AUCTION1_REVEAL_WINDOW_SECONDS}s)`,
    'succeeds, sets revealDeadline',
    () => api.closeAuction(aucContract1, auction1Id, auction1RevealDeadline),
    (r) => `succeeded — tx=${r.txId}`,
  );
  if (!close1) {
    await printFinalSummary(dustBefore, walletCtx.wallet);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // Step 5: revealBid, immediately (well inside the reveal window).
  await expectSuccess(
    5,
    `revealBid(auctionId=${auction1Id}, amount=${BID_AMOUNT}) as bidder1, inside reveal window`,
    'succeeds',
    () => api.revealBid(bidder1Contract, auction1Id, BID_AMOUNT, bidder1Salt),
    (r) => `succeeded — tx=${r.txId}`,
  );

  // Step 6: claimItem, immediately — reveal window is still open (fix #6).
  await expectFailureContaining(
    6,
    `claimItem(auctionId=${auction1Id}) as bidder1, immediately after revealBid`,
    'Reveal window still open',
    () => api.claimItem(bidder1Contract, auction1Id),
  );

  // Step 7: wait past the reveal deadline.
  await sleepUntil(auction1RevealDeadline, SLEEP_BUFFER_SECONDS, 'auction1 revealDeadline');

  // Step 8: claimItem again — should now succeed.
  await expectSuccess(
    8,
    `claimItem(auctionId=${auction1Id}) as bidder1, after revealDeadline`,
    'succeeds',
    () => api.claimItem(bidder1Contract, auction1Id),
    (r) => `succeeded — tx=${r.txId}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Auction 2 — isolates the revealBid-after-deadline rejection (fix #5),
  // independent of auction 1's state.
  // ═══════════════════════════════════════════════════════════════════════

  const bidder3SecretKey = api.randomBytes32();
  const bidder3Salt = api.randomBytes32();

  const now2 = BigInt(Math.floor(Date.now() / 1000));
  const auction2EndTime = now2 + AUCTION2_ENDTIME_OFFSET_SECONDS;
  const auction2InitialRevealDeadline = auction2EndTime + 1n;

  const create2 = await expectSuccess(
    9,
    `createAuction(endTime=now+${AUCTION2_ENDTIME_OFFSET_SECONDS}s) — auction 2`,
    'succeeds, returns a new auctionId',
    () => api.createAuction(aucContract1, 'E2E Test Item #2', 'M4 e2e verification — reveal deadline', STARTING_PRICE, auction2EndTime, auction2InitialRevealDeadline),
    (r) => `succeeded — auctionId=${r.auctionId}, tx=${r.txData.txId}`,
  );
  if (!create2) {
    await printFinalSummary(dustBefore, walletCtx.wallet);
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  const auction2Id = create2.auctionId;

  const bidder3PrivState = createAuctionPrivateState(bidder3SecretKey, {
    [auction2Id.toString()]: { bidAmount: BID_AMOUNT, bidSalt: bidder3Salt },
  });
  const bidder3Contract = await api.joinAs(providers, CONTRACT_ADDRESS, BIDDER1_STATE_ID, bidder3PrivState);

  const bid2 = await expectSuccess(
    9,
    `placeBid(auctionId=${auction2Id}) as bidder3 — auction 2`,
    'succeeds',
    () => api.placeBid(bidder3Contract, auction2Id),
    (r) => `succeeded — tx=${r.txId}`,
  );
  if (!bid2) {
    await printFinalSummary(dustBefore, walletCtx.wallet);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  await sleepUntil(auction2EndTime, SLEEP_BUFFER_SECONDS, 'auction2 endTime');

  const auction2CloseNow = BigInt(Math.floor(Date.now() / 1000));
  const auction2RevealDeadline = auction2CloseNow + AUCTION2_REVEAL_WINDOW_SECONDS;
  const close2 = await expectSuccess(
    9,
    `closeAuction(auctionId=${auction2Id}, newRevealDeadline=now+${AUCTION2_REVEAL_WINDOW_SECONDS}s) — auction 2`,
    'succeeds',
    () => api.closeAuction(aucContract1, auction2Id, auction2RevealDeadline),
    (r) => `succeeded — tx=${r.txId}`,
  );
  if (!close2) {
    await printFinalSummary(dustBefore, walletCtx.wallet);
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  await sleepUntil(auction2RevealDeadline, SLEEP_BUFFER_SECONDS, 'auction2 revealDeadline');

  await expectFailureContaining(
    9,
    `revealBid(auctionId=${auction2Id}) as bidder3, after revealDeadline`,
    'Reveal deadline has passed',
    () => api.revealBid(bidder3Contract, auction2Id, BID_AMOUNT, bidder3Salt),
  );

  const exitCode = await printFinalSummary(dustBefore, walletCtx.wallet);
  await walletCtx.wallet.stop();
  process.exit(exitCode);
}

// Prints the PASS/FAIL summary and an estimated DUST cost from the wallet's balance
// delta (successful calls only reach proving/submission — a rejected assert throws
// during local circuit execution before any transaction is built, so it costs ~0 DUST;
// the delta below is the real, empirical cost of every call that actually succeeded).
// Returns the process exit code (0 if every step passed, 1 otherwise).
async function printFinalSummary(dustBefore: bigint, wallet: WalletFacade): Promise<number> {
  const dustAfter = await snapshotDustBalance(wallet);
  const dustSpent = dustBefore - dustAfter;
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  const successfulCalls = results.filter((r) => r.expected.startsWith('succeeds')).length;
  const rejectedCalls = results.length - successfulCalls;

  console.log(`\n${DIVIDER}`);
  console.log('  FINAL SUMMARY');
  console.log(DIVIDER);
  for (const r of results) {
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] Step ${r.step}: ${r.fn}`);
  }
  console.log(DIVIDER);
  console.log(`  Total steps      : ${results.length}`);
  console.log(`  PASS             : ${passCount}`);
  console.log(`  FAIL             : ${failCount}`);
  console.log(`  On-chain calls   : ${successfulCalls} succeeded, ${rejectedCalls} rejected (rejected calls fail during`);
  console.log('                     local circuit execution, before proving/submission — ~0 DUST each)');
  console.log(`  DUST before      : ${dustBefore}`);
  console.log(`  DUST after       : ${dustAfter}`);
  console.log(`  DUST spent (est.): ${dustSpent} across ${successfulCalls} on-chain transactions`);
  console.log(DIVIDER);
  console.log(failCount === 0 ? '  ✓ ALL STEPS PASSED' : `  ✗ ${failCount} STEP(S) FAILED`);
  console.log(`${DIVIDER}\n`);

  return failCount === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('\n  Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});

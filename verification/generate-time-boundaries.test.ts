// Independent Reference Model Testing — numeric/time boundary data generator.
//
// Unlike the hash-relation data (see generate-relations.test.ts), the logic gated
// here is pure integer comparison (revealDeadline > endTime, blockTimeLt/blockTimeGte
// against a ledger-stored deadline). That is fully and independently reproducible in
// Python from the spec (see reference_model.py), so this generator's job is only to
// record what the REAL compiled contract actually does at and around each boundary,
// for row-by-row comparison against the Python model's predictions.
//
// Run via vitest for the same reason as generate-relations.test.ts: constructing
// AuctionSimulator crashes this repo's `ts-node/esm` script runner in this
// environment, but runs cleanly under vitest.
import { describe, it, expect } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { writeFileSync, mkdirSync } from 'node:fs';
import { AuctionSimulator } from '../src/test/auction-simulator.js';
import { randomBytes } from '../src/test/utils.js';

setNetworkId('undeployed');

// Deltas applied around each boundary value, chosen to hit: far below, one below,
// exactly on, one above, far above.
const DELTAS = [-1_000_000n, -2n, -1n, 0n, 1n, 2n, 1_000_000n];

// Keeps `base + min(DELTAS)` comfortably >= 0 for any base drawn below, so a negative
// delta never produces a negative (invalid Uint<64>) timestamp.
const randomBase = (): bigint => 2_000_000n + BigInt(Math.floor(Math.random() * 1_000_000_000));

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type CaseRow = Record<string, unknown>;

describe('Independent Reference Model Testing — numeric/time boundary data generation', () => {
  it('generates createAuction (revealDeadline > endTime) boundary outcomes from the real compiled contract', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const N_BASES = 100;
    const rows: CaseRow[] = [];

    for (let i = 0; i < N_BASES; i++) {
      const endTime = randomBase();
      for (const delta of DELTAS) {
        const revealDeadline = endTime + delta;
        let actualPass = true;
        let actualError: string | null = null;
        try {
          sim.createAuction('Item', 'Desc', 100n, endTime, revealDeadline);
        } catch (e) {
          actualPass = false;
          actualError = errorMessage(e);
        }
        rows.push({ kind: 'createAuction', endTime: endTime.toString(), revealDeadline: revealDeadline.toString(), delta: delta.toString(), actualPass, actualError });
      }
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync('verification/data/time_createAuction.json', JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(N_BASES * DELTAS.length);
  }, 180_000);

  it('generates placeBid (now < endTime) boundary outcomes from the real compiled contract', () => {
    const auctioneerKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const N_BASES = 100;
    const rows: CaseRow[] = [];

    for (let i = 0; i < N_BASES; i++) {
      const endTime = randomBase();
      const revealDeadline = endTime + 10_000_000n; // structurally valid, irrelevant to this check
      const auctionId = sim.createAuction('Item', 'Desc', 100n, endTime, revealDeadline);
      for (const delta of DELTAS) {
        // Fresh bidderKey per delta: placeBid rejects a second bid from the same
        // bidderPK on the same auction, which would otherwise mask the endTime
        // check after the first delta that succeeds.
        const now = endTime + delta;
        sim.switchUser(randomBytes(32));
        sim.setBlockTime(now);
        let actualPass = true;
        let actualError: string | null = null;
        try {
          sim.placeBid(auctionId, 150n, randomBytes(32));
        } catch (e) {
          actualPass = false;
          actualError = errorMessage(e);
        }
        rows.push({ kind: 'placeBid', endTime: endTime.toString(), now: now.toString(), delta: delta.toString(), actualPass, actualError });
      }
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync('verification/data/time_placeBid.json', JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(N_BASES * DELTAS.length);
  }, 180_000);

  it('generates closeAuction (now < newRevealDeadline) boundary outcomes from the real compiled contract', () => {
    const auctioneerKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const N_BASES = 30;
    const rows: CaseRow[] = [];

    for (let i = 0; i < N_BASES; i++) {
      const base = randomBase();
      for (const delta of DELTAS) {
        // Fresh auction per delta (each closeAuction call needs BIDDING phase).
        // endTime/revealDeadline given to createAuction are irrelevant to closeAuction's
        // own time check (it overwrites revealDeadline unconditionally on success).
        const auctionId = sim.createAuction('Item', 'Desc', 100n, base + 20_000_000n, base + 30_000_000n);
        const newRevealDeadline = base + delta;
        sim.setBlockTime(base); // "now" at the moment closeAuction is called
        let actualPass = true;
        let actualError: string | null = null;
        try {
          sim.closeAuction(auctionId, newRevealDeadline);
        } catch (e) {
          actualPass = false;
          actualError = errorMessage(e);
        }
        rows.push({ kind: 'closeAuction', now: base.toString(), newRevealDeadline: newRevealDeadline.toString(), delta: delta.toString(), actualPass, actualError });
      }
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync('verification/data/time_closeAuction.json', JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(N_BASES * DELTAS.length);
  }, 180_000);

  it('generates revealBid (now < revealDeadline) boundary outcomes from the real compiled contract', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const N_BASES = 15;
    const rows: CaseRow[] = [];

    for (let i = 0; i < N_BASES; i++) {
      const base = randomBase(); // this becomes the reveal deadline set at close time
      for (const delta of DELTAS) {
        const salt = randomBytes(32);
        sim.switchUser(auctioneerKey);
        const auctionId = sim.createAuction('Item', 'Desc', 100n, base + 50_000_000n, base + 60_000_000n);

        sim.switchUser(bidderKey);
        sim.setBlockTime(0n); // well before endTime, so placeBid itself always succeeds here
        sim.placeBid(auctionId, 150n, salt);

        sim.switchUser(auctioneerKey);
        sim.setBlockTime(0n); // well before `base`, so closeAuction's own check always passes here
        sim.closeAuction(auctionId, base);

        const now = base + delta;
        sim.switchUser(bidderKey);
        sim.setBlockTime(now);
        let actualPass = true;
        let actualError: string | null = null;
        try {
          sim.revealBid(auctionId, 150n, salt);
        } catch (e) {
          actualPass = false;
          actualError = errorMessage(e);
        }
        rows.push({ kind: 'revealBid', revealDeadline: base.toString(), now: now.toString(), delta: delta.toString(), actualPass, actualError });
      }
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync('verification/data/time_revealBid.json', JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(N_BASES * DELTAS.length);
  }, 180_000);

  it('generates claimItem (now >= revealDeadline) boundary outcomes from the real compiled contract', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const N_BASES = 15;
    const rows: CaseRow[] = [];

    for (let i = 0; i < N_BASES; i++) {
      const base = randomBase(); // this becomes the reveal deadline set at close time
      for (const delta of DELTAS) {
        const salt = randomBytes(32);
        sim.switchUser(auctioneerKey);
        const auctionId = sim.createAuction('Item', 'Desc', 100n, base + 50_000_000n, base + 60_000_000n);

        sim.switchUser(bidderKey);
        sim.setBlockTime(0n);
        sim.placeBid(auctionId, 150n, salt);

        sim.switchUser(auctioneerKey);
        sim.setBlockTime(0n);
        sim.closeAuction(auctionId, base);

        sim.switchUser(bidderKey);
        sim.setBlockTime(0n); // well before `base`, so revealBid's own deadline check always passes here
        sim.revealBid(auctionId, 150n, salt);

        const now = base + delta;
        sim.setBlockTime(now);
        let actualPass = true;
        let actualError: string | null = null;
        try {
          sim.claimItem(auctionId);
        } catch (e) {
          actualPass = false;
          actualError = errorMessage(e);
        }
        rows.push({ kind: 'claimItem', revealDeadline: base.toString(), now: now.toString(), delta: delta.toString(), actualPass, actualError });
      }
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync('verification/data/time_claimItem.json', JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(N_BASES * DELTAS.length);
  }, 180_000);

  it('generates finalizeAuction (now >= revealDeadline) boundary outcomes from the real compiled contract', () => {
    const auctioneerKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const N_BASES = 20;
    const rows: CaseRow[] = [];

    for (let i = 0; i < N_BASES; i++) {
      const base = randomBase(); // this becomes the reveal deadline set at close time
      for (const delta of DELTAS) {
        // No bid needed: the blockTimeGte(revealDeadline) assert in finalizeAuction
        // fires unconditionally right after the phase check, before the
        // highestBid==0 branch, so a bid-free auction exercises the same gate.
        const auctionId = sim.createAuction('Item', 'Desc', 100n, base + 50_000_000n, base + 60_000_000n);

        sim.setBlockTime(0n); // well before `base`, so closeAuction's own check always passes here
        sim.closeAuction(auctionId, base);

        const now = base + delta;
        sim.setBlockTime(now);
        let actualPass = true;
        let actualError: string | null = null;
        try {
          sim.finalizeAuction(auctionId);
        } catch (e) {
          actualPass = false;
          actualError = errorMessage(e);
        }
        rows.push({ kind: 'finalizeAuction', revealDeadline: base.toString(), now: now.toString(), delta: delta.toString(), actualPass, actualError });
      }
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync('verification/data/time_finalizeAuction.json', JSON.stringify(rows, null, 2));
    expect(rows).toHaveLength(N_BASES * DELTAS.length);
  }, 180_000);
});

import { describe, it, expect } from 'vitest';
import { AuctionSimulator } from './auction-simulator.js';
import { randomBytes } from './utils.js';
import { AuctionPhase } from '../../contract/src/managed/auction/contract/index.js';

// Exercises all six impure circuits end-to-end on the ledger-9 build (compact-runtime 0.21).
// finalizeAuction only mutates state when no bid was revealed (highestBid == 0), which is
// mutually exclusive with claimItem (needs highestBid > 0) — so the flow uses two auctions:
//   A (has a winning bid): createAuction -> placeBid -> closeAuction -> revealBid -> claimItem
//   B (no bids):           createAuction -> closeAuction -> finalizeAuction
describe('full flow (ledger 9 toolchain, compact-runtime 0.21)', () => {
  it('runs every circuit: create, bid, close, reveal, claim, finalize', async () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const sim = await AuctionSimulator.create(auctioneerKey);

    // --- createAuction (x2)
    const a = await sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    const b = await sim.createAuction('Scroll', 'Unbid scroll', 100n, 1000n, 2000n);
    expect([a, b]).toEqual([0n, 1n]);
    expect(sim.getLedger().phase.lookup(a)).toEqual(AuctionPhase.BIDDING);

    // --- placeBid (auction A only)
    sim.switchUser(bidderKey);
    await sim.placeBid(a, 150n, salt);
    expect(sim.getLedger().bidCount.lookup(a).read()).toEqual(1n);
    expect(sim.getLedger().bidCount.lookup(b).read()).toEqual(0n);

    // --- closeAuction (both)
    sim.switchUser(auctioneerKey);
    await sim.closeAuction(a, 2000n);
    await sim.closeAuction(b, 2000n);
    expect(sim.getLedger().phase.lookup(a)).toEqual(AuctionPhase.CLOSED);
    expect(sim.getLedger().phase.lookup(b)).toEqual(AuctionPhase.CLOSED);

    // --- revealBid (auction A)
    sim.switchUser(bidderKey);
    await sim.revealBid(a, 150n, salt);
    expect(sim.getLedger().highestBid.lookup(a)).toEqual(150n);

    // --- claimItem (A) once the reveal window has passed
    sim.setBlockTime(2001n);
    await sim.claimItem(a);
    expect(sim.getLedger().itemClaimed.lookup(a)).toEqual(true);

    // --- finalizeAuction (B: no valid bids -> auctioneer reclaims)
    sim.switchUser(auctioneerKey);
    await sim.finalizeAuction(b);
    expect(sim.getLedger().itemClaimed.lookup(b)).toEqual(true);

    // finalize on A (highestBid > 0) is a no-op: it must not change the claimed flag
    await sim.finalizeAuction(a);
    expect(sim.getLedger().itemClaimed.lookup(a)).toEqual(true);
  });

  it('finalizeAuction is refused while the reveal window is still open', async () => {
    const key = randomBytes(32);
    const sim = await AuctionSimulator.create(key);
    const id = await sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    await sim.closeAuction(id, 2000n);
    sim.setBlockTime(1999n);
    await expect(sim.finalizeAuction(id)).rejects.toThrow('Reveal window still open');
  });
});

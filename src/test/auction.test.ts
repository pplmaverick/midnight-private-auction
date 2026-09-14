import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { describe, it, expect } from 'vitest';
import { AuctionSimulator } from './auction-simulator.js';
import { randomBytes } from './utils.js';
import { AuctionPhase } from '../../contract/src/managed/auction/contract/index.js';

setNetworkId('undeployed');

describe('Midnight Private Auction - createAuction', () => {
  it('creates a new auction with id 0 and BIDDING phase', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    expect(auctionId).toEqual(0n);
    expect(sim.getLedger().phase.lookup(auctionId)).toEqual(AuctionPhase.BIDDING);
  });

  it('assigns sequential ids to consecutive auctions', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const id0 = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    const id1 = sim.createAuction('Painting', 'Oil painting', 200n, 1000n, 2000n);
    expect(id0).toEqual(0n);
    expect(id1).toEqual(1n);
  });
});

describe('Midnight Private Auction - placeBid', () => {
  it('records a sealed bid and increments bidCount', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    sim.switchUser(randomBytes(32));
    sim.placeBid(auctionId, 150n, randomBytes(32));
    expect(sim.getLedger().bidCount.lookup(auctionId).read()).toEqual(1n);
  });

  it('rejects a second bid from the same bidder', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    sim.switchUser(randomBytes(32));
    sim.placeBid(auctionId, 150n, randomBytes(32));
    expect(() => sim.placeBid(auctionId, 160n, randomBytes(32))).toThrow(
      'Already placed a bid in this auction',
    );
  });

  it('rejects a bid on a non-existent auction', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    sim.switchUser(randomBytes(32));
    expect(() => sim.placeBid(99n, 150n, randomBytes(32))).toThrow(
      'Auction does not exist',
    );
  });
});

describe('Midnight Private Auction - closeAuction', () => {
  it('lets the auctioneer close the auction', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    sim.closeAuction(auctionId, 2000n);
    expect(sim.getLedger().phase.lookup(auctionId)).toEqual(AuctionPhase.CLOSED);
  });

  it('rejects close from a non-auctioneer', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    sim.switchUser(randomBytes(32));
    expect(() => sim.closeAuction(auctionId, 2000n)).toThrow('Only the auctioneer can close');
  });
});

describe('Midnight Private Auction - revealBid', () => {
  it('updates the highest bid on a valid reveal', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 150n, salt);
    const bidderPK = sim.publicKey(auctionId);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);

    expect(sim.getLedger().highestBid.lookup(auctionId)).toEqual(150n);
    expect(sim.getLedger().highestBidderPK.lookup(auctionId)).toEqual(bidderPK);
  });

  it('rejects a reveal below the starting price', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 50n, salt);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    expect(() => sim.revealBid(auctionId, 50n, salt)).toThrow('Bid below starting price');
  });

  it('rejects a reveal with a mismatched salt', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const wrongSalt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 150n, salt);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    expect(() => sim.revealBid(auctionId, 150n, wrongSalt)).toThrow(
      'Bid commitment verification failed',
    );
  });
});

describe('Midnight Private Auction - revealBid duplicate reveal', () => {
  it('rejects a second reveal from the same bidder', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 150n, salt);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);

    expect(() => sim.revealBid(auctionId, 150n, salt)).toThrow('Already revealed your bid');
  });

  it('lets two different bidders each reveal once in the same auction', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const otherBidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const otherSalt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 150n, salt);
    sim.switchUser(otherBidderKey);
    sim.placeBid(auctionId, 120n, otherSalt);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);
    sim.switchUser(otherBidderKey);
    sim.revealBid(auctionId, 120n, otherSalt);

    expect(sim.getLedger().highestBid.lookup(auctionId)).toEqual(150n);
  });
});

describe('Midnight Private Auction - closeAuction permissionless after grace period', () => {
  const THREE_DAYS_SECONDS = 259200n;

  it('rejects close from a non-auctioneer before endTime + 3 days', () => {
    const auctioneerKey = randomBytes(32);
    const otherKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const endTime = 1000n;
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, endTime, 2000n);

    sim.switchUser(otherKey);
    // delta = 0 boundary: exactly at endTime + THREE_DAYS_SECONDS, blockTimeGte is
    // true (>=), so this must succeed, not throw. Use delta = -1 for the "must still
    // reject" case, matching the project's existing delta-based boundary convention.
    sim.setBlockTime(endTime + THREE_DAYS_SECONDS - 1n);
    expect(() => sim.closeAuction(auctionId, endTime + THREE_DAYS_SECONDS + 1000n)).toThrow(
      'Only the auctioneer can close, or wait 3 days after end time',
    );
  });

  it('lets a non-auctioneer close exactly at endTime + 3 days (delta = 0)', () => {
    const auctioneerKey = randomBytes(32);
    const otherKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const endTime = 1000n;
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, endTime, 2000n);

    sim.switchUser(otherKey);
    sim.setBlockTime(endTime + THREE_DAYS_SECONDS);
    sim.closeAuction(auctionId, endTime + THREE_DAYS_SECONDS + 1000n);

    expect(sim.getLedger().phase.lookup(auctionId)).toEqual(AuctionPhase.CLOSED);
  });

  it('lets a non-auctioneer close one second after endTime + 3 days', () => {
    const auctioneerKey = randomBytes(32);
    const otherKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const endTime = 1000n;
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, endTime, 2000n);

    sim.switchUser(otherKey);
    sim.setBlockTime(endTime + THREE_DAYS_SECONDS + 1n);
    sim.closeAuction(auctionId, endTime + THREE_DAYS_SECONDS + 1000n);

    expect(sim.getLedger().phase.lookup(auctionId)).toEqual(AuctionPhase.CLOSED);
  });

  it('still lets the auctioneer close immediately, before the grace period', () => {
    const auctioneerKey = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    sim.setBlockTime(0n);
    sim.closeAuction(auctionId, 2000n);
    expect(sim.getLedger().phase.lookup(auctionId)).toEqual(AuctionPhase.CLOSED);
  });
});

describe('Midnight Private Auction - claimItem', () => {
  it('lets the highest bidder claim the item', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const salt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 150n, salt);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);

    sim.setBlockTime(2001n);
    sim.claimItem(auctionId);

    expect(sim.getLedger().itemClaimed.lookup(auctionId)).toEqual(true);
  });

  it('rejects a claim from a non-winning bidder', () => {
    const auctioneerKey = randomBytes(32);
    const bidderKey = randomBytes(32);
    const otherKey = randomBytes(32);
    const salt = randomBytes(32);
    const sim = new AuctionSimulator(auctioneerKey);
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);

    sim.switchUser(bidderKey);
    sim.placeBid(auctionId, 150n, salt);

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId, 2000n);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);

    sim.switchUser(otherKey);
    sim.setBlockTime(2001n);
    expect(() => sim.claimItem(auctionId)).toThrow('Only the highest bidder can claim');
  });
});

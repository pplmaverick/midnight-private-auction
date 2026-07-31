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
    sim.closeAuction(auctionId);
    expect(sim.getLedger().phase.lookup(auctionId)).toEqual(AuctionPhase.CLOSED);
  });

  it('rejects close from a non-auctioneer', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const auctionId = sim.createAuction('Vase', 'Ming vase', 100n, 1000n, 2000n);
    sim.switchUser(randomBytes(32));
    expect(() => sim.closeAuction(auctionId)).toThrow('Only the auctioneer can close');
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
    const bidderPK = sim.publicKey();

    sim.switchUser(auctioneerKey);
    sim.closeAuction(auctionId);

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
    sim.closeAuction(auctionId);

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
    sim.closeAuction(auctionId);

    sim.switchUser(bidderKey);
    expect(() => sim.revealBid(auctionId, 150n, wrongSalt)).toThrow(
      'Bid commitment verification failed',
    );
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
    sim.closeAuction(auctionId);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);
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
    sim.closeAuction(auctionId);

    sim.switchUser(bidderKey);
    sim.revealBid(auctionId, 150n, salt);

    sim.switchUser(otherKey);
    expect(() => sim.claimItem(auctionId)).toThrow('Only the highest bidder can claim');
  });
});

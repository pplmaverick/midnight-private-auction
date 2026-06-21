import { Auction, type AuctionPrivateState } from '../contract/src/index.js';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js/types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js/contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

// One provider set handles all three roles via distinct private state IDs.
export const AUCTIONEER_STATE_ID = 'auctioneer' as const;
export const BIDDER1_STATE_ID = 'bidder1' as const;
export const BIDDER2_STATE_ID = 'bidder2' as const;
export type AuctionRoleId =
  | typeof AUCTIONEER_STATE_ID
  | typeof BIDDER1_STATE_ID
  | typeof BIDDER2_STATE_ID;

export type AuctionCircuits = ProvableCircuitId<Auction.Contract<AuctionPrivateState>>;
export type AuctionProviders = MidnightProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>;
export type AuctionContract = Auction.Contract<AuctionPrivateState>;
export type DeployedAuctionContract = DeployedContract<AuctionContract> | FoundContract<AuctionContract>;

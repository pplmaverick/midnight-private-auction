import { type Ledger } from './managed/auction/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';

export type AuctionBid = {
  readonly bidAmount: bigint;   // Uint<32> — sealed during BIDDING phase
  readonly bidSalt: Uint8Array; // 32 bytes — randomizes commitment hash
};

export type AuctionPrivateState = {
  readonly secretKey: Uint8Array;             // 32 bytes — never leaves local state
  readonly bids: Record<string, AuctionBid>;  // keyed by auctionId.toString()
};

export const createAuctionPrivateState = (
  secretKey: Uint8Array,
  bids: Record<string, AuctionBid> = {},
): AuctionPrivateState => ({ secretKey, bids });

// Witnesses bridge private state to Compact's witness() declarations.
// Each function receives a WitnessContext (ledger + privateState + contractAddress)
// and returns [newPrivateState, witnessValue]. Private state is immutable here
// so newPrivateState == privateState in all cases.
export const witnesses = {
  localSecretKey: (
    { privateState }: WitnessContext<Ledger, AuctionPrivateState>,
  ): [AuctionPrivateState, Uint8Array] => [privateState, privateState.secretKey],

  myBidAmount: (
    { privateState }: WitnessContext<Ledger, AuctionPrivateState>,
    auctionId: bigint,
  ): [AuctionPrivateState, bigint] => [privateState, privateState.bids[auctionId.toString()].bidAmount],

  myBidSalt: (
    { privateState }: WitnessContext<Ledger, AuctionPrivateState>,
    auctionId: bigint,
  ): [AuctionPrivateState, Uint8Array] => [privateState, privateState.bids[auctionId.toString()].bidSalt],
};

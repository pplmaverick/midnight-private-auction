import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum AuctionPhase { VACANT = 0, BIDDING = 1, CLOSED = 2 }

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  myBidAmount(context: __compactRuntime.WitnessContext<Ledger, PS>,
              auctionId_0: bigint): [PS, bigint];
  myBidSalt(context: __compactRuntime.WitnessContext<Ledger, PS>,
            auctionId_0: bigint): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  createAuction(context: __compactRuntime.CircuitContext<PS>, item_0: string): __compactRuntime.CircuitResults<PS, bigint>;
  placeBid(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  closeAuction(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>,
            auctionId_0: bigint,
            amount_0: bigint,
            salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  claimItem(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  createAuction(context: __compactRuntime.CircuitContext<PS>, item_0: string): __compactRuntime.CircuitResults<PS, bigint>;
  placeBid(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  closeAuction(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>,
            auctionId_0: bigint,
            amount_0: bigint,
            salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  claimItem(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  bidderPublicKey(sk_0: Uint8Array): Uint8Array;
  computeCommitment(sk_0: Uint8Array,
                    auctionId_0: bigint,
                    amount_0: bigint,
                    salt_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  bidderPublicKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  computeCommitment(context: __compactRuntime.CircuitContext<PS>,
                    sk_0: Uint8Array,
                    auctionId_0: bigint,
                    amount_0: bigint,
                    salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  createAuction(context: __compactRuntime.CircuitContext<PS>, item_0: string): __compactRuntime.CircuitResults<PS, bigint>;
  placeBid(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  closeAuction(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revealBid(context: __compactRuntime.CircuitContext<PS>,
            auctionId_0: bigint,
            amount_0: bigint,
            salt_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  claimItem(context: __compactRuntime.CircuitContext<PS>, auctionId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly nextAuctionId: bigint;
  phase: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): AuctionPhase;
    [Symbol.iterator](): Iterator<[bigint, AuctionPhase]>
  };
  itemName: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): string;
    [Symbol.iterator](): Iterator<[bigint, string]>
  };
  auctioneerPK: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  sealedBids: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): {
      isEmpty(): boolean;
      size(): bigint;
      member(key_1: Uint8Array): boolean;
      lookup(key_1: Uint8Array): Uint8Array;
      [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
    }
  };
  bidCount: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): { read(): bigint }
  };
  highestBidderPK: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
  highestBid: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>
  };
  itemClaimed: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): boolean;
    [Symbol.iterator](): Iterator<[bigint, boolean]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;

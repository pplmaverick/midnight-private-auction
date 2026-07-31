import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type Ledger,
} from '../../contract/src/managed/auction/contract/index.js';
import {
  witnesses,
  createAuctionPrivateState,
  type AuctionPrivateState,
} from '../../contract/src/witnesses.js';

/**
 * Serves as a testbed to exercise the auction contract in tests.
 * Runs the compiled circuits directly against an in-memory ledger —
 * no proof server, indexer, or node required.
 */
export class AuctionSimulator {
  readonly contract: Contract<AuctionPrivateState>;
  circuitContext: CircuitContext<AuctionPrivateState>;

  constructor(secretKey: Uint8Array) {
    this.contract = new Contract<AuctionPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(createAuctionPrivateState(secretKey), '0'.repeat(64)),
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  /**
   * Switch to a different secret key to simulate a different user.
   * The new user starts with an empty bid record; placeBid() populates
   * the relevant entry itself before invoking the circuit.
   */
  public switchUser(secretKey: Uint8Array, bids: AuctionPrivateState['bids'] = {}) {
    this.circuitContext.currentPrivateState = createAuctionPrivateState(secretKey, bids);
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): AuctionPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public publicKey(): Uint8Array {
    return this.contract.circuits.bidderPublicKey(
      this.circuitContext,
      this.getPrivateState().secretKey,
    ).result;
  }

  public createAuction(
    item: string,
    desc: string,
    startPrice: bigint,
    endTime: bigint,
    revealDeadline: bigint,
  ): bigint {
    const { result, context } = this.contract.impureCircuits.createAuction(
      this.circuitContext,
      item,
      desc,
      startPrice,
      endTime,
      revealDeadline,
    );
    this.circuitContext = context;
    return result;
  }

  /**
   * placeBid's circuit signature only takes auctionId — bidAmount/bidSalt
   * are pulled from private state via the myBidAmount/myBidSalt witnesses.
   * This wrapper stores the bid into private state first, then invokes
   * the circuit, so callers can pass the bid inline like the other methods.
   */
  public placeBid(auctionId: bigint, bidAmount: bigint, bidSalt: Uint8Array): Ledger {
    const currentPS = this.circuitContext.currentPrivateState;
    this.circuitContext.currentPrivateState = {
      ...currentPS,
      bids: {
        ...currentPS.bids,
        [auctionId.toString()]: { bidAmount, bidSalt },
      },
    };
    this.circuitContext = this.contract.impureCircuits.placeBid(
      this.circuitContext,
      auctionId,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public closeAuction(auctionId: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.closeAuction(
      this.circuitContext,
      auctionId,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public revealBid(auctionId: bigint, amount: bigint, salt: Uint8Array): Ledger {
    this.circuitContext = this.contract.impureCircuits.revealBid(
      this.circuitContext,
      auctionId,
      amount,
      salt,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public claimItem(auctionId: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.claimItem(
      this.circuitContext,
      auctionId,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public finalizeAuction(auctionId: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.finalizeAuction(
      this.circuitContext,
      auctionId,
    ).context;
    return ledger(this.circuitContext.currentQueryContext.state);
  }
}

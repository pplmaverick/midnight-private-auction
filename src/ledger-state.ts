import { ContractState } from '@midnight-ntwrk/compact-runtime';
import type { ContractStateAndParametersRead } from '@midnight-ntwrk/midnight-js-types';
import { Auction } from '../contract/src/index.js';

// midnight-js 5.x: queryContractState() returns an era-tagged serialized state, not a
// ContractState. This contract is compiled for the ledger-9 toolchain, so decode it as v9.
export const ledgerFromRead = (read: ContractStateAndParametersRead) =>
  Auction.ledger(read.contractState.deserialize({ v9: ContractState }).data);

import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types'
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js'
import { CompiledContract } from '@midnight-ntwrk/compact-js'
import { findDeployedContract, type DeployedContract, type FoundContract } from '@midnight-ntwrk/midnight-js/contracts'
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js/utils'
import { Auction, witnesses, createAuctionPrivateState, type AuctionPrivateState } from '../../../contract/src/index.js'

export { createAuctionPrivateState, type AuctionPrivateState, Auction }

// midnight-js 5.x removed the global setNetworkId(): the network id is now carried by
// providers.config (see auctionProviders.ts), so nothing needs to run at module load.

// Mirrors src/common-types.ts's role-ID scheme (Node CLI) — one provider set per role,
// each keyed by a distinct private-state ID so a single browser session can hold
// auctioneer and/or bidder private state side by side.
export const AUCTIONEER_STATE_ID = 'auctioneer' as const
export const BIDDER1_STATE_ID = 'bidder1' as const
export const BIDDER2_STATE_ID = 'bidder2' as const
export type AuctionRoleId = typeof AUCTIONEER_STATE_ID | typeof BIDDER1_STATE_ID | typeof BIDDER2_STATE_ID

export type AuctionCircuits = ProvableCircuitId<Auction.Contract<AuctionPrivateState>>
export type AuctionProviders = MidnightProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>
export type DeployedAuctionContract =
  | DeployedContract<Auction.Contract<AuctionPrivateState>>
  | FoundContract<Auction.Contract<AuctionPrivateState>>

export const AUCTION_CONTRACT_ADDRESS = '118dc9f773df2137a1e0cfb0e9e0243dbf1c64e6a908c84442ca8bb272347e78'

// Same construction as src/api.ts's auctionCompiledContract. withCompiledFileAssets()
// only attaches a string to satisfy CompiledContract's type-level context (it makes R
// resolve to `never`) — nothing in the browser runtime ever reads this path. The real
// ZK assets are served over HTTP by BrowserZkConfigProvider (see browserZkConfigProvider.ts),
// which fetches directly from frontend/public/{zkir,keys}/, independent of this value.
const auctionCompiledContract = CompiledContract.make('auction', Auction.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets('auction'),
)

// Browser equivalent of src/api.ts's joinAs() — same findDeployedContract call, fixed to
// this app's one deployed contract address instead of taking it as a parameter.
// roleId/initialPrivateState are still parameters (not baked in here) because
// findDeployedContract requires them whenever the contract's private state type isn't
// `undefined` (Auction's isn't), and which role/state to use is a page-level decision:
// HomePage's createAuction flow uses AUCTIONEER_STATE_ID, AuctionDetailPage's
// placeBid/revealBid/claimItem flows use BIDDER1_STATE_ID. Currently only
// BIDDER1_STATE_ID is used in the UI; BIDDER2_STATE_ID is reserved for future
// multi-bidder support.
export const getDeployedAuction = async (
  providers: AuctionProviders,
  roleId: AuctionRoleId,
  initialPrivateState: AuctionPrivateState,
): Promise<DeployedAuctionContract> => {
  assertIsContractAddress(AUCTION_CONTRACT_ADDRESS)
  return findDeployedContract(providers, {
    contractAddress: AUCTION_CONTRACT_ADDRESS,
    compiledContract: auctionCompiledContract,
    privateStateId: roleId,
    initialPrivateState,
  })
}

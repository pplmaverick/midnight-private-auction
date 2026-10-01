import { deriveWalletBoundSecretKey } from './identity'
import { Auction, BIDDER1_STATE_ID } from './contract'

// The single entry point for "which bidder public keys could this wallet be using in this
// auction?". Result/status UI calls only this — never identity.ts's derivation directly —
// so when the secret-key scheme changes, this is the one place to update.
//
// bidderPublicKey is per-auction (auctionId is hashed in), hence the auctionId parameter.
// Returns an array so a future scheme can offer several candidates (e.g. legacy + new
// derivation); today there is exactly one: the wallet-bound key placeBid itself uses.
export const getMyBidderPKs = async (walletAddress: string, auctionId: bigint): Promise<Uint8Array[]> => {
  const secretKey = await deriveWalletBoundSecretKey(walletAddress, BIDDER1_STATE_ID)
  return [Auction.pureCircuits.bidderPublicKey(secretKey, auctionId)]
}

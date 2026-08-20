// Derives the 32-byte secret fed into the auction contract's localSecretKey witness
// from the connected wallet's unshielded address, instead of generating it randomly.
// bidderPublicKey(sk) is what the contract checks for "already bid in this auction"
// (auction.compact's placeBid) — a randomly generated sk can be discarded and
// regenerated (e.g. by clearing browser storage) to appear as a brand-new identity
// to that check. Deriving sk deterministically from the wallet address means the same
// wallet always reproduces the same sk, so the on-chain uniqueness check can't be
// bypassed without actually switching to a different wallet address.
//
// role domain-separates the derivation per privateStateId (auctioneer vs. bidder1)
// so a single wallet's auctioneer and bidder identities stay unlinkable to each
// other on-chain, matching the unlinkability the previous random-key scheme had.
export const deriveWalletBoundSecretKey = async (address: string, role: string): Promise<Uint8Array> => {
  const input = new TextEncoder().encode(`auction:secretKey:v1:${role}:${address}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return new Uint8Array(digest)
}

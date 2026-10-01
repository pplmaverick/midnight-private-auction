// Pure result logic for a closed auction — no React, no wasm, no I/O, so it is unit-testable.
//
// Everything here works from PUBLIC ledger facts plus "which bidder PKs are mine". It never
// returns, and callers must never render, anyone's PK: the only identity-related output is
// the boolean-ish `me` outcome for the viewer's own candidate PKs.

export type MyOutcome =
  | 'unknown' //             no candidate PKs (wallet not connected) — cannot tell
  | 'no-bid' //              none of my PKs has a sealed bid in this auction
  | 'sealed-pending' //      sealed, not revealed yet, reveal window still open
  | 'revealed-pending' //    revealed, final result not decided yet (reveal window open)
  | 'winner' //              final: highest revealed bid is mine
  | 'revealed-not-winner' // final: revealed, but someone else's bid is the highest
  | 'abstained' //           final: sealed but never revealed

export interface PublicResultInput {
  readonly isClosed: boolean // phase === CLOSED
  readonly nowSec: bigint
  readonly revealDeadline: bigint
  readonly highestBid: bigint
}

export interface PublicResult {
  // The reveal window is over and the outcome is settled. Mirrors the contract: revealBid is
  // allowed while blockTime < revealDeadline, claimItem/finalizeAuction once blockTime >= it.
  readonly finalized: boolean
  readonly revealWindowOpen: boolean // closed, but reveals can still change the highest bid
  readonly highestBid: bigint
  readonly sold: boolean // finalized with at least one valid revealed bid
}

export const computePublicResult = ({ isClosed, nowSec, revealDeadline, highestBid }: PublicResultInput): PublicResult => {
  const finalized = isClosed && revealDeadline > 0n && nowSec >= revealDeadline
  return {
    finalized,
    revealWindowOpen: isClosed && !finalized,
    highestBid,
    sold: finalized && highestBid > 0n,
  }
}

export interface AuctionResultInput extends PublicResultInput {
  readonly highestBidderPK: Uint8Array | null
  // Every bidder PK the connected wallet could be using in this auction. null = no wallet
  // connected. A match on ANY candidate counts as "mine".
  readonly myPKs: readonly Uint8Array[] | null
  readonly isSealed: (pk: Uint8Array) => boolean // sealedBids[auctionId] has this PK
  readonly isRevealed: (pk: Uint8Array) => boolean // revealedBidders[auctionId] has this PK
}

export interface AuctionResult extends PublicResult {
  readonly me: MyOutcome
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export const computeAuctionResult = (input: AuctionResultInput): AuctionResult => {
  const pub = computePublicResult(input)
  const { myPKs, highestBidderPK, isSealed, isRevealed } = input

  if (!myPKs || myPKs.length === 0) return { ...pub, me: 'unknown' }

  const sealedPK = myPKs.find((pk) => isSealed(pk))
  if (!sealedPK) return { ...pub, me: 'no-bid' }

  const revealed = myPKs.some((pk) => isRevealed(pk))

  if (!pub.finalized) {
    return { ...pub, me: revealed ? 'revealed-pending' : 'sealed-pending' }
  }
  if (!revealed) return { ...pub, me: 'abstained' }

  const isHighest = pub.sold && highestBidderPK !== null && myPKs.some((pk) => bytesEqual(pk, highestBidderPK))
  return { ...pub, me: isHighest ? 'winner' : 'revealed-not-winner' }
}

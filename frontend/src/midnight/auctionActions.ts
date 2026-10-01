// Pure visibility rule for the "Auction Actions" panel on the detail page — no React, no I/O,
// so it is unit-testable. Only DISPLAY logic: it never decides whether a contract call is
// allowed (the contract's own asserts do that).

export interface ActionsPanelInput {
  readonly isClosed: boolean // ledger phase === CLOSED
  readonly itemClaimed: boolean // ledger itemClaimed
  // The per-action flags the page already derives (close / reveal / claim / finalize).
  readonly showClose: boolean
  readonly showReveal: boolean
  readonly showClaim: boolean
  readonly showFinalize: boolean
  // Private state is locked, so the viewer's role (auctioneer / bidder / winner) is unknown
  // and the panel offers an Unlock prompt to find out.
  readonly roleUnknown: boolean
  // The viewer sealed a bid, never revealed it, and the auction ended with a winner
  // (result.me === 'abstained' && result.sold). Every remaining action — claim, finalize —
  // belongs to the winner or to the auctioneer of a no-sale auction, so there is nothing for
  // this viewer even while private state is locked.
  readonly abstainedAfterSale?: boolean
}

// A closed auction with itemClaimed = true is settled: either the winner claimed the item
// (claimItem) or the auctioneer finalized a no-sale auction (finalizeAuction sets the same
// flag when highestBid == 0). From there nothing is left to do — claimItem asserts
// !itemClaimed, reveals/claims/finalize are only possible around the reveal deadline and
// close needs the BIDDING phase — so the whole panel, including the Unlock prompt, is noise.
export const isSettled = ({ isClosed, itemClaimed }: Pick<ActionsPanelInput, 'isClosed' | 'itemClaimed'>): boolean =>
  isClosed && itemClaimed

export const shouldShowActionsPanel = (input: ActionsPanelInput): boolean => {
  if (isSettled(input)) return false
  if (input.abstainedAfterSale) return false
  return input.showClose || input.showReveal || input.showClaim || input.showFinalize || input.roleUnknown
}

export interface RevealButtonInput {
  readonly isClosed: boolean // ledger phase === CLOSED
  readonly hasSealedBid: boolean // my sealed bid is on-chain
  readonly hasRevealed: boolean // my bid is already revealed
  readonly nowSec: bigint
  readonly revealDeadline: bigint
}

// Mirrors auction.compact's revealBid: `assert(blockTimeLt(revealDeadline), "Reveal deadline has
// passed")` — the block time must be STRICTLY LESS than revealDeadline, so a reveal sent at
// exactly the deadline is rejected. (claimItem/finalizeAuction use blockTimeGte(revealDeadline),
// the exact complement: at now == deadline the reveal window is closed and the result is final.)
export const isRevealWindowOpen = (nowSec: bigint, revealDeadline: bigint): boolean => nowSec < revealDeadline

export const canShowRevealButton = ({
  isClosed,
  hasSealedBid,
  hasRevealed,
  nowSec,
  revealDeadline,
}: RevealButtonInput): boolean =>
  isClosed && hasSealedBid && !hasRevealed && isRevealWindowOpen(nowSec, revealDeadline)

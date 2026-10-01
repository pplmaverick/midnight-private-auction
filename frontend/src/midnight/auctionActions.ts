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
  return input.showClose || input.showReveal || input.showClaim || input.showFinalize || input.roleUnknown
}

// Fixed disclosure: the contract only records bids as numbers and moves no funds, so payment
// and delivery happen outside it. Shown on the auction detail page (once, in every phase).
export const SETTLEMENT_NOTE =
  'Bids are recorded on-chain as plain numbers. Currency, payment and delivery are agreed and settled off-chain between the auctioneer and the winner.'

export default function SettlementNote() {
  return (
    <p className="font-label-mono text-xs text-on-surface-variant leading-relaxed" data-testid="settlement-note">
      {SETTLEMENT_NOTE}
    </p>
  )
}

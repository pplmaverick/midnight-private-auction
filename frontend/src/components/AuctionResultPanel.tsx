import type { AuctionResult, MyOutcome } from '../midnight/auctionResult'
import SettlementNote from './SettlementNote'

interface AuctionResultPanelProps {
  result: AuctionResult
  revealDeadlineText: string
}

interface OutcomeContext {
  deadline: string
  sold: boolean
  highestBid: bigint
}

// Copy per viewer outcome. Deliberately says only what the chain can prove: "No bid found for
// this wallet" (not "you did not participate" — a bid made under a different identity would not
// be found), and never shows any bidder's public key. The contract moves no funds, so this
// copy must not imply any money changes hands.
const MY_OUTCOME: Record<MyOutcome, { text: (ctx: OutcomeContext) => string; tone: 'good' | 'neutral' | 'bad' }> = {
  unknown: { text: () => 'Connect your wallet to see your result', tone: 'neutral' },
  'no-bid': { text: () => 'No bid found for this wallet', tone: 'neutral' },
  'sealed-pending': {
    text: () => 'You have a sealed bid — reveal it before the reveal deadline',
    tone: 'neutral',
  },
  'revealed-pending': {
    text: ({ deadline }) => `Your bid is revealed — the final result is decided after ${deadline}`,
    tone: 'neutral',
  },
  winner: { text: () => 'You won this auction', tone: 'good' },
  'revealed-not-winner': {
    // A revealed bid can exist while the auction has no sale (e.g. a revealed 0 with no
    // reserve); there is no winning bid to quote in that case.
    text: ({ sold, highestBid }) =>
      sold
        ? `Not selected. Your bid was revealed but was not the highest. Winning bid: ${highestBid}`
        : 'Not selected. Your bid was revealed, but the auction ended without a sale.',
    tone: 'neutral',
  },
  abstained: {
    text: () => "Not counted. You placed a bid but didn't reveal it before the deadline, so it wasn't considered.",
    tone: 'bad',
  },
}

const TONE_CLASS = {
  good: 'border-success/30 bg-success/10 text-success',
  neutral: 'border-outline-variant bg-surface-container-lowest text-on-surface-variant',
  bad: 'border-error/40 bg-error/10 text-error',
} as const

export default function AuctionResultPanel({ result, revealDeadlineText }: AuctionResultPanelProps) {
  const mine = MY_OUTCOME[result.me]

  return (
    <div className="space-y-4" data-testid="auction-result">
      <div className="space-y-1">
        <span className="font-label-caps text-label-caps text-text-secondary uppercase">
          {result.finalized ? (result.sold ? 'Winning Bid' : 'Result') : 'Current highest revealed bid'}
        </span>
        <div className="font-label-mono text-lg text-primary">
          {result.finalized
            ? result.sold
              ? `${result.highestBid}`
              : 'No sale — no valid bids were revealed'
            : result.highestBid > 0n
            ? `${result.highestBid}`
            : 'No bids revealed yet'}
        </div>
        {!result.finalized && (
          <p className="font-label-mono text-xs text-on-surface-variant">
            Not final — reveals are accepted until {revealDeadlineText}.
          </p>
        )}
      </div>
      <div className={`p-4 rounded-lg border font-body-md text-sm leading-relaxed ${TONE_CLASS[mine.tone]}`} role="status">
        {mine.text({ deadline: revealDeadlineText, sold: result.sold, highestBid: result.highestBid })}
      </div>
      <SettlementNote />
    </div>
  )
}

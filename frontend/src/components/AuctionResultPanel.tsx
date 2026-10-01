import type { AuctionResult } from '../midnight/auctionResult'
import { describeMyOutcome } from '../midnight/resultCopy'
import SettlementNote from './SettlementNote'

interface AuctionResultPanelProps {
  result: AuctionResult
  revealDeadlineText: string
}

const TONE_CLASS = {
  good: 'border-success/30 bg-success/10 text-success',
  neutral: 'border-outline-variant bg-surface-container-lowest text-on-surface-variant',
  bad: 'border-error/40 bg-error/10 text-error',
} as const

export default function AuctionResultPanel({ result, revealDeadlineText }: AuctionResultPanelProps) {
  const mine = describeMyOutcome(result.me, {
    deadline: revealDeadlineText,
    sold: result.sold,
    highestBid: result.highestBid,
  })

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
        {mine.text}
      </div>
      <SettlementNote />
    </div>
  )
}

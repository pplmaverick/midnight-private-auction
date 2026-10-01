import type { MyOutcome } from './auctionResult.js'

// Viewer-facing copy for each MyOutcome — pure strings, so tests can assert exactly what the
// result panel renders. Says only what the chain can prove: "No bid found for this wallet"
// (not "you did not participate" — a bid made under a different identity would not be found),
// never shows any bidder's public key, and — because the contract moves no funds — must not
// imply any money changes hands.

export interface OutcomeContext {
  readonly deadline: string
  readonly sold: boolean
  readonly highestBid: bigint
}

export type OutcomeTone = 'good' | 'neutral' | 'bad'

export const NOT_COUNTED_TEXT =
  "Not counted. You placed a bid but didn't reveal it before the deadline, so it wasn't considered."

const MY_OUTCOME: Record<MyOutcome, { text: (ctx: OutcomeContext) => string; tone: OutcomeTone }> = {
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
  abstained: { text: () => NOT_COUNTED_TEXT, tone: 'bad' },
}

export const describeMyOutcome = (me: MyOutcome, ctx: OutcomeContext): { text: string; tone: OutcomeTone } => {
  const entry = MY_OUTCOME[me]
  return { text: entry.text(ctx), tone: entry.tone }
}

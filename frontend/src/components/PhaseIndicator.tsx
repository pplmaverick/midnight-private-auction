import { Auction } from '../midnight/contract'

type PhaseIndicatorProps = {
  phase: Auction.AuctionPhase | null
  itemClaimed: boolean
  hasRevealedBids: boolean
}

const STEPS = [
  { id: 1, label: 'Create' },
  { id: 2, label: 'Bidding' },
  { id: 3, label: 'Sealed' },
  { id: 4, label: 'Reveal' },
  { id: 5, label: 'Complete' },
]

export default function PhaseIndicator({ phase, itemClaimed, hasRevealedBids }: PhaseIndicatorProps) {
  // itemClaimed wins outright — the auction is done regardless of on-chain phase.
  // Otherwise CLOSED covers both the sealed-but-unrevealed and reveal-in-progress
  // states, distinguished by whether any bid has actually been revealed yet.
  const activeStep = itemClaimed
    ? 5
    : phase === Auction.AuctionPhase.CLOSED
    ? hasRevealedBids
      ? 4
      : 3
    : phase === Auction.AuctionPhase.BIDDING
    ? 2
    : 1

  return (
    <div className="mb-stack-lg flex items-center justify-between max-w-3xl mx-auto">
      {STEPS.map((step, index) => (
        <div key={step.id} className="contents">
          {index > 0 && (
            <div className={`stepper-line mx-4 ${step.id <= activeStep ? 'active' : ''}`}></div>
          )}
          {step.id === activeStep ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full border-2 border-primary bg-background flex items-center justify-center text-primary font-label-mono font-bold shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                {String(step.id).padStart(2, '0')}
              </div>
              <span className="font-label-mono text-[10px] text-primary font-bold uppercase tracking-widest">
                {step.label}
              </span>
            </div>
          ) : step.id < activeStep ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-label-mono text-xs">
                {String(step.id).padStart(2, '0')}
              </div>
              <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
                {step.label}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-40">
              <div className="w-8 h-8 rounded-full border border-outline flex items-center justify-center text-on-surface-variant font-label-mono text-xs">
                {String(step.id).padStart(2, '0')}
              </div>
              <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
                {step.label}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

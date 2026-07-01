export default function PhaseIndicator() {
  return (
    <div className="mb-stack-lg flex items-center justify-between max-w-3xl mx-auto">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container font-label-mono text-xs">
          01
        </div>
        <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">Create</span>
      </div>
      <div className="stepper-line active mx-4"></div>
      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-full border-2 border-primary bg-background flex items-center justify-center text-primary font-label-mono font-bold shadow-[0_0_15px_rgba(124,58,237,0.3)]">
          02
        </div>
        <span className="font-label-mono text-[10px] text-primary font-bold uppercase tracking-widest">Bidding</span>
      </div>
      <div className="stepper-line mx-4"></div>
      <div className="flex flex-col items-center gap-2 opacity-40">
        <div className="w-8 h-8 rounded-full border border-outline flex items-center justify-center text-on-surface-variant font-label-mono text-xs">
          03
        </div>
        <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">Sealed</span>
      </div>
      <div className="stepper-line mx-4"></div>
      <div className="flex flex-col items-center gap-2 opacity-40">
        <div className="w-8 h-8 rounded-full border border-outline flex items-center justify-center text-on-surface-variant font-label-mono text-xs">
          04
        </div>
        <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">Reveal</span>
      </div>
      <div className="stepper-line mx-4"></div>
      <div className="flex flex-col items-center gap-2 opacity-40">
        <div className="w-8 h-8 rounded-full border border-outline flex items-center justify-center text-on-surface-variant font-label-mono text-xs">
          05
        </div>
        <span className="font-label-mono text-[10px] text-on-surface-variant uppercase tracking-widest">Complete</span>
      </div>
    </div>
  )
}

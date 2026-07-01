import { useState } from 'react'

interface BidInputProps {
  onSealSubmit: () => void
}

export default function BidInput({ onSealSubmit }: BidInputProps) {
  const [amount, setAmount] = useState('')

  return (
    <div className="space-y-stack-md">
      <div className="flex justify-between items-end">
        <span className="font-label-caps text-label-caps text-text-secondary uppercase">Your Secret Bid</span>
        <div className="flex items-center gap-1 text-primary-container">
          <span className="material-symbols-outlined text-sm" data-weight="fill">
            shield
          </span>
          <span className="font-label-mono text-[10px] font-bold uppercase tracking-tighter">
            Zero-Knowledge Protected
          </span>
        </div>
      </div>
      <div className="relative group">
        <input
          className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-6 py-5 font-label-mono text-2xl focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container transition-all placeholder:text-surface-container-highest"
          placeholder="0.00"
          step="0.01"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="absolute right-6 top-1/2 -translate-y-1/2 font-label-mono text-lg text-on-surface-variant">
          DUST
        </div>
      </div>
      <button
        type="button"
        onClick={() => onSealSubmit()}
        className="w-full bg-primary-container text-on-primary-container py-5 rounded-lg font-label-mono text-label-md font-bold uppercase tracking-widest hover:shadow-[0_0_30px_rgba(124,58,237,0.4)] transition-all active:scale-[0.98] flex items-center justify-center gap-3"
      >
        <span className="material-symbols-outlined">key_visualizer</span>
        Seal &amp; Submit Bid
      </button>
      <p className="text-center font-label-mono text-[10px] text-on-surface-variant/60">
        Minimum Increment: 0.05 DUST • Network Fee: ~0.0002 DUST
      </p>
    </div>
  )
}

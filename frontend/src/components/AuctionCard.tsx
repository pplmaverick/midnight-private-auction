import { useState, useEffect } from 'react'

interface AuctionCardProps {
  itemName: string
  phaseLabel: string
  bidCount: bigint
  onSelect: () => void
  description: string
  startingPrice: bigint
  endTime: bigint
}

export default function AuctionCard({
  itemName,
  phaseLabel,
  bidCount,
  onSelect,
  description,
  startingPrice,
  endTime,
}: AuctionCardProps) {
  const isBidding = phaseLabel === 'BIDDING'

  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 })
  useEffect(() => {
    if (!endTime) return
    const calc = () => {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const diff = endTime - now
      if (diff <= 0n) { setTimeLeft({ h: 0, m: 0, s: 0 }); return }
      const total = Number(diff)
      setTimeLeft({ h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 })
    }
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  return (
    <div className="glass-card rounded-xl overflow-hidden group cursor-pointer" onClick={onSelect}>
      <div className="relative h-52 overflow-hidden bg-gradient-to-br from-[#1a1025] via-[#120c1e] to-[#08060d] flex items-center justify-center">
        <div className="absolute inset-0 zk-hex-grid opacity-20 bg-[radial-gradient(circle_at_center,_rgba(124,58,237,0.4)_0%,_transparent_70%)]"></div>
        <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-primary-container/10 border border-primary-container/30 shadow-[0_0_40px_rgba(124,58,237,0.25)] group-hover:shadow-[0_0_55px_rgba(124,58,237,0.4)] transition-shadow duration-500">
          <span className="material-symbols-outlined text-5xl text-primary" data-weight="fill">
            lock
          </span>
        </div>
        <div className="absolute top-4 left-4 flex gap-stack-sm">
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg ${
              isBidding ? 'bg-success text-white' : 'bg-black/80 text-white border border-white/20'
            }`}
          >
            {isBidding && <span className="w-2 h-2 bg-white rounded-full status-pulse"></span>}
            {phaseLabel}
          </span>
        </div>
      </div>
      <div className="p-6">
        <h3 className="font-headline-md text-3xl text-text-primary mb-3 truncate">{itemName}</h3>
        <p className="font-body-md text-sm text-on-surface-variant truncate mb-3">{description}</p>
        <div className="flex items-center gap-2 mb-2">
          <span className="material-symbols-outlined text-primary text-lg">lock</span>
          <span className="font-label-mono text-2xl font-bold text-primary">{bidCount.toString()}</span>
          <span className="font-label-mono text-xs text-on-surface-variant uppercase tracking-widest">
            Sealed Bids
          </span>
        </div>
        <div className="font-label-mono text-xs text-on-surface-variant mb-6">
          {startingPrice > 0n ? `${startingPrice} DUST` : 'No reserve'}
        </div>
        {isBidding && endTime > 0n && (
          <div className="flex gap-2 font-label-mono text-xs text-on-surface-variant mb-2">
            <span>{String(timeLeft.h).padStart(2, '0')}h</span>
            <span>{String(timeLeft.m).padStart(2, '0')}m</span>
            <span>{String(timeLeft.s).padStart(2, '0')}s</span>
          </div>
        )}
        <button
          type="button"
          className="w-full py-3 rounded-lg border border-primary text-primary font-bold hover:bg-primary/10 transition-colors"
        >
          {isBidding ? 'Place Private Bid' : 'View Auction'}
        </button>
      </div>
    </div>
  )
}

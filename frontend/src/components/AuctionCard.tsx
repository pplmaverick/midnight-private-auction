import { useState, useEffect } from 'react'

const BG_IMAGE_COUNT = 6

interface AuctionCardProps {
  itemName: string
  phaseLabel: string
  bidCount: bigint
  onSelect: () => void
  description: string
  startingPrice: bigint
  endTime: bigint
  auctionId: bigint
}

export default function AuctionCard({
  itemName,
  phaseLabel,
  bidCount,
  onSelect,
  description,
  startingPrice,
  endTime,
  auctionId,
}: AuctionCardProps) {
  const isBidding = phaseLabel === 'BIDDING'
  const isClosed = phaseLabel === 'CLOSED'
  const bgImage = `/images/auction-bg-${Number(auctionId) % BG_IMAGE_COUNT}.avif`

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
      <div
        className="relative h-52 overflow-hidden flex items-center justify-center p-6"
        style={{
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <h2 className="font-headline-md text-3xl text-white text-center font-bold px-4 group-hover:scale-105 transition-transform duration-700">
          {itemName}
        </h2>
        <div className="absolute top-4 left-4 flex gap-stack-sm">
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg ${
              isBidding ? 'bg-success text-white' : isClosed ? 'bg-black/80 text-white border border-white/20' : ''
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

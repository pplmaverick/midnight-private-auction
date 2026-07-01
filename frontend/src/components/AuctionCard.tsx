interface AuctionCardProps {
  imageSrc: string
  imageAlt: string
  sealedBids: number
  title: string
  endingIn: string
  reserve: string
  onSelect: () => void
}

export default function AuctionCard({
  imageSrc,
  imageAlt,
  sealedBids,
  title,
  endingIn,
  reserve,
  onSelect,
}: AuctionCardProps) {
  return (
    <div className="glass-card rounded-xl overflow-hidden group cursor-pointer" onClick={onSelect}>
      <div className="relative h-80 overflow-hidden">
        <img
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          alt={imageAlt}
          src={imageSrc}
        />
        <div className="absolute top-4 left-4 flex gap-stack-sm">
          <span className="bg-success text-white px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 shadow-lg">
            <span className="w-2 h-2 bg-white rounded-full status-pulse"></span> LIVE
          </span>
          <span className="bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-bold font-label-mono">
            🔒 {sealedBids} Sealed Bids
          </span>
        </div>
      </div>
      <div className="p-6">
        <h3 className="font-headline-md text-2xl text-text-primary mb-2">{title}</h3>
        <div className="flex justify-between items-center mb-6">
          <div className="flex flex-col">
            <span className="text-xs font-label-caps text-on-surface-variant mb-1 uppercase tracking-widest">
              Ending In
            </span>
            <span className="font-label-mono text-primary text-lg">{endingIn}</span>
          </div>
          <div className="text-right">
            <span className="text-xs font-label-caps text-on-surface-variant mb-1 uppercase tracking-widest">
              Reserve
            </span>
            <span className="font-label-mono text-text-primary text-lg">{reserve}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => console.log(`Place private bid on ${title}`)}
          className="w-full py-3 rounded-lg border border-primary text-primary font-bold hover:bg-primary/10 transition-colors"
        >
          Place Private Bid
        </button>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import AuctionCard from '../components/AuctionCard'
import { usePrivateState } from '../midnight/PrivateStateContext'
import { useWallet } from '../midnight/WalletContext'
import { buildAuctionProviders } from '../midnight/auctionProviders'
import { publicDataProvider } from '../midnight/publicDataProvider'
import {
  getDeployedAuction,
  createAuctionPrivateState,
  AUCTIONEER_STATE_ID,
  AUCTION_CONTRACT_ADDRESS,
  Auction,
  type AuctionCircuits,
  type AuctionRoleId,
  type AuctionPrivateState,
} from '../midnight/contract'

interface AuctionListItem {
  readonly auctionId: bigint
  readonly itemName: string
  readonly phase: Auction.AuctionPhase
  readonly bidCount: bigint
  readonly description: string
  readonly startingPrice: bigint
  readonly endTime: bigint
}

const phaseLabel = (phase: Auction.AuctionPhase): string => (phase === Auction.AuctionPhase.BIDDING ? 'BIDDING' : 'CLOSED')

interface HomePageProps {
  onNavigateToDetail: (auctionId: bigint) => void
  onNavigateHowItWorks: () => void
  onNavigateAbout: () => void
}

export default function HomePage({ onNavigateToDetail, onNavigateHowItWorks, onNavigateAbout }: HomePageProps) {
  const particlesRef = useRef<HTMLDivElement>(null)
  const { ensureUnlocked, provider } = usePrivateState()
  const { walletState } = useWallet()

  const [auctioneerKey, setAuctioneerKey] = useState<Uint8Array | null>(null)
  const [itemName, setItemName] = useState('')
  const [description, setDescription] = useState('')
  const [startingPrice, setStartingPrice] = useState('0')
  const [duration, setDuration] = useState('24')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<string | null>(null)

  const [auctionList, setAuctionList] = useState<AuctionListItem[]>([])
  const [loadingAuctions, setLoadingAuctions] = useState(true)

  // Reads nextAuctionId (the exclusive upper bound of assigned auction IDs) and, for
  // each existing ID, its itemName/phase/bidCount — all local lookups against the one
  // ledger snapshot fetched below, not one network round-trip per auction.
  const refreshAuctionList = useCallback(async () => {
    setLoadingAuctions(true)
    try {
      const state = await publicDataProvider.queryContractState(AUCTION_CONTRACT_ADDRESS)
      if (!state) {
        setAuctionList([])
        return
      }
      const ledger = Auction.ledger(state.data)
      const items: AuctionListItem[] = []
      for (let id = 0n; id < ledger.nextAuctionId; id++) {
        if (!ledger.phase.member(id)) continue
        items.push({
          auctionId: id,
          itemName: ledger.itemName.lookup(id),
          phase: ledger.phase.lookup(id),
          bidCount: ledger.bidCount.lookup(id).read(),
          description: ledger.description.member(id) ? String(ledger.description.lookup(id)) : '',
          startingPrice: ledger.startingPrice.member(id) ? BigInt(ledger.startingPrice.lookup(id)) : 0n,
          endTime: ledger.endTime.member(id) ? BigInt(ledger.endTime.lookup(id)) : 0n,
        })
      }
      // Newest first.
      items.reverse()
      setAuctionList(items)
    } catch {
      setAuctionList([])
    } finally {
      setLoadingAuctions(false)
    }
  }, [])

  useEffect(() => {
    refreshAuctionList()
  }, [refreshAuctionList])

  const handleCreateAuction = async () => {
    setCreating(true)
    setCreateResult(null)
    try {
      const unlocked = await ensureUnlocked()
      if (!unlocked) {
        setCreateResult('Private state locked — unlock to continue.')
        return
      }
      if (walletState.status !== 'connected' || !provider) {
        setCreateResult('Wallet not connected — connect a wallet before creating an auction.')
        return
      }

      // Reuse the same auctioneer secretKey across calls within a session (mirrors
      // src/index.ts's aucPrivState, which is reused for both createAuction and
      // closeAuction — the auctioneer identity must stay stable within a session).
      const secretKey = auctioneerKey ?? crypto.getRandomValues(new Uint8Array(32))
      if (!auctioneerKey) setAuctioneerKey(secretKey)

      const providers = await buildAuctionProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>(
        walletState.api,
        provider,
      )
      const contract = await getDeployedAuction(
        providers,
        AUCTIONEER_STATE_ID,
        // Auctioneer never bids, so no bids record is needed.
        createAuctionPrivateState(secretKey),
      )
      const now = BigInt(Math.floor(Date.now() / 1000))
      const durationSec = BigInt(Number(duration) * 3600)
      const auctionEndTime = now + durationSec
      const auctionRevealDeadline = auctionEndTime + BigInt(21600)
      const result = await contract.callTx.createAuction(
        itemName,
        description,
        BigInt(startingPrice),
        auctionEndTime,
        auctionRevealDeadline,
      )
      const auctionId = result.private.result
      setCreateResult(`createAuction tx submitted — auctionId: ${auctionId}`)
      // Matches createAuction's own initial ledger writes exactly (phase: BIDDING,
      // bidCount: 0) — no need to re-query the indexer, which may not have caught
      // up yet and would otherwise make the new card flicker away.
      setAuctionList((prev) => [
        {
          auctionId,
          itemName,
          phase: Auction.AuctionPhase.BIDDING,
          bidCount: 0n,
          description,
          startingPrice: BigInt(startingPrice),
          endTime: auctionEndTime,
        },
        ...prev,
      ])
    } catch (err) {
      console.error('[createAuction error]', err)
      setCreateResult(err instanceof Error ? err.message : 'Failed to create auction')
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    const container = particlesRef.current
    if (!container) return

    const dots: HTMLDivElement[] = []
    for (let i = 0; i < 40; i++) {
      const dot = document.createElement('div')
      dot.style.position = 'absolute'
      dot.style.width = Math.random() * 3 + 'px'
      dot.style.height = dot.style.width
      dot.style.backgroundColor = '#7C3AED'
      dot.style.borderRadius = '50%'
      dot.style.left = Math.random() * 100 + '%'
      dot.style.top = Math.random() * 100 + '%'
      dot.style.opacity = String(Math.random() * 0.5)
      dot.style.filter = 'blur(1px)'

      dot.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${Math.random() * 100 - 50}px, ${Math.random() * 100 - 50}px)` },
        ],
        {
          duration: 5000 + Math.random() * 5000,
          direction: 'alternate',
          iterations: Infinity,
          easing: 'ease-in-out',
        },
      )

      container.appendChild(dot)
      dots.push(dot)
    }

    return () => {
      dots.forEach((dot) => dot.remove())
    }
  }, [])

  const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="bg-[#0A0A0F] text-[#e4e1e9] font-body-md text-body-md selection:bg-primary/30 min-h-screen">
      <Navbar activePage="home" onNavigateHowItWorks={onNavigateHowItWorks} onNavigateAbout={onNavigateAbout} />
      <main className="pt-20">
        <section className="relative min-h-[280px] flex flex-col items-center justify-center text-center px-margin-mobile md:px-margin-desktop overflow-hidden py-10">
          <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
            <div className="w-full h-full" ref={particlesRef}></div>
          </div>
          <div className="relative z-10 max-w-4xl">
            <h1 className="font-display-xl text-display-xl-mobile md:text-display-xl text-text-primary mb-stack-md">
              Bid in Silence.
              <br />
              Win with Certainty.
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto mb-stack-lg">
              The world's first private auction house powered by Zero-Knowledge proofs. Your bids are encrypted,
              your strategy remains hidden, and your privacy is absolute.
            </p>
            <div className="flex flex-col md:flex-row gap-gutter justify-center">
              <button
                type="button"
                onClick={() => scrollToId('auctions')}
                className="bg-[#7C3AED] text-[#F8F8FF] px-8 py-4 rounded-lg font-bold text-lg hover:shadow-[0_0_25px_rgba(124,58,237,0.5)] transition-all active:scale-95"
              >
                View Live Auctions
              </button>
              <button
                type="button"
                onClick={() => scrollToId('create-auction')}
                className="border border-border-muted text-[#C4B5FD] px-8 py-4 rounded-lg font-bold text-lg hover:bg-white/5 transition-all active:scale-95"
              >
                Create Auction
              </button>
            </div>
          </div>
          <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-full h-96 bg-gradient-to-t from-primary/5 to-transparent blur-3xl rounded-full opacity-30"></div>
        </section>

        <section
          id="auctions"
          className="py-stack-lg px-6 md:px-16 max-w-container-max mx-auto mb-24"
        >
          <div className="mb-stack-lg">
            <h2 className="font-headline-md text-headline-md text-text-primary">Live Auctions</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Real auctions on Midnight mainnet — sealed bids, zero-knowledge verified.
            </p>
          </div>
          {loadingAuctions ? (
            <p className="font-label-mono text-sm text-on-surface-variant">Loading auctions from chain…</p>
          ) : auctionList.length === 0 ? (
            <p className="font-label-mono text-sm text-on-surface-variant">
              No auctions yet — create the first one below.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {auctionList.map((auction) => (
                <AuctionCard
                  key={auction.auctionId.toString()}
                  itemName={auction.itemName}
                  phaseLabel={phaseLabel(auction.phase)}
                  bidCount={auction.bidCount}
                  onSelect={() => onNavigateToDetail(auction.auctionId)}
                  description={auction.description}
                  startingPrice={auction.startingPrice}
                  endTime={auction.endTime}
                />
              ))}
            </div>
          )}
        </section>

        <section
          id="create-auction"
          className="py-stack-lg px-6 md:px-16 max-w-container-max mx-auto mb-24"
        >
          <span className="font-label-caps text-label-caps text-primary uppercase tracking-widest">
            List an Item
          </span>
          <h2 className="font-headline-md text-headline-md text-text-primary mt-1 mb-stack-md">
            Create Auction (Auctioneer)
          </h2>
          <div className="flex flex-col gap-gutter items-start">
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Item name"
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 font-label-mono text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your item..."
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 font-label-mono text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
            />
            <div className="flex flex-col md:flex-row gap-gutter items-start md:items-center w-full">
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 font-label-mono text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
              >
                <option value="1">1 Hour</option>
                <option value="6">6 Hours</option>
                <option value="24">24 Hours</option>
                <option value="72">72 Hours</option>
              </select>
              <input
                type="number"
                value={startingPrice}
                onChange={(e) => setStartingPrice(e.target.value)}
                placeholder="Starting price in DUST (0 = no reserve)"
                min="0"
                className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 font-label-mono text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
              />
              <button
                type="button"
                onClick={handleCreateAuction}
                disabled={creating}
                className="bg-[#7C3AED] text-[#F8F8FF] px-8 py-2 rounded-lg font-bold hover:shadow-[0_0_25px_rgba(124,58,237,0.5)] transition-all active:scale-95 disabled:opacity-50"
              >
                {creating ? 'Submitting...' : 'Create Auction'}
              </button>
            </div>
          </div>
          {createResult && <p className="mt-stack-sm font-label-mono text-sm text-on-surface-variant">{createResult}</p>}
        </section>
      </main>

      <footer className="w-full py-12 px-margin-desktop flex flex-col md:flex-row justify-between items-center gap-stack-md bg-surface-container-lowest border-t border-outline-variant">
        <div className="flex flex-col items-center md:items-start gap-2">
          <span className="font-display-xl text-headline-sm text-primary">MIDNIGHT</span>
          <p className="font-body-md text-body-md text-on-surface-variant">
            © 2024 Midnight Private Auction. Secured by ZK-Proofs.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-stack-lg">
          <a
            className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100"
            href="#"
          >
            Terms of Service
          </a>
          <a
            className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100"
            href="#"
          >
            Privacy Policy
          </a>
          <a
            className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100"
            href="#"
          >
            Security Audit
          </a>
          <a
            className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100"
            href="#"
          >
            Documentation
          </a>
        </div>
      </footer>
    </div>
  )
}

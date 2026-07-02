import { useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import AuctionCard from '../components/AuctionCard'
import { usePrivateState } from '../midnight/PrivateStateContext'
import { useWallet } from '../midnight/WalletContext'
import { buildAuctionProviders } from '../midnight/auctionProviders'
import {
  getDeployedAuction,
  createAuctionPrivateState,
  AUCTIONEER_STATE_ID,
  type AuctionCircuits,
  type AuctionRoleId,
  type AuctionPrivateState,
} from '../midnight/contract'

const auctions = [
  {
    imageSrc:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuC2Su1ltBPeQ0HzPdD7WFjx4IS7DyzmqjIEpRP_PM1e4J9m4P5fbXtsu-L1MxLZtnV5T6IGSqugGDB1PC0POCOEBfZ2wHBwffhwOgc6ZW7kJPAZfsyhGYnp7eUQIxiiKW7yN_mt124EAsTKK-IZYAhnZnWdVm820q2BHDcCWyvwgznybzPxbZ_zeQd5HDV3pzJ_HcFYrWNDhQJxlt46Irhpi7MVtsr6iTYWikB9mc4lJGib7JY1W-g-a7OlOp6zDKmuJby3UdENWy9S',
    imageAlt: 'A translucent obsidian sculpture with liquid violet light swirling inside.',
    sealedBids: 14,
    title: 'Obsidian Core #042',
    endingIn: '04h 22m 11s',
    reserve: '12.5 ETH',
  },
  {
    imageSrc:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCDXSpNCkl56JNCORpfCRhLRMbD2QwMXG6aNvg_396cP6P5guPovyw-e143gWrck_yM2vY0_Sdf0ZdF8V-FYj8Tlj5O5hqexqF8vy0Al2M3yI_cY9VSho_I1C1uEbup54_yLf3frvNhzOXxRqUJs-cu0bz6eyEIEq6k7Zm_eG-8P95y5caA40AmjINR6ZeKvLIu14BBObvzm2L0qqzPzuy9JlG9RmnJjn2WnrUZk3ipZ1w-HAg4_PXgt99bDE5mog_W84t1TCkP4ThQ',
    imageAlt: 'A floating crystalline structure resembling a frozen storm.',
    sealedBids: 8,
    title: 'Vortex Prism',
    endingIn: '1d 02h 45m',
    reserve: '8.0 ETH',
  },
  {
    imageSrc:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuA168mGumWFvZ1PIHX7hY19beRYCQN48NSfBEp63_0nMtcks4Tb78Rg2N_tBQJgp6R8CSMlwJa5C4fXw_FjlUBFEqUpBKTFUqPB5SL3VN358TT_mG8aFYFfMD0oG3KRzXPb60hL_wA6gRTn24JzXKKRkQxPUBa1w_wUH60SftGeBIDJB-Jl9BKFyVkMfqqO8kLO7I6O3mePcjVQqpHKhWzMzVbbr_QZTvGjqLpO59NJ09lMnZ-3cxEG3oeENIVEHxc6AZOhu2sImiwB',
    imageAlt: 'Interlocking gold and dark matter rings suspended in zero gravity.',
    sealedBids: 32,
    title: 'Ethereal Cycle',
    endingIn: '00h 48m 52s',
    reserve: '25.0 ETH',
  },
]

interface HomePageProps {
  onNavigateToDetail: () => void
}

export default function HomePage({ onNavigateToDetail }: HomePageProps) {
  const particlesRef = useRef<HTMLDivElement>(null)
  const { ensureUnlocked, provider } = usePrivateState()
  const { walletState } = useWallet()

  const [auctioneerKey, setAuctioneerKey] = useState<Uint8Array | null>(null)
  const [itemName, setItemName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<string | null>(null)

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
        createAuctionPrivateState(secretKey, 0n, new Uint8Array(32)),
      )
      await contract.callTx.createAuction(itemName)
      setCreateResult('createAuction tx submitted')
    } catch (err) {
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

  return (
    <div className="bg-[#0A0A0F] text-[#e4e1e9] font-body-md text-body-md selection:bg-primary/30 min-h-screen">
      <Navbar />
      <main className="pt-20">
        <section className="relative min-h-[819px] flex flex-col items-center justify-center text-center px-margin-mobile md:px-margin-desktop overflow-hidden">
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
                onClick={() => onNavigateToDetail()}
                className="bg-[#7C3AED] text-[#F8F8FF] px-8 py-4 rounded-lg font-bold text-lg hover:shadow-[0_0_25px_rgba(124,58,237,0.5)] transition-all active:scale-95"
              >
                View Live Auctions
              </button>
              <button
                type="button"
                onClick={() => console.log('Create Auction clicked')}
                className="border border-border-muted text-[#C4B5FD] px-8 py-4 rounded-lg font-bold text-lg hover:bg-white/5 transition-all active:scale-95"
              >
                Create Auction
              </button>
            </div>
          </div>
          <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-full h-96 bg-gradient-to-t from-primary/5 to-transparent blur-3xl rounded-full opacity-30"></div>
        </section>

        <section id="auctions" className="py-stack-lg px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto mb-24">
          <div className="flex justify-between items-end mb-stack-lg">
            <div>
              <h2 className="font-headline-md text-headline-md text-text-primary">Featured Collections</h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Hand-picked digital masterpieces currently under seal.
              </p>
            </div>
            <div className="hidden md:flex gap-stack-sm">
              <button
                type="button"
                onClick={() => console.log('Filter clicked')}
                className="p-2 border border-border-muted rounded hover:border-primary transition-colors"
              >
                <span className="material-symbols-outlined text-primary">filter_list</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            {auctions.map((auction) => (
              <AuctionCard key={auction.title} {...auction} onSelect={() => onNavigateToDetail()} />
            ))}
          </div>
          <div className="mt-12 text-center">
            <button
              type="button"
              onClick={() => console.log('View All Live Auctions clicked')}
              className="text-on-surface-variant font-label-mono text-sm hover:text-primary transition-colors flex items-center gap-2 mx-auto"
            >
              View All Live Auctions <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </section>

        <section className="py-stack-lg px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto mb-24">
          <h2 className="font-headline-md text-headline-md text-text-primary mb-stack-md">
            Create Auction (Auctioneer)
          </h2>
          <div className="flex flex-col md:flex-row gap-gutter items-start md:items-center">
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Item name"
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
          {createResult && <p className="mt-stack-sm font-label-mono text-sm text-on-surface-variant">{createResult}</p>}
        </section>
      </main>

      <footer className="w-full py-stack-lg px-margin-desktop flex flex-col md:flex-row justify-between items-center gap-stack-md bg-surface-container-lowest border-t border-outline-variant">
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

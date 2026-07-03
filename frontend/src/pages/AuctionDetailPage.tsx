import { useEffect, useState } from 'react'
import Navbar from '../components/Navbar'
import PhaseIndicator from '../components/PhaseIndicator'
import BidInput from '../components/BidInput'
import { usePrivateState } from '../midnight/PrivateStateContext'
import { useWallet } from '../midnight/WalletContext'
import { buildAuctionProviders } from '../midnight/auctionProviders'
import { ProvingNotSupportedError } from '../midnight/proofProvider'
import {
  getDeployedAuction,
  createAuctionPrivateState,
  BIDDER1_STATE_ID,
  type AuctionCircuits,
  type AuctionRoleId,
  type AuctionPrivateState,
} from '../midnight/contract'

const MAX_BID_AMOUNT = 4294967295

interface AuctionDetailPageProps {
  onNavigateToZK: () => void
  onNavigateHome: () => void
  onNavigateHowItWorks: () => void
  onNavigateAbout: () => void
}

export default function AuctionDetailPage({
  onNavigateToZK,
  onNavigateHome,
  onNavigateHowItWorks,
  onNavigateAbout,
}: AuctionDetailPageProps) {
  const [time, setTime] = useState({ h: 4, m: 21, s: 58 })
  const { ensureUnlocked, provider } = usePrivateState()
  const { walletState } = useWallet()
  const [bidderKey, setBidderKey] = useState<Uint8Array | null>(null)
  const [bidError, setBidError] = useState<string | null>(null)
  const [bidResult, setBidResult] = useState<string | null>(null)
  const [provingUnsupported, setProvingUnsupported] = useState(false)
  // Which auction (by ID) this page is bidding on. The app doesn't have
  // per-auction routing yet, so this is a plain input defaulting to the
  // first auction (id 0) rather than a value threaded in from navigation.
  const [auctionIdInput, setAuctionIdInput] = useState('0')

  const handleSealSubmit = async (amount: string) => {
    setBidError(null)
    setBidResult(null)
    setProvingUnsupported(false)

    // amount is a raw integer bid unit (same semantics as src/index.ts's e2e test bids,
    // e.g. 100n/200n) — the contract's bidAmount field is Uint<0..4294967296>, not a
    // DUST/speck-scaled value, and has no fractional support.
    const parsedAmount = Number(amount)
    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0 || parsedAmount > MAX_BID_AMOUNT) {
      setBidError(`Enter a whole number between 1 and ${MAX_BID_AMOUNT}.`)
      return
    }

    let auctionId: bigint
    try {
      auctionId = BigInt(auctionIdInput)
    } catch {
      setBidError('Auction ID must be a whole number.')
      return
    }
    if (auctionId < 0n) {
      setBidError('Auction ID must be a whole number.')
      return
    }

    // Sealing a bid reads/writes the browser private-state store — make sure it's
    // unlocked first; ensureUnlocked() shows the password modal if needed.
    const unlocked = await ensureUnlocked()
    if (!unlocked) return

    if (walletState.status !== 'connected' || !provider) {
      setBidError('Wallet not connected — connect a wallet before placing a bid.')
      return
    }

    try {
      // Reuse the same bidder secretKey across calls within a session (mirrors
      // HomePage's auctioneer key reuse) — bidSalt is generated fresh per placeBid call.
      const secretKey = bidderKey ?? crypto.getRandomValues(new Uint8Array(32))
      if (!bidderKey) setBidderKey(secretKey)
      const bidSalt = crypto.getRandomValues(new Uint8Array(32))

      const providers = await buildAuctionProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>(
        walletState.api,
        provider,
      )
      const contract = await getDeployedAuction(
        providers,
        BIDDER1_STATE_ID,
        createAuctionPrivateState(secretKey, {
          [auctionId.toString()]: { bidAmount: BigInt(parsedAmount), bidSalt },
        }),
      )
      await contract.callTx.placeBid(auctionId)
      setBidResult('Bid sealed and submitted.')
      onNavigateToZK()
    } catch (err) {
      if (err instanceof ProvingNotSupportedError) {
        setProvingUnsupported(true)
        return
      }
      setBidError(err instanceof Error ? err.message : 'Failed to submit bid')
    }
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTime((prev) => {
        let { h, m, s } = prev
        s -= 1
        if (s < 0) {
          s = 59
          m -= 1
        }
        if (m < 0) {
          m = 59
          h -= 1
        }
        if (h < 0) {
          h = 0
          m = 0
          s = 0
        }
        return { h, m, s }
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="bg-[#131318] text-on-surface font-body-md selection:bg-primary-container selection:text-on-primary-container min-h-screen">
      <Navbar
        onNavigateHome={onNavigateHome}
        onNavigateHowItWorks={onNavigateHowItWorks}
        onNavigateAbout={onNavigateAbout}
      />
      <main className="pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto">
        <PhaseIndicator />

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-12 items-start">
          {/* Left Column: Item Detail */}
          <div className="space-y-stack-lg">
            <div className="luxury-frame group overflow-hidden relative">
              <img
                className="w-full aspect-[4/5] object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all duration-700"
                alt="A mesmerizing piece of digital abstract art with flowing deep violet and midnight blue nebulae."
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuA_E9PKWN_hy7HexwhqwIoNPfb_ZngaGMvhsw1D25WvBi4c7kfv_uKrBIrQLd_PXDjWmUGFSek-M9EvNhGKfPfazIAiZK6DiFLcFuKvfd92Cu83hEenhQOX_xbPNwexDsEL5aU0Hjx03UGF8yx7d1-ysJ4_5rkTaw5Nj27tlBHvMT6sdp1M2OdFRMrPcfffJcN_d3SuDKS5kI8hzIvMOcIe7qBL1a48rKCX19MiqMcj7KH3bRTOGiUMjA1uiTHxuapEoZEvS12vrlhX"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent pointer-events-none"></div>
            </div>
            <div className="space-y-stack-md">
              <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">
                Nebula Prism #042
              </h1>
              <div className="flex items-center gap-3">
                <span className="font-label-mono text-label-mono text-text-secondary">Seller:</span>
                <span className="font-label-mono text-label-mono text-primary bg-primary-container/10 px-3 py-1 rounded">
                  0x71C...4f92
                </span>
              </div>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
                A generative study of light refraction within a theoretical dark matter vacuum. This piece utilizes
                Midnight's proprietary ZK-State to ensure that ownership history remains anonymous until the moment
                of final settlement. The visual output is a high-fidelity 8K render with dynamic metadata
                reactivity.
              </p>
            </div>
            <div className="p-stack-md border border-primary-container/30 bg-primary-container/5 rounded-lg flex gap-4">
              <span className="material-symbols-outlined text-primary" data-weight="fill">
                privacy_tip
              </span>
              <div className="space-y-1">
                <h4 className="font-label-caps text-label-caps text-primary uppercase">
                  Cryptographic Privacy Notice
                </h4>
                <p className="font-body-md text-sm text-on-surface-variant leading-relaxed">
                  Your bid is sealed using Zero-Knowledge proofs. Only the commitment hash is public. The actual
                  amount remains hidden on-chain until the Reveal Phase, ensuring absolute game-theoretic fairness
                  and preventing bid-sniping.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Status & Bidding */}
          <div className="sticky top-28 space-y-stack-lg">
            <div className="glass-panel p-8 rounded-xl space-y-6">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 px-3 py-1 bg-success/10 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-success pulse-dot"></span>
                  <span className="font-label-mono text-xs text-success font-bold tracking-widest uppercase">
                    Live Auction
                  </span>
                </div>
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <span className="material-symbols-outlined text-sm">lock</span>
                  <span className="font-label-mono text-xs">12 Sealed Bids</span>
                </div>
              </div>
              <div className="space-y-2">
                <span className="font-label-caps text-label-caps text-text-secondary uppercase">
                  Time Remaining
                </span>
                <div className="flex gap-4 font-display-xl text-headline-lg text-text-primary">
                  <div>
                    {String(time.h).padStart(2, '0')}
                    <span className="text-sm font-label-mono ml-1 text-on-surface-variant">h</span>
                  </div>
                  <div className="text-primary-container">:</div>
                  <div>
                    {String(time.m).padStart(2, '0')}
                    <span className="text-sm font-label-mono ml-1 text-on-surface-variant">m</span>
                  </div>
                  <div className="text-primary-container">:</div>
                  <div>
                    {String(time.s).padStart(2, '0')}
                    <span className="text-sm font-label-mono ml-1 text-on-surface-variant">s</span>
                  </div>
                </div>
              </div>
              <div className="h-px bg-outline-variant/30"></div>

              {provingUnsupported && (
                <div
                  className="flex gap-3 p-4 rounded-lg border border-error/50 bg-error/10"
                  role="alert"
                >
                  <span className="material-symbols-outlined text-error shrink-0" data-weight="fill">
                    error
                  </span>
                  <p className="font-body-md text-sm text-error leading-relaxed">
                    Your wallet does not support ZK proof generation. Please use 1AM wallet, or configure
                    a local proof server at Settings → Proving Server (e.g. http://127.0.0.1:6300).
                  </p>
                </div>
              )}

              {bidError && (
                <p className="text-error text-sm font-label-mono" role="alert">
                  {bidError}
                </p>
              )}

              {bidResult && (
                <p className="text-success text-sm font-label-mono" role="status">
                  {bidResult}
                </p>
              )}

              <div className="space-y-2">
                <label htmlFor="auction-id" className="font-label-caps text-label-caps text-text-secondary uppercase">
                  Auction ID
                </label>
                <input
                  id="auction-id"
                  value={auctionIdInput}
                  onChange={(e) => setAuctionIdInput(e.target.value)}
                  placeholder="0"
                  className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 font-label-mono text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
                />
              </div>

              <BidInput onSealSubmit={handleSealSubmit} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="glass-panel p-4 rounded-lg flex flex-col gap-1">
                <span className="font-label-caps text-[10px] text-text-secondary uppercase">Protocol</span>
                <span className="font-label-mono text-sm">ZK-SNARKS v2</span>
              </div>
              <div className="glass-panel p-4 rounded-lg flex flex-col gap-1">
                <span className="font-label-caps text-[10px] text-text-secondary uppercase">Standard</span>
                <span className="font-label-mono text-sm">ERC-721P</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full py-stack-lg px-margin-desktop flex flex-col md:flex-row justify-between items-center gap-stack-md bg-surface-container-lowest border-t border-outline-variant">
        <div className="flex flex-col items-center md:items-start gap-2">
          <div className="font-display-xl text-headline-sm text-primary">MIDNIGHT</div>
          <p className="font-label-mono text-xs text-on-surface-variant opacity-80">
            © 2024 Midnight Private Auction. Secured by ZK-Proofs.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-stack-md">
          <a className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors" href="#">
            Terms of Service
          </a>
          <a className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors" href="#">
            Privacy Policy
          </a>
          <a className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors" href="#">
            Security Audit
          </a>
          <a className="font-label-mono text-label-mono text-on-surface-variant hover:text-primary transition-colors" href="#">
            Documentation
          </a>
        </div>
      </footer>
    </div>
  )
}

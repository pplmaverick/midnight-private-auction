import { useCallback, useEffect, useState } from 'react'
import Navbar from '../components/Navbar'
import PhaseIndicator from '../components/PhaseIndicator'
import BidInput from '../components/BidInput'
import { usePrivateState } from '../midnight/PrivateStateContext'
import { useWallet } from '../midnight/WalletContext'
import { buildAuctionProviders } from '../midnight/auctionProviders'
import { publicDataProvider } from '../midnight/publicDataProvider'
import { ProvingNotSupportedError } from '../midnight/proofProvider'
import {
  getDeployedAuction,
  createAuctionPrivateState,
  AUCTIONEER_STATE_ID,
  BIDDER1_STATE_ID,
  AUCTION_CONTRACT_ADDRESS,
  Auction,
  type AuctionCircuits,
  type AuctionRoleId,
  type AuctionPrivateState,
} from '../midnight/contract'

const MAX_BID_AMOUNT = 4294967295

// Bytes<32> equality — plain value comparison, no ordering/timing sensitivity needed
// since these are already-public on-chain keys, not secrets being compared.
const bytesEqual = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean => {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

interface AuctionStatus {
  readonly exists: boolean
  readonly phase: Auction.AuctionPhase | null
  readonly auctioneerPK: Uint8Array | null
  readonly highestBidderPK: Uint8Array | null
  readonly itemClaimed: boolean
  readonly highestBid: bigint
}

const EMPTY_AUCTION_STATUS: AuctionStatus = {
  exists: false,
  phase: null,
  auctioneerPK: null,
  highestBidderPK: null,
  itemClaimed: false,
  highestBid: 0n,
}

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
  const { ensureUnlocked, provider, isUnlocked } = usePrivateState()
  const { walletState } = useWallet()
  const [bidderKey, setBidderKey] = useState<Uint8Array | null>(null)
  const [bidError, setBidError] = useState<string | null>(null)
  const [bidResult, setBidResult] = useState<string | null>(null)
  const [provingUnsupported, setProvingUnsupported] = useState(false)
  // Which auction (by ID) this page is bidding on. The app doesn't have
  // per-auction routing yet, so this is a plain input defaulting to the
  // first auction (id 0) rather than a value threaded in from navigation.
  const [auctionIdInput, setAuctionIdInput] = useState('0')

  // Live on-chain phase/role data for the auctionId currently entered above —
  // drives which of the close/reveal/claim actions are shown below.
  const [auctionStatus, setAuctionStatus] = useState<AuctionStatus>(EMPTY_AUCTION_STATUS)
  // Derived from whichever secretKey is already stored locally for this contract
  // (never freshly generated here — only createAuction/placeBid establish new
  // identities; close/reveal/claim always act as whoever you already are).
  // Left null (role unknown) whenever private state is locked, so we don't force
  // an unlock prompt just to decide whether to show a button.
  const [myAuctioneerPK, setMyAuctioneerPK] = useState<Uint8Array | null>(null)
  const [myBidderPK, setMyBidderPK] = useState<Uint8Array | null>(null)
  const [hasSealedBid, setHasSealedBid] = useState(false)

  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [closeResult, setCloseResult] = useState<string | null>(null)

  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealResult, setRevealResult] = useState<string | null>(null)

  const [claiming, setClaiming] = useState(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimResult, setClaimResult] = useState<string | null>(null)

  // Re-reads public ledger state for auctionIdInput, plus (only if private state
  // is already unlocked — never forces the password prompt) this browser's own
  // stored auctioneer/bidder identities, so the action buttons below reflect
  // reality instead of always being visible.
  const refreshAuctionStatus = useCallback(async () => {
    let auctionId: bigint
    try {
      auctionId = BigInt(auctionIdInput)
    } catch {
      setAuctionStatus(EMPTY_AUCTION_STATUS)
      return
    }
    if (auctionId < 0n) {
      setAuctionStatus(EMPTY_AUCTION_STATUS)
      return
    }

    try {
      const state = await publicDataProvider.queryContractState(AUCTION_CONTRACT_ADDRESS)
      if (!state) {
        setAuctionStatus(EMPTY_AUCTION_STATUS)
        return
      }
      const ledger = Auction.ledger(state.data)
      if (!ledger.phase.member(auctionId)) {
        setAuctionStatus(EMPTY_AUCTION_STATUS)
        setMyAuctioneerPK(null)
        setMyBidderPK(null)
        setHasSealedBid(false)
        return
      }

      setAuctionStatus({
        exists: true,
        phase: ledger.phase.lookup(auctionId),
        auctioneerPK: ledger.auctioneerPK.lookup(auctionId),
        highestBidderPK: ledger.highestBidderPK.lookup(auctionId),
        itemClaimed: ledger.itemClaimed.lookup(auctionId),
        highestBid: ledger.highestBid.lookup(auctionId),
      })

      if (provider && isUnlocked) {
        provider.setContractAddress(AUCTION_CONTRACT_ADDRESS)
        const storedAuctioneer = (await provider.get(AUCTIONEER_STATE_ID)) as AuctionPrivateState | null
        const storedBidder = (await provider.get(BIDDER1_STATE_ID)) as AuctionPrivateState | null
        const auctioneerPK = storedAuctioneer ? Auction.pureCircuits.bidderPublicKey(storedAuctioneer.secretKey) : null
        const bidderPK = storedBidder ? Auction.pureCircuits.bidderPublicKey(storedBidder.secretKey) : null
        setMyAuctioneerPK(auctioneerPK)
        setMyBidderPK(bidderPK)
        setHasSealedBid(bidderPK !== null && ledger.sealedBids.lookup(auctionId).member(bidderPK))
      } else {
        setMyAuctioneerPK(null)
        setMyBidderPK(null)
        setHasSealedBid(false)
      }
    } catch {
      setAuctionStatus(EMPTY_AUCTION_STATUS)
    }
  }, [auctionIdInput, provider, isUnlocked])

  useEffect(() => {
    refreshAuctionStatus()
  }, [refreshAuctionStatus])

  const isAuctioneer = auctionStatus.exists && bytesEqual(myAuctioneerPK, auctionStatus.auctioneerPK)
  const isWinner = auctionStatus.exists && bytesEqual(myBidderPK, auctionStatus.highestBidderPK)
  const showCloseButton = auctionStatus.exists && auctionStatus.phase === Auction.AuctionPhase.BIDDING && isAuctioneer
  const showRevealButton = auctionStatus.exists && auctionStatus.phase === Auction.AuctionPhase.CLOSED && hasSealedBid
  const showClaimButton =
    auctionStatus.exists &&
    auctionStatus.phase === Auction.AuctionPhase.CLOSED &&
    !auctionStatus.itemClaimed &&
    auctionStatus.highestBid > 0n &&
    isWinner
  const roleUnknown = !provider || !isUnlocked

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
      await refreshAuctionStatus()
      onNavigateToZK()
    } catch (err) {
      if (err instanceof ProvingNotSupportedError) {
        setProvingUnsupported(true)
        return
      }
      setBidError(err instanceof Error ? err.message : 'Failed to submit bid')
    }
  }

  const handleCloseAuction = async () => {
    setCloseError(null)
    setCloseResult(null)

    let auctionId: bigint
    try {
      auctionId = BigInt(auctionIdInput)
    } catch {
      setCloseError('Auction ID must be a whole number.')
      return
    }

    const unlocked = await ensureUnlocked()
    if (!unlocked) return
    if (walletState.status !== 'connected' || !provider) {
      setCloseError('Wallet not connected — connect a wallet before closing the auction.')
      return
    }

    setClosing(true)
    try {
      // Never generate a fresh key here — closeAuction must act as the exact
      // auctioneer identity that created this auction, which is whatever is
      // already stored locally (if anything).
      provider.setContractAddress(AUCTION_CONTRACT_ADDRESS)
      const stored = (await provider.get(AUCTIONEER_STATE_ID)) as AuctionPrivateState | null
      if (!stored) {
        setCloseError('No auctioneer identity found in this browser for this auction.')
        return
      }
      const providers = await buildAuctionProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>(
        walletState.api,
        provider,
      )
      const contract = await getDeployedAuction(providers, AUCTIONEER_STATE_ID, stored)
      const result = await contract.callTx.closeAuction(auctionId)
      setCloseResult(`Auction closed — tx: ${result.public.txId}`)
      await refreshAuctionStatus()
    } catch (err) {
      if (err instanceof ProvingNotSupportedError) {
        setProvingUnsupported(true)
      } else {
        setCloseError(err instanceof Error ? err.message : 'Failed to close auction')
      }
    } finally {
      setClosing(false)
    }
  }

  const handleRevealBid = async () => {
    setRevealError(null)
    setRevealResult(null)

    let auctionId: bigint
    try {
      auctionId = BigInt(auctionIdInput)
    } catch {
      setRevealError('Auction ID must be a whole number.')
      return
    }

    const unlocked = await ensureUnlocked()
    if (!unlocked) return
    if (walletState.status !== 'connected' || !provider) {
      setRevealError('Wallet not connected — connect a wallet before revealing your bid.')
      return
    }

    setRevealing(true)
    try {
      // Must reuse the exact secretKey/bidAmount/bidSalt recorded at placeBid time —
      // the commitment check on-chain only passes against those original values.
      provider.setContractAddress(AUCTION_CONTRACT_ADDRESS)
      const stored = (await provider.get(BIDDER1_STATE_ID)) as AuctionPrivateState | null
      const bid = stored?.bids[auctionId.toString()]
      if (!stored || !bid) {
        setRevealError('No sealed bid found in this browser for this auction ID.')
        return
      }
      const providers = await buildAuctionProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>(
        walletState.api,
        provider,
      )
      const contract = await getDeployedAuction(providers, BIDDER1_STATE_ID, stored)
      const result = await contract.callTx.revealBid(auctionId, bid.bidAmount, bid.bidSalt)
      setRevealResult(`Bid revealed — tx: ${result.public.txId}`)
      await refreshAuctionStatus()
    } catch (err) {
      if (err instanceof ProvingNotSupportedError) {
        setProvingUnsupported(true)
      } else {
        setRevealError(err instanceof Error ? err.message : 'Failed to reveal bid')
      }
    } finally {
      setRevealing(false)
    }
  }

  const handleClaimItem = async () => {
    setClaimError(null)
    setClaimResult(null)

    let auctionId: bigint
    try {
      auctionId = BigInt(auctionIdInput)
    } catch {
      setClaimError('Auction ID must be a whole number.')
      return
    }

    const unlocked = await ensureUnlocked()
    if (!unlocked) return
    if (walletState.status !== 'connected' || !provider) {
      setClaimError('Wallet not connected — connect a wallet before claiming the item.')
      return
    }

    setClaiming(true)
    try {
      provider.setContractAddress(AUCTION_CONTRACT_ADDRESS)
      const stored = (await provider.get(BIDDER1_STATE_ID)) as AuctionPrivateState | null
      if (!stored) {
        setClaimError('No bidder identity found in this browser for this auction.')
        return
      }
      const providers = await buildAuctionProviders<AuctionCircuits, AuctionRoleId, AuctionPrivateState>(
        walletState.api,
        provider,
      )
      const contract = await getDeployedAuction(providers, BIDDER1_STATE_ID, stored)
      const result = await contract.callTx.claimItem(auctionId)
      setClaimResult(`Item claimed — tx: ${result.public.txId}`)
      await refreshAuctionStatus()
    } catch (err) {
      if (err instanceof ProvingNotSupportedError) {
        setProvingUnsupported(true)
      } else {
        setClaimError(err instanceof Error ? err.message : 'Failed to claim item')
      }
    } finally {
      setClaiming(false)
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
        activePage="home"
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

            {(showCloseButton || showRevealButton || showClaimButton || roleUnknown) && (
              <div className="glass-panel p-8 rounded-xl space-y-6">
                <span className="font-label-caps text-label-caps text-text-secondary uppercase">Auction Actions</span>

                {roleUnknown && !showCloseButton && !showRevealButton && !showClaimButton && (
                  <div className="space-y-2">
                    <p className="text-sm font-label-mono text-on-surface-variant">
                      Unlock private state to check whether you can close, reveal, or claim this auction.
                    </p>
                    <button
                      type="button"
                      onClick={() => ensureUnlocked()}
                      className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface py-3 rounded-lg font-label-mono text-sm font-bold uppercase tracking-widest hover:border-primary-container transition-all"
                    >
                      Unlock
                    </button>
                  </div>
                )}

                {showCloseButton && (
                  <div className="space-y-2">
                    {closeError && (
                      <p className="text-error text-sm font-label-mono" role="alert">
                        {closeError}
                      </p>
                    )}
                    {closeResult && (
                      <p className="text-success text-sm font-label-mono break-all" role="status">
                        {closeResult}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleCloseAuction}
                      disabled={closing}
                      className="w-full bg-primary-container text-on-primary-container py-4 rounded-lg font-label-mono text-label-md font-bold uppercase tracking-widest hover:shadow-[0_0_30px_rgba(124,58,237,0.4)] transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      {closing ? 'Closing…' : 'Close Auction (Auctioneer)'}
                    </button>
                  </div>
                )}

                {showRevealButton && (
                  <div className="space-y-2">
                    {revealError && (
                      <p className="text-error text-sm font-label-mono" role="alert">
                        {revealError}
                      </p>
                    )}
                    {revealResult && (
                      <p className="text-success text-sm font-label-mono break-all" role="status">
                        {revealResult}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleRevealBid}
                      disabled={revealing}
                      className="w-full bg-primary-container text-on-primary-container py-4 rounded-lg font-label-mono text-label-md font-bold uppercase tracking-widest hover:shadow-[0_0_30px_rgba(124,58,237,0.4)] transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      {revealing ? 'Revealing…' : 'Reveal My Bid'}
                    </button>
                  </div>
                )}

                {showClaimButton && (
                  <div className="space-y-2">
                    {claimError && (
                      <p className="text-error text-sm font-label-mono" role="alert">
                        {claimError}
                      </p>
                    )}
                    {claimResult && (
                      <p className="text-success text-sm font-label-mono break-all" role="status">
                        {claimResult}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleClaimItem}
                      disabled={claiming}
                      className="w-full bg-primary-container text-on-primary-container py-4 rounded-lg font-label-mono text-label-md font-bold uppercase tracking-widest hover:shadow-[0_0_30px_rgba(124,58,237,0.4)] transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      {claiming ? 'Claiming…' : 'Claim Item (Winner)'}
                    </button>
                  </div>
                )}
              </div>
            )}

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

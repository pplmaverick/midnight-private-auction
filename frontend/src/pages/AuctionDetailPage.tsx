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

const AUCTION_IMAGES = [
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80',
  'https://images.unsplash.com/photo-1633177317976-3f9bc45e1d1d?w=800&q=80',
  'https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?w=800&q=80',
  'https://images.unsplash.com/photo-1604076913837-52ab5629fde9?w=800&q=80',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
]

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
  readonly description: string
  readonly startingPrice: bigint
  readonly endTime: bigint
  readonly revealDeadline: bigint
  readonly itemName: string
  readonly bidCount: bigint
}

const EMPTY_AUCTION_STATUS: AuctionStatus = {
  exists: false,
  phase: null,
  auctioneerPK: null,
  highestBidderPK: null,
  itemClaimed: false,
  highestBid: 0n,
  description: '',
  startingPrice: 0n,
  endTime: 0n,
  revealDeadline: 0n,
  itemName: '',
  bidCount: 0n,
}

interface AuctionDetailPageProps {
  auctionId: bigint
  onNavigateToZK: () => void
  onNavigateHome: () => void
  onNavigateHowItWorks: () => void
  onNavigateAbout: () => void
}

export default function AuctionDetailPage({
  auctionId,
  onNavigateToZK,
  onNavigateHome,
  onNavigateHowItWorks,
  onNavigateAbout,
}: AuctionDetailPageProps) {
  const [timeLeft, setTimeLeft] = useState({ h: 0, m: 0, s: 0 })
  const { ensureUnlocked, provider, isUnlocked } = usePrivateState()
  const { walletState } = useWallet()
  const [bidderKey, setBidderKey] = useState<Uint8Array | null>(null)
  const [bidError, setBidError] = useState<string | null>(null)
  const [bidResult, setBidResult] = useState<string | null>(null)
  const [provingUnsupported, setProvingUnsupported] = useState(false)

  // Live on-chain phase/role data for the auctionId passed in —
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
        description: ledger.description.member(auctionId) ? String(ledger.description.lookup(auctionId)) : '',
        startingPrice: ledger.startingPrice.member(auctionId) ? BigInt(ledger.startingPrice.lookup(auctionId)) : 0n,
        endTime: ledger.endTime.member(auctionId) ? BigInt(ledger.endTime.lookup(auctionId)) : 0n,
        revealDeadline: ledger.revealDeadline.member(auctionId) ? BigInt(ledger.revealDeadline.lookup(auctionId)) : 0n,
        itemName: ledger.itemName.member(auctionId) ? String(ledger.itemName.lookup(auctionId)) : '',
        bidCount: ledger.bidCount.member(auctionId) ? BigInt(ledger.bidCount.lookup(auctionId).read()) : 0n,
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
  }, [auctionId, provider, isUnlocked])

  useEffect(() => {
    refreshAuctionStatus()
  }, [refreshAuctionStatus])

  useEffect(() => {
    if (!auctionStatus.endTime) return
    const calc = () => {
      const now = BigInt(Math.floor(Date.now() / 1000))
      const diff = auctionStatus.endTime - now
      if (diff <= 0n) {
        setTimeLeft({ h: 0, m: 0, s: 0 })
        return
      }
      const total = Number(diff)
      setTimeLeft({
        h: Math.floor(total / 3600),
        m: Math.floor((total % 3600) / 60),
        s: total % 60,
      })
    }
    calc()
    const interval = setInterval(calc, 1000)
    return () => clearInterval(interval)
  }, [auctionStatus.endTime])

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
                alt={auctionStatus.itemName || `Auction #${auctionId}`}
                src={AUCTION_IMAGES[Number(auctionId) % AUCTION_IMAGES.length]}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent pointer-events-none"></div>
            </div>
            <div className="space-y-stack-md">
              <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">
                {auctionStatus.itemName || `Auction #${auctionId}`}
              </h1>
              <div className="flex items-center gap-3">
                <span className="font-label-mono text-label-mono text-text-secondary">Seller:</span>
                <span className="font-label-mono text-label-mono text-primary bg-primary-container/10 px-3 py-1 rounded">
                  {auctionStatus.auctioneerPK
                    ? Array.from(auctionStatus.auctioneerPK.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('') + '...'
                    : '—'}
                </span>
              </div>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
                {auctionStatus.description || '—'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-label-mono text-label-mono text-text-secondary">Reserve Price:</span>
              <span className="font-label-mono text-label-mono text-primary">
                {auctionStatus.startingPrice > 0n ? `${auctionStatus.startingPrice} DUST` : 'No reserve'}
              </span>
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
                  <span className="font-label-mono text-xs">{String(auctionStatus.bidCount)} Sealed Bids</span>
                </div>
              </div>
              <div className="space-y-2">
                <span className="font-label-caps text-label-caps text-text-secondary uppercase">
                  Time Remaining
                </span>
                <div className="flex gap-4 font-display-xl text-headline-lg text-text-primary">
                  <div>
                    {String(timeLeft.h).padStart(2, '0')}
                    <span className="text-sm font-label-mono ml-1 text-on-surface-variant">h</span>
                  </div>
                  <div className="text-primary-container">:</div>
                  <div>
                    {String(timeLeft.m).padStart(2, '0')}
                    <span className="text-sm font-label-mono ml-1 text-on-surface-variant">m</span>
                  </div>
                  <div className="text-primary-container">:</div>
                  <div>
                    {String(timeLeft.s).padStart(2, '0')}
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

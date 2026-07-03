import { useState } from 'react'
import { useWallet } from '../midnight/WalletContext'
import { usePrivateState } from '../midnight/PrivateStateContext'
import { truncateAddress, detectWallets, type WalletInfo } from '../midnight/walletConnector'

const PROVING_NOT_SUPPORTED_MESSAGE =
  '此錢包尚未支援自動證明功能,請改用 1AM 錢包連線,或在本機啟動 Midnight proof server 並於錢包設定中指定位址'

type NavPage = 'home' | 'how-it-works' | 'about'

interface NavbarProps {
  activePage?: NavPage
  onNavigateHome?: () => void
  onNavigateHowItWorks?: () => void
  onNavigateAbout?: () => void
}

const ACTIVE_LINK_CLASS = 'font-label-mono text-label-mono text-primary font-bold border-b-2 border-primary pb-1'
const INACTIVE_LINK_CLASS =
  'font-label-mono text-label-mono text-on-surface-variant font-medium hover:text-primary transition-colors'

export default function Navbar({
  activePage = 'home',
  onNavigateHome,
  onNavigateHowItWorks,
  onNavigateAbout,
}: NavbarProps) {
  const { walletState, connect, disconnect } = useWallet()
  const { isUnlocked, lock } = usePrivateState()
  const [walletChoices, setWalletChoices] = useState<WalletInfo[] | null>(null)

  const handleConnectClick = () => {
    const detected = detectWallets()
    if (detected.length <= 1) {
      // Zero wallets: connect() still runs with the default hint so the existing
      // "no wallet detected" error message surfaces via walletState.status === 'error'.
      // Exactly one wallet: connect directly, no need to make the user pick.
      connect(detected[0]?.key)
      return
    }
    setWalletChoices(detected)
  }

  const handleChoose = (walletKey: string) => {
    setWalletChoices(null)
    connect(walletKey)
  }

  return (
    <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-margin-desktop h-20 bg-background/80 backdrop-blur-xl border-b border-outline-variant shadow-[0_0_20px_rgba(124,58,237,0.1)]">
      <div className="flex items-center gap-stack-md">
        <button
          type="button"
          onClick={() => onNavigateHome?.()}
          className="font-display-xl text-headline-md font-bold text-primary tracking-tight"
        >
          MIDNIGHT
        </button>
      </div>
      <nav className="hidden md:flex items-center gap-stack-lg">
        <a
          className={activePage === 'home' ? ACTIVE_LINK_CLASS : INACTIVE_LINK_CLASS}
          href="#auctions"
          onClick={() => onNavigateHome?.()}
        >
          Auctions
        </a>
        <a
          className={activePage === 'how-it-works' ? ACTIVE_LINK_CLASS : INACTIVE_LINK_CLASS}
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onNavigateHowItWorks?.()
          }}
        >
          How It Works
        </a>
        <a
          className={activePage === 'about' ? ACTIVE_LINK_CLASS : INACTIVE_LINK_CLASS}
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onNavigateAbout?.()
          }}
        >
          About
        </a>
      </nav>
      <div className="flex items-center gap-stack-md">
        {walletState.status === 'disconnected' && (
          <button
            type="button"
            onClick={handleConnectClick}
            className="bg-primary-container text-on-primary-container px-6 py-2 rounded-lg font-bold transition-all duration-300 ease-in-out active:scale-95 hover:bg-primary-container/90 shadow-[0_0_15px_rgba(124,58,237,0.4)]"
          >
            Connect Wallet
          </button>
        )}

        {walletState.status === 'connecting' && (
          <button
            type="button"
            disabled
            className="bg-primary-container/60 text-on-primary-container px-6 py-2 rounded-lg font-bold flex items-center gap-2 cursor-not-allowed"
          >
            <span className="w-4 h-4 border-2 border-on-primary-container/40 border-t-on-primary-container rounded-full animate-spin"></span>
            Connecting...
          </button>
        )}

        {walletState.status === 'connected' && (
          <div className="flex items-center gap-2">
            {!walletState.provingSupported && (
              <span
                title={PROVING_NOT_SUPPORTED_MESSAGE}
                className="font-label-mono text-xs text-error border border-error/50 rounded-lg px-3 py-2 max-w-xs truncate"
              >
                {PROVING_NOT_SUPPORTED_MESSAGE}
              </span>
            )}
            <div className="flex items-center gap-2 bg-surface-container px-4 py-2 rounded-lg border border-outline-variant">
              <span className="font-label-mono text-sm text-on-surface">
                {truncateAddress(walletState.address)} | {walletState.balance}
              </span>
              {isUnlocked && (
                <button
                  type="button"
                  onClick={() => lock()}
                  aria-label="Lock private state"
                  title="Lock private state"
                  className="text-on-surface-variant hover:text-primary transition-colors flex items-center"
                >
                  <span className="material-symbols-outlined text-base">lock_open</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => disconnect()}
                aria-label="Disconnect wallet"
                className="text-on-surface-variant hover:text-error transition-colors font-bold px-1"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {walletState.status === 'error' && (
          <button
            type="button"
            onClick={handleConnectClick}
            className="bg-error/10 text-error border border-error px-6 py-2 rounded-lg font-bold transition-all hover:bg-error/20"
          >
            Connection Failed
          </button>
        )}
      </div>

      {walletChoices && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setWalletChoices(null)}
        >
          <div
            className="bg-surface-container border border-outline-variant rounded-lg p-6 min-w-[280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <span className="font-bold text-on-surface">Choose a wallet</span>
              <button
                type="button"
                onClick={() => setWalletChoices(null)}
                aria-label="Close"
                className="text-on-surface-variant hover:text-error font-bold px-1"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {walletChoices.map((wallet) => (
                <button
                  key={wallet.key}
                  type="button"
                  onClick={() => handleChoose(wallet.key)}
                  className="flex items-center gap-3 bg-surface px-4 py-2 rounded-lg border border-outline-variant hover:border-primary transition-colors"
                >
                  <img src={wallet.icon} alt={wallet.name} className="w-6 h-6 rounded" />
                  <span className="font-label-mono text-sm text-on-surface">{wallet.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

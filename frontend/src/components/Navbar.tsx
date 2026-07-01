import { useWallet } from '../midnight/WalletContext'
import { truncateAddress } from '../midnight/walletConnector'

export default function Navbar() {
  const { walletState, connect, disconnect } = useWallet()

  return (
    <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-margin-desktop h-20 bg-background/80 backdrop-blur-xl border-b border-outline-variant shadow-[0_0_20px_rgba(124,58,237,0.1)]">
      <div className="flex items-center gap-stack-md">
        <span className="font-display-xl text-headline-md font-bold text-primary tracking-tight">MIDNIGHT</span>
      </div>
      <nav className="hidden md:flex items-center gap-stack-lg">
        <a
          className="font-label-mono text-label-mono text-primary font-bold border-b-2 border-primary pb-1"
          href="#auctions"
        >
          Auctions
        </a>
        <a
          className="font-label-mono text-label-mono text-on-surface-variant font-medium hover:text-primary transition-colors"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            alert('Coming soon')
          }}
        >
          How It Works
        </a>
        <a
          className="font-label-mono text-label-mono text-on-surface-variant font-medium hover:text-primary transition-colors"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            alert('Coming soon')
          }}
        >
          About
        </a>
      </nav>
      <div className="flex items-center gap-stack-md">
        {walletState.status === 'disconnected' && (
          <button
            type="button"
            onClick={() => connect()}
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
          <div className="flex items-center gap-2 bg-surface-container px-4 py-2 rounded-lg border border-outline-variant">
            <span className="font-label-mono text-sm text-on-surface">
              {truncateAddress(walletState.address)} | {walletState.balance}
            </span>
            <button
              type="button"
              onClick={() => disconnect()}
              aria-label="Disconnect wallet"
              className="text-on-surface-variant hover:text-error transition-colors font-bold px-1"
            >
              ×
            </button>
          </div>
        )}

        {walletState.status === 'error' && (
          <button
            type="button"
            onClick={() => connect()}
            className="bg-error/10 text-error border border-error px-6 py-2 rounded-lg font-bold transition-all hover:bg-error/20"
          >
            Connection Failed
          </button>
        )}
      </div>
    </header>
  )
}

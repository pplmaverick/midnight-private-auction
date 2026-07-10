import Navbar from '../components/Navbar'
import architectureDiagram from '../assets/architecture.svg'

const steps = [
  {
    number: '01',
    icon: 'account_balance_wallet',
    title: 'Connect Wallet',
    body: "Install the 1AM wallet extension and connect to Midnight mainnet. You'll need DUST (Midnight's native token) to place bids. Your bids are shielded at the protocol level — the network records only cryptographic commitments, never bid amounts or secret keys.",
  },
  {
    number: '02',
    icon: 'key',
    title: 'Set Privacy Password',
    body: 'On your first visit, set a site-specific password to encrypt your private bid records in this browser. This is separate from your 1AM wallet password. You will enter it once per session — all subsequent actions stay unlocked until you close the tab. If you forget your password, you can reset local storage and start over. Warning: If you reset your password before revealing an active bid, you will permanently lose access to that bid and cannot claim the item even if you placed the highest offer.',
  },
  {
    number: '03',
    icon: 'lock',
    title: 'Place Private Bid',
    body: 'Enter your bid amount. Your bid is sealed client-side into a cryptographic commitment before it leaves your browser — other bidders and the contract owner see only a 32-byte hash, never the amount.',
  },
  {
    number: '04',
    icon: 'verified',
    title: 'Reveal & Claim',
    body: "When the auction closes, submit your reveal to prove your bid. The contract verifies the ZK proof submitted by your browser to update the ledger state safely. The highest verified bid wins. Losers' bids remain private — no amounts are ever revealed on-chain.",
  },
]

const primitives = [
  {
    name: 'Compact language',
    body: "Midnight's TypeScript-based smart contract language that abstracts ZK proof generation",
  },
  {
    name: 'persistentHash',
    body: 'persistentHash("auction:seal:", sk, auctionId, amt, salt)',
  },
  {
    name: 'Private ledger state',
    body: 'secretKey, bidAmount, bidSalt never leave the bidder\'s device',
  },
  {
    name: 'Multi-auction architecture',
    body: 'single contract supports concurrent independent auctions; bidCount / highestBid / highestBidderPK are independent per auctionId',
  },
  {
    name: '@midnight-ntwrk/dapp-connector-api',
    body: 'connects to whichever wallet extension is installed (e.g. 1AM) via the CAIP-372 window.midnight provider, for transaction signing and DUST transfers',
  },
]

interface HowItWorksPageProps {
  onNavigateHome: () => void
  onNavigateAbout: () => void
}

export default function HowItWorksPage({ onNavigateHome, onNavigateAbout }: HowItWorksPageProps) {
  return (
    <div className="bg-[#0A0A0F] text-[#e4e1e9] font-body-md text-body-md selection:bg-primary/30 min-h-screen">
      <Navbar activePage="how-it-works" onNavigateHome={onNavigateHome} onNavigateAbout={onNavigateAbout} />
      <main className="pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-24">
          <h1 className="font-display-xl text-display-xl-mobile md:text-display-xl text-text-primary mb-stack-md">
            How It Works
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant">
            Four steps from wallet connection to a settled, privacy-preserving auction.
          </p>
        </div>

        <section className="mb-24">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter items-stretch">
            {steps.map((step, i) => (
              <div key={step.number} className="flex items-center">
                <div className="glass-card rounded-xl p-8 flex flex-col gap-4 h-full">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full border-2 border-primary bg-background flex items-center justify-center text-primary font-label-mono font-bold shrink-0 shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                      {step.number}
                    </div>
                    <span className="material-symbols-outlined text-primary text-3xl" data-weight="fill">
                      {step.icon}
                    </span>
                  </div>
                  <h3 className="font-headline-md text-headline-md text-text-primary">{step.title}</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">{step.body}</p>
                </div>
                {i < steps.length - 1 && <div className="stepper-line active hidden md:block w-8 shrink-0"></div>}
              </div>
            ))}
          </div>
        </section>

        <section className="mb-24">
          <h2 className="font-headline-md text-headline-md text-text-primary mb-stack-lg">Technical Architecture</h2>

          <div className="glass-panel rounded-xl p-4 md:p-8 mb-stack-lg overflow-x-auto">
            <img
              src={architectureDiagram}
              alt="Midnight Private Auction architecture diagram: the bidding phase shows a bidder's private state (secretKey, bidAmount, bidSalt) feeding a ZK proof into the public Midnight ledger as a persistentHash commitment; the reveal phase shows the bidder disclosing values, the ledger verifying the ZK proof, and updating the highest bid and winner."
              className="min-w-[600px] w-full"
            />
          </div>

          <ul className="flex flex-col gap-stack-md">
            {primitives.map((primitive) => (
              <li
                key={primitive.name}
                className="glass-card rounded-lg p-6 flex flex-col md:flex-row md:items-baseline gap-1 md:gap-4"
              >
                <span className="font-label-mono font-mono text-label-mono text-primary font-bold shrink-0 md:w-64">
                  {primitive.name}
                </span>
                <span
                  className={`font-body-md text-body-md text-on-surface-variant ${
                    primitive.name === 'persistentHash' ? 'font-mono' : ''
                  }`}
                >
                  {primitive.body}
                </span>
              </li>
            ))}
          </ul>
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

import Navbar from '../components/Navbar'

interface AboutPageProps {
  onNavigateHome: () => void
  onNavigateHowItWorks: () => void
}

export default function AboutPage({ onNavigateHome, onNavigateHowItWorks }: AboutPageProps) {
  return (
    <div className="bg-[#0A0A0F] text-[#e4e1e9] font-body-md text-body-md selection:bg-primary/30 min-h-screen">
      <Navbar onNavigateHome={onNavigateHome} onNavigateHowItWorks={onNavigateHowItWorks} />
      <main className="pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="font-display-xl text-display-xl-mobile md:text-display-xl text-text-primary mb-stack-lg">
            About
          </h1>

          <div className="glass-panel rounded-xl p-8 md:p-12 text-left flex flex-col gap-stack-md">
            <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
              Midnight Private Auction is an open-source sealed-bid auction protocol built natively on the Midnight
              blockchain.
            </p>
            <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
              Privacy is not an add-on — it is the base layer. Bids are shielded at the protocol level using
              Midnight's zero-knowledge private state, making this the first auction system where neither the
              auctioneer nor other participants can observe competing bids before reveal.
            </p>
            <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
              Built by an independent developer as part of Midnight's early mainnet developer community. Deployed
              within 3 months of mainnet launch.
            </p>
          </div>

          <div className="mt-stack-lg glass-card rounded-xl p-8 flex flex-col md:flex-row items-center justify-between gap-stack-md">
            <div className="flex items-center gap-4">
              <span className="material-symbols-outlined text-primary text-3xl">code</span>
              <div className="text-left">
                <span className="font-label-caps text-label-caps text-text-secondary uppercase block">Developer</span>
                <span className="font-label-mono text-label-mono text-text-primary">pplmaverick · Taiwan</span>
              </div>
            </div>
            <a
              href="https://github.com/pplmaverick/midnight-private-auction"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-primary-container text-on-primary-container px-6 py-3 rounded-lg font-bold transition-all duration-300 ease-in-out active:scale-95 hover:bg-primary-container/90 shadow-[0_0_15px_rgba(124,58,237,0.4)] flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">open_in_new</span>
              View on GitHub
            </a>
          </div>
        </div>
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

import Navbar from '../components/Navbar'

interface AboutPageProps {
  onNavigateHome: () => void
  onNavigateHowItWorks: () => void
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  )
}

const SOCIAL_LINK_CLASS =
  'flex-1 min-w-[140px] h-[52px] px-4 rounded-full font-semibold flex items-center justify-center gap-3 transition-all duration-300 ease-in-out active:scale-95'

const STAT_CARD_CLASS = 'rounded-xl border border-[rgba(139,92,246,0.4)] bg-[#1a1035] p-6 flex flex-col gap-1'

export default function AboutPage({ onNavigateHome, onNavigateHowItWorks }: AboutPageProps) {
  return (
    <div className="bg-[#0A0A0F] text-[#e4e1e9] font-body-md text-body-md selection:bg-primary/30 min-h-screen">
      <Navbar activePage="about" onNavigateHome={onNavigateHome} onNavigateHowItWorks={onNavigateHowItWorks} />
      <main className="pt-32 pb-20 px-margin-mobile md:px-margin-desktop max-w-container-max mx-auto">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="font-display-xl text-display-xl-mobile md:text-display-xl text-text-primary mb-stack-lg">
            About
          </h1>

          <div className="glass-panel rounded-xl p-8 md:p-12 text-left grid grid-cols-1 md:grid-cols-3 gap-gutter">
            <div className="md:col-span-2 flex flex-col gap-stack-md">
              <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
                Midnight Private Auction is an open-source{' '}
                <span className="text-[#a78bfa] font-semibold">sealed-bid auction protocol</span> built natively on
                the Midnight blockchain.
              </p>
              <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
                <span className="text-[#a78bfa] font-semibold text-xl">Privacy is not an add-on</span> — it is the
                base layer. Bids are shielded at the protocol level using Midnight's{' '}
                <span className="text-[#a78bfa] font-semibold">zero-knowledge private state</span>, making this the
                first auction system where neither the auctioneer nor other participants can observe competing bids
                before reveal.
              </p>
              <p className="font-body-lg text-body-lg text-on-surface-variant leading-relaxed">
                Built by an independent developer as part of Midnight's early mainnet developer community. Deployed
                within 3 months of mainnet launch.
              </p>
            </div>

            <div className="flex flex-col gap-stack-md">
              <div className={STAT_CARD_CLASS}>
                <span className="font-display-xl text-4xl font-bold text-[#a78bfa] leading-none">3</span>
                <span className="font-label-caps text-label-caps text-text-secondary uppercase mt-1">Months</span>
                <p className="font-body-md text-sm text-on-surface-variant mt-2 leading-snug">
                  Deployed within 3M of Mainnet Launch
                </p>
              </div>
              <div className={STAT_CARD_CLASS}>
                <span className="font-display-xl text-4xl font-bold text-[#a78bfa] leading-none">100%</span>
                <p className="font-body-md text-sm text-on-surface-variant mt-2 leading-snug">
                  Open-Source &amp; Client-Side Secure
                </p>
              </div>
            </div>
          </div>

          <div className="mt-stack-lg rounded-2xl border border-[rgba(139,92,246,0.3)] bg-[#1a1a2e] p-6 md:p-8 text-left flex flex-col gap-stack-lg">
            <div className="flex items-center gap-4">
              <span className="material-symbols-outlined text-primary text-3xl">code</span>
              <div>
                <span className="font-label-caps text-label-caps text-text-secondary uppercase block">Developer</span>
                <span className="font-label-mono text-label-mono text-text-primary">pplmaverick · Taiwan</span>
              </div>
            </div>

            <div className="flex flex-col gap-stack-sm">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">link</span>
                <span className="font-label-caps text-label-caps text-text-secondary uppercase">Official Links</span>
              </div>

              <div className="flex flex-row flex-wrap gap-2">
                <a
                  href="https://x.com/SmsmSmsm87"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${SOCIAL_LINK_CLASS} bg-black text-white hover:bg-neutral-900`}
                >
                  <XIcon />
                  X (Twitter)
                </a>
                <a
                  href="mailto:chiu69tw@gmail.com"
                  className={`${SOCIAL_LINK_CLASS} bg-white text-[#111111] hover:bg-gray-100`}
                >
                  <span className="material-symbols-outlined text-xl text-[#EA4335]">mail</span>
                  chiu69tw@gmail.com
                </a>
                <a
                  href="https://github.com/pplmaverick/midnight-private-auction"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${SOCIAL_LINK_CLASS} bg-[#7c3aed] text-white hover:bg-[#6d28d9]`}
                >
                  <GitHubIcon />
                  GitHub
                </a>
              </div>
            </div>
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

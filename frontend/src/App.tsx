import { useState } from 'react'
import HomePage from './pages/HomePage'
import AuctionDetailPage from './pages/AuctionDetailPage'
import HowItWorksPage from './pages/HowItWorksPage'
import AboutPage from './pages/AboutPage'
import ZKProofModal from './components/ZKProofModal'

type Page = 'home' | 'detail' | 'zk-modal' | 'how-it-works' | 'about'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [selectedAuctionId, setSelectedAuctionId] = useState<bigint | null>(null)

  return (
    <>
      {page === 'home' && (
        <HomePage
          onNavigateToDetail={(auctionId) => {
            setSelectedAuctionId(auctionId)
            setPage('detail')
          }}
          onNavigateHowItWorks={() => setPage('how-it-works')}
          onNavigateAbout={() => setPage('about')}
        />
      )}

      {page === 'how-it-works' && (
        <HowItWorksPage onNavigateHome={() => setPage('home')} onNavigateAbout={() => setPage('about')} />
      )}

      {page === 'about' && (
        <AboutPage onNavigateHome={() => setPage('home')} onNavigateHowItWorks={() => setPage('how-it-works')} />
      )}

      {(page === 'detail' || page === 'zk-modal') && selectedAuctionId !== null && (
        <div className={page === 'zk-modal' ? 'opacity-20 pointer-events-none transition-opacity duration-700' : ''}>
          <AuctionDetailPage
            auctionId={selectedAuctionId}
            onNavigateToZK={() => setPage('zk-modal')}
            onNavigateHome={() => setPage('home')}
            onNavigateHowItWorks={() => setPage('how-it-works')}
            onNavigateAbout={() => setPage('about')}
          />
        </div>
      )}

      {page === 'zk-modal' && <ZKProofModal onBack={() => setPage('detail')} />}
    </>
  )
}

import { useState } from 'react'
import HomePage from './pages/HomePage'
import AuctionDetailPage from './pages/AuctionDetailPage'
import ZKProofModal from './components/ZKProofModal'

type Page = 'home' | 'detail' | 'zk-modal'

export default function App() {
  const [page, setPage] = useState<Page>('home')

  return (
    <>
      {page === 'home' && <HomePage onNavigateToDetail={() => setPage('detail')} />}

      {page !== 'home' && (
        <div className={page === 'zk-modal' ? 'opacity-20 pointer-events-none transition-opacity duration-700' : ''}>
          <AuctionDetailPage onNavigateToZK={() => setPage('zk-modal')} />
        </div>
      )}

      {page === 'zk-modal' && <ZKProofModal onBack={() => setPage('detail')} />}
    </>
  )
}

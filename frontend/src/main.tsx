import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WalletProvider } from './midnight/WalletContext'
import { PrivateStateProvider } from './midnight/PrivateStateContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <PrivateStateProvider>
        <App />
      </PrivateStateProvider>
    </WalletProvider>
  </StrictMode>,
)

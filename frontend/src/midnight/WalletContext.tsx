import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { connectWallet, detectWallets, type WalletState, type WalletInfo } from './walletConnector'

interface WalletContextType {
  walletState: WalletState
  connect: () => Promise<void>
  disconnect: () => void
  availableWallets: WalletInfo[]
}

const WalletContext = createContext<WalletContextType | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({ status: 'disconnected' })
  const availableWallets = detectWallets()

  const connect = useCallback(async () => {
    setWalletState({ status: 'connecting' })
    try {
      const result = await connectWallet('lace')
      setWalletState({
        status: 'connected',
        api: result.api,
        address: result.address,
        balance: result.balance,
      })
    } catch (err) {
      setWalletState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [])

  const disconnect = useCallback(() => {
    setWalletState({ status: 'disconnected' })
  }, [])

  return (
    <WalletContext.Provider value={{ walletState, connect, disconnect, availableWallets }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}

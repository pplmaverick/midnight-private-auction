import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { connectWallet, detectWallets, type WalletState, type WalletInfo } from './walletConnector'

interface WalletContextType {
  walletState: WalletState
  connect: (walletHint?: string) => Promise<void>
  disconnect: () => void
  availableWallets: WalletInfo[]
}

const WalletContext = createContext<WalletContextType | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({ status: 'disconnected' })
  const availableWallets = detectWallets()

  const connect = useCallback(async (walletHint: string = 'lace') => {
    setWalletState({ status: 'connecting' })
    try {
      const result = await connectWallet(walletHint)
      setWalletState({
        status: 'connected',
        api: result.api,
        address: result.address,
        balance: result.balance,
        // getProvingProvider is declared on ConnectedAPI's type but not every wallet has
        // actually implemented it yet (confirmed: Lace lists it but calling it throws;
        // 1AM's works). A typeof check here — not a call — is enough to detect this
        // without risking an uncaught TypeError.
        provingSupported: typeof result.api.getProvingProvider === 'function',
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

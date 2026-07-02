import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { browserPrivateStateProvider } from './browserPrivateStateProvider'
import { useWallet } from './WalletContext'

interface PrivateStateContextType {
  isUnlocked: boolean
  lock: () => void
  // Resolves true once the user has successfully unlocked (or was already unlocked),
  // false if they cancelled the prompt. Callers should skip the private-state
  // operation when this resolves false.
  ensureUnlocked: () => Promise<boolean>
}

const PrivateStateContext = createContext<PrivateStateContextType | null>(null)

export function PrivateStateProvider({ children }: { children: ReactNode }) {
  const { walletState } = useWallet()
  const address = walletState.status === 'connected' ? walletState.address : null

  const provider = useMemo(() => {
    if (!address) return null
    return browserPrivateStateProvider({ accountId: address })
  }, [address])

  const [unlocked, setUnlocked] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const lock = useCallback(() => {
    provider?.lock()
    setUnlocked(false)
  }, [provider])

  const ensureUnlocked = useCallback((): Promise<boolean> => {
    if (!provider) return Promise.resolve(false)
    if (provider.isUnlocked()) return Promise.resolve(true)
    setError(null)
    setModalOpen(true)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
    })
  }, [provider])

  const handleSubmit = useCallback(
    async (password: string) => {
      if (!provider) return
      try {
        await provider.unlock(password)
        setUnlocked(true)
        setModalOpen(false)
        setError(null)
        resolveRef.current?.(true)
        resolveRef.current = null
      } catch {
        setError('Incorrect password')
      }
    },
    [provider],
  )

  const handleCancel = useCallback(() => {
    setModalOpen(false)
    setError(null)
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  return (
    <PrivateStateContext.Provider value={{ isUnlocked: unlocked, lock, ensureUnlocked }}>
      {children}
      {modalOpen && <UnlockModal onSubmit={handleSubmit} onCancel={handleCancel} error={error} />}
    </PrivateStateContext.Provider>
  )
}

export function usePrivateState() {
  const ctx = useContext(PrivateStateContext)
  if (!ctx) throw new Error('usePrivateState must be used within PrivateStateProvider')
  return ctx
}

function UnlockModal({
  onSubmit,
  onCancel,
  error,
}: {
  onSubmit: (password: string) => void
  onCancel: () => void
  error: string | null
}) {
  const [password, setPassword] = useState('')

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-surface-container border border-outline-variant rounded-lg p-6 min-w-[320px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-on-surface mb-4">Unlock Private State</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit(password)
          }}
        >
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 mb-2 font-label-mono text-on-surface focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container"
          />
          {error && <p className="text-error text-sm mb-2">{error}</p>}
          <div className="flex gap-2 justify-end mt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-primary-container text-on-primary-container font-bold hover:bg-primary-container/90 transition-colors"
            >
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

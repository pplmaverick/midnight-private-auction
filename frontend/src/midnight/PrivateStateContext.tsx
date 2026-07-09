import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PrivateStateProvider } from '@midnight-ntwrk/midnight-js-types'
import { browserPrivateStateProvider } from './browserPrivateStateProvider'
import { useWallet } from './WalletContext'

interface PrivateStateContextType {
  isUnlocked: boolean
  lock: () => void
  // Resolves true once the user has successfully unlocked (or was already unlocked),
  // false if they cancelled the prompt. Callers should skip the private-state
  // operation when this resolves false.
  ensureUnlocked: () => Promise<boolean>
  // The underlying provider, exposed so callers can pass it into buildAuctionProviders()
  // once unlocked. Null before the wallet is connected.
  provider: PrivateStateProvider | null
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
  const [isFirstTime, setIsFirstTime] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const lock = useCallback(() => {
    provider?.lock()
    setUnlocked(false)
  }, [provider])

  const ensureUnlocked = useCallback((): Promise<boolean> => {
    if (!provider) return Promise.resolve(false)
    if (provider.isUnlocked()) return Promise.resolve(true)
    setError(null)
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      void provider.hasCanary().then((hasExisting) => {
        setIsFirstTime(!hasExisting)
        setModalOpen(true)
      })
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Incorrect password'
        setError(msg)
      }
    },
    [provider],
  )

  const handleCancel = useCallback(() => {
    setModalOpen(false)
    setError(null)
    setShowResetConfirm(false)
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  const handleResetStorage = useCallback(async () => {
    if (!provider) return
    await provider.resetStorage()
    setUnlocked(false)
    setModalOpen(false)
    setShowResetConfirm(false)
    window.location.reload()
  }, [provider])

  return (
    <PrivateStateContext.Provider value={{ isUnlocked: unlocked, lock, ensureUnlocked, provider }}>
      {children}
      {modalOpen && (
        <UnlockModal
          isFirstTime={isFirstTime}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          error={error}
          showResetConfirm={showResetConfirm}
          onRequestReset={() => setShowResetConfirm(true)}
          onCancelReset={() => setShowResetConfirm(false)}
          onConfirmReset={handleResetStorage}
        />
      )}
    </PrivateStateContext.Provider>
  )
}

export function usePrivateState() {
  const ctx = useContext(PrivateStateContext)
  if (!ctx) throw new Error('usePrivateState must be used within PrivateStateProvider')
  return ctx
}

function UnlockModal({
  isFirstTime,
  onSubmit,
  onCancel,
  error,
  showResetConfirm,
  onRequestReset,
  onCancelReset,
  onConfirmReset,
}: {
  isFirstTime: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
  error: string | null
  showResetConfirm: boolean
  onRequestReset: () => void
  onCancelReset: () => void
  onConfirmReset: () => void
}) {
  const [password, setPassword] = useState('')

  const title = isFirstTime ? 'Set Your Privacy Password' : 'Unlock Your Privacy Vault'
  const description = isFirstTime
    ? 'This password encrypts your private bid records in this browser. It is separate from your 1AM wallet password. You will need it each time you use this site.'
    : 'Enter your privacy password to access your encrypted bid records.'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-surface-container border border-outline-variant rounded-lg p-6 min-w-[320px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-on-surface mb-2">{title}</h3>
        <p className="text-sm text-on-surface-variant mb-4">{description}</p>
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
          <button
            type="button"
            onClick={onRequestReset}
            className="text-sm text-outline hover:text-on-surface mt-2 underline"
          >
            Forgot password? Reset local storage
          </button>
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
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60"
          onClick={(e) => {
            e.stopPropagation()
            onCancelReset()
          }}
        >
          <div
            className="bg-surface-container border border-outline-variant rounded-lg p-6 min-w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-on-surface mb-4">Reset Privacy Storage</h3>
            <p className="text-sm text-on-surface-variant mb-4">
              ⚠️ This will permanently delete all encrypted bid records for this wallet in this browser. Any
              unrevealed bids will be lost. Are you sure?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onCancelReset}
                className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmReset}
                className="px-4 py-2 rounded-lg bg-error text-on-error font-bold hover:bg-error/90 transition-colors"
              >
                Reset & Start Over
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
import { ContractState } from '@midnight-ntwrk/compact-runtime'

// The Midnight-hosted indexer was shut down (2026-09-30). Reads now go through our own
// same-origin proxy (frontend/api/indexer.ts), which forwards GraphQL queries to the
// Blockfrost-hosted indexer and keeps the Blockfrost project_id server-side.
// indexerPublicDataProvider validates with `new URL(...)`, so the query URL must be absolute.
export const MAINNET_INDEXER = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/indexer`

// Placeholder only: the frontend never opens a subscription (graphql-ws connects lazily, on
// the first subscribe) — transaction confirmation (watchForTxData) polls over HTTP.
// `.invalid` is a reserved TLD that can never resolve, so nothing can connect by accident.
export const MAINNET_INDEXER_WS = 'wss://indexer-ws-unused.invalid/graphql/ws'

// Still used for the transaction flow (findDeployedContract / callTx via the MidnightProviders
// bundle in auctionProviders.ts). For plain reads, prefer readContractState below.
export const publicDataProvider = indexerPublicDataProvider(MAINNET_INDEXER, MAINNET_INDEXER_WS)

export type IndexerReadErrorKind = 'auth' | 'upstream' | 'network' | 'timeout' | 'graphql'

export class IndexerReadError extends Error {
  readonly kind: IndexerReadErrorKind
  readonly status: number | null
  constructor(kind: IndexerReadErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'IndexerReadError'
    this.kind = kind
    this.status = status
  }
}

// Same GraphQL document as midnight-js's CONTRACT_STATE_QUERY (latest state, no offset).
const CONTRACT_STATE_QUERY = `query CONTRACT_STATE_QUERY($address: HexEncoded!) {
  contractAction(address: $address) { state }
}`

// One-shot read with a hard timeout. indexerPublicDataProvider wraps every query in a
// RetryLink (5 attempts, exponential backoff up to 10s, not configurable), so when the
// indexer is down the UI would spin for ~15s before failing; this fails after one attempt so
// the page can show an error state and a Retry button quickly.
const READ_TIMEOUT_MS = 8_000

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

// Resolves null when no contract exists at the address; throws IndexerReadError on any
// failure to read, so callers can tell "nothing there" apart from "couldn't look".
export const readContractState = async (address: string): Promise<ContractState | null> => {
  let response: Response
  try {
    response = await fetch(MAINNET_INDEXER, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: CONTRACT_STATE_QUERY, variables: { address } }),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new IndexerReadError('timeout', 'The indexer did not respond in time.')
    }
    throw new IndexerReadError('network', 'Could not reach the indexer.')
  }

  if (response.status === 401 || response.status === 403) {
    throw new IndexerReadError('auth', 'The indexer rejected the request (authentication).', response.status)
  }
  if (!response.ok) {
    throw new IndexerReadError('upstream', `The indexer returned HTTP ${response.status}.`, response.status)
  }

  let payload: { data?: { contractAction?: { state?: string } | null }; errors?: unknown[] }
  try {
    payload = await response.json()
  } catch {
    throw new IndexerReadError('upstream', 'The indexer returned an unreadable response.', response.status)
  }
  if (payload.errors?.length) {
    throw new IndexerReadError('graphql', 'The indexer reported a query error.', response.status)
  }
  const state = payload.data?.contractAction?.state
  if (!state) return null
  return ContractState.deserialize(hexToBytes(state))
}

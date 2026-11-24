import { parseContractKeyLocation } from '@midnight-ntwrk/midnight-js-types'

// midnight-js 5.x (ledger 9) asks the ZK config provider — and the wallet's KeyMaterialProvider —
// for artifacts by *key location*, not by bare circuit id. The canonical grammar is defined in
// @midnight-ntwrk/compact-js `ContractKeyLocation.js` (re-exported by midnight-js-types):
//
//   contract:<64-hex contract address>/<circuit id>?vk=<64-hex SHA-256 of the deployed verifier key>
//
// The contract-internal call path still uses bare circuit ids (ZKConfigProvider.get(circuitId)), so
// both forms must resolve to the same files. Anything else is rejected with an error that never
// echoes the raw key (address and vk are redacted).

/** The circuits of the auction contract; each has /keys/<id>.prover, /keys/<id>.verifier, /zkir/<id>.bzkir. */
export const AUCTION_CIRCUITS = [
  'createAuction',
  'placeBid',
  'closeAuction',
  'revealBid',
  'finalizeAuction',
  'claimItem',
] as const
export type AuctionCircuit = (typeof AUCTION_CIRCUITS)[number]

export type ArtifactKind = 'prover' | 'verifier' | 'zkir'

export interface ResolvedKey {
  readonly circuitId: AuctionCircuit
  /** Present only for key-location input: lowercase hex SHA-256 the verifier key file must have. */
  readonly expectedVerifierKeyHash?: string
}

/** Safe-to-log form of a lookup key: long hex runs (address, vk hash) are replaced, length capped. */
export const redactLookupKey = (key: string): string =>
  key.replace(/[0-9a-fA-F]{16,}/g, '<hex>').slice(0, 120)

const isAuctionCircuit = (id: string): id is AuctionCircuit => (AUCTION_CIRCUITS as readonly string[]).includes(id)

/** Resolves a bare circuit id or a canonical key location to a known circuit (and the vk it pins). */
export const resolveLookupKey = (key: string): ResolvedKey => {
  if (key.startsWith('contract:')) {
    const parsed = parseContractKeyLocation(key)
    if (parsed === undefined) {
      throw new Error(
        `Malformed contract key location '${redactLookupKey(key)}' (expected contract:<address>/<circuit>?vk=<sha256>)`,
      )
    }
    if (!isAuctionCircuit(parsed.circuitId)) {
      throw new Error(`Unknown circuit '${parsed.circuitId}' in key location '${redactLookupKey(key)}'`)
    }
    return { circuitId: parsed.circuitId, expectedVerifierKeyHash: parsed.verifierKeyHash }
  }
  if (!isAuctionCircuit(key)) {
    throw new Error(`Unknown circuit or unsupported key '${redactLookupKey(key)}'`)
  }
  return { circuitId: key }
}

/** Static file path (relative to the site root / baseUrl) for one artifact of one circuit. */
export const artifactPath = (kind: ArtifactKind, circuitId: AuctionCircuit): string =>
  kind === 'zkir' ? `zkir/${circuitId}.bzkir` : `keys/${circuitId}.${kind}`

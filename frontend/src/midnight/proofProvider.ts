import { createProofProvider } from '@midnight-ntwrk/midnight-js-types'
import type { ConnectedAPI, KeyMaterialProvider } from '@midnight-ntwrk/dapp-connector-api'

// Delegates proving to the connected wallet instead of running a local proof server.
// connectorAPI.getProvingProvider() returns a circuit-level ProvingProvider (check/prove
// on serialized preimages) — createProofProvider (from midnight-js-types) is the same
// adapter midnight-js-http-client-proof-provider uses internally to lift that into the
// transaction-level ProofProvider (proveTx) that MidnightProviders.proofProvider expects.
export const buildProofProvider = async (
  connectorAPI: ConnectedAPI,
  keyMaterialProvider: KeyMaterialProvider,
) => {
  const provingProvider = await connectorAPI.getProvingProvider(keyMaterialProvider)
  return createProofProvider(provingProvider)
}

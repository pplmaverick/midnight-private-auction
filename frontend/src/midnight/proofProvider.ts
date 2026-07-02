import { createProofProvider } from '@midnight-ntwrk/midnight-js-types'
import type { ConnectedAPI, KeyMaterialProvider } from '@midnight-ntwrk/dapp-connector-api'

// Thrown when the connected wallet does not actually support proof generation.
// Some wallets (e.g. Lace) declare getProvingProvider on their type but throw a
// TypeError the moment it's called — a typeof check alone can't catch that, only
// calling it and observing the failure can.
export class ProvingNotSupportedError extends Error {
  constructor() {
    super(
      'Your wallet does not support ZK proof generation. Please use 1AM wallet, or configure a local proof server at Settings → Proving Server (e.g. http://127.0.0.1:6300).',
    )
    this.name = 'ProvingNotSupportedError'
  }
}

// Delegates proving to the connected wallet instead of running a local proof server.
// connectorAPI.getProvingProvider() returns a circuit-level ProvingProvider (check/prove
// on serialized preimages) — createProofProvider (from midnight-js-types) is the same
// adapter midnight-js-http-client-proof-provider uses internally to lift that into the
// transaction-level ProofProvider (proveTx) that MidnightProviders.proofProvider expects.
export const buildProofProvider = async (
  connectorAPI: ConnectedAPI,
  keyMaterialProvider: KeyMaterialProvider,
) => {
  let provingProvider
  try {
    provingProvider = await connectorAPI.getProvingProvider(keyMaterialProvider)
  } catch (err) {
    if (err instanceof TypeError) {
      throw new ProvingNotSupportedError()
    }
    throw err
  }
  return createProofProvider(provingProvider)
}

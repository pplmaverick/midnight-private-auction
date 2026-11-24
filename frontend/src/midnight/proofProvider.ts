import { createLedger9ProofProvider } from '@midnight-ntwrk/midnight-js-types'
import { resolveLookupKey } from './zkKeyLocation'
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
// on serialized preimages) — createLedger9ProofProvider (from midnight-js-types) is the same
// adapter midnight-js-http-client-proof-provider uses internally to lift that into the
// transaction-level ProofProvider (proveTx) that MidnightProviders.proofProvider expects.
// midnight-js 5.x renamed it createLedger9ProofProvider (v9-only, supportedEras: ['v9']).
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
  // ledger-v9's ProvingProvider additionally requires lookupKey(keyLocation) (key material for a
  // circuit); the DApp Connector's ProvingProvider only has check/prove. The wallet already asked
  // our KeyMaterialProvider for the same artifacts, so serve lookupKey from it too.
  const withLookupKey = {
    check: provingProvider.check.bind(provingProvider),
    prove: provingProvider.prove.bind(provingProvider),
    async lookupKey(keyLocation: string) {
      // keyLocation is `contract:<address>/<circuit>?vk=<sha256>` — KeyMaterialProvider (our
      // BrowserZkConfigProvider) resolves it to a circuit id and checks the vk. Protocol builtins
      // (`midnight/...`) are not ours: like midnight-js's own resolver, answer "no key material".
      if (!keyLocation.startsWith('contract:')) {
        try {
          resolveLookupKey(keyLocation)
        } catch {
          return undefined
        }
      }
      const [proverKey, verifierKey, ir] = await Promise.all([
        keyMaterialProvider.getProverKey(keyLocation),
        keyMaterialProvider.getVerifierKey(keyLocation),
        keyMaterialProvider.getZKIR(keyLocation),
      ])
      if (!proverKey || !verifierKey || !ir) return undefined
      return { proverKey, verifierKey, ir }
    },
  }
  return createLedger9ProofProvider(withLookupKey)
}

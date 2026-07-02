import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api'
import type {
  AnyProvableCircuitId,
  MidnightProviders,
  PrivateStateId,
  PrivateStateProvider,
} from '@midnight-ntwrk/midnight-js-types'
import { BrowserZkConfigProvider } from './browserZkConfigProvider'
import { publicDataProvider } from './publicDataProvider'
import { buildProofProvider } from './proofProvider'
import { createBrowserWalletAndMidnightProvider } from './walletProvider'

// Combines the five providers MidnightProviders needs into one object, the browser
// equivalent of src/api.ts's configureProviders() (Node CLI) — same five fields, but
// zkConfigProvider/proofProvider/walletProvider are backed by fetch()/the DApp Connector
// instead of NodeZkConfigProvider/httpClientProofProvider/a locally-held seed wallet.
export const buildAuctionProviders = async <
  PCK extends AnyProvableCircuitId = AnyProvableCircuitId,
  PSI extends PrivateStateId = PrivateStateId,
  PS = unknown,
>(
  connectedAPI: ConnectedAPI,
  privateStateProvider: PrivateStateProvider<PSI, PS>,
): Promise<MidnightProviders<PCK, PSI, PS>> => {
  // Not every wallet implements getProvingProvider yet (Lace lists it but throws when
  // called; 1AM's works — see WalletContext's `provingSupported` check). Fail with a
  // clear message here instead of letting buildProofProvider hit an uncaught TypeError.
  if (typeof connectedAPI.getProvingProvider !== 'function') {
    throw new Error('Connected wallet does not support proof generation (getProvingProvider missing). Try a different wallet, e.g. 1AM.')
  }

  const zkConfigProvider = new BrowserZkConfigProvider<PCK>()
  const proofProvider = await buildProofProvider(connectedAPI, zkConfigProvider)

  const walletAndMidnightProvider = createBrowserWalletAndMidnightProvider(connectedAPI)
  await walletAndMidnightProvider.initialize()

  return {
    zkConfigProvider,
    publicDataProvider,
    proofProvider,
    privateStateProvider,
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  }
}

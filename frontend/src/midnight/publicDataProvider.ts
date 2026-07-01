import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider'

// Mirrors src/config.ts's PreprodConfig/MainnetConfig indexer endpoints — same
// /api/v3/graphql query + subscription paths, just pointed at mainnet.
export const MAINNET_INDEXER = 'https://indexer.mainnet.midnight.network/api/v3/graphql'
export const MAINNET_INDEXER_WS = 'wss://indexer.mainnet.midnight.network/api/v3/graphql/ws'

// Same call shape as src/api.ts's configureProviders: indexerPublicDataProvider(config.indexer, config.indexerWS).
// No webSocketImpl override — isomorphic-ws resolves to the browser's native WebSocket at runtime.
export const publicDataProvider = indexerPublicDataProvider(MAINNET_INDEXER, MAINNET_INDEXER_WS)

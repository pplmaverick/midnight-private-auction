import path from 'node:path';
import type { NetworkId } from '@midnight-ntwrk/midnight-js-types';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const zkConfigPath = path.resolve(currentDir, '..', 'contract', 'src', 'managed', 'auction');

export const privateStateStoreName = 'auction-private-state';

export interface Config {
  // midnight-js 5.x removed the global setNetworkId(): the id now lives on the config and is
  // handed to the wallet and to providers.config.
  readonly networkId: NetworkId;
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

// RETIRED: these Midnight-hosted preprod endpoints now answer HTTP 410. Kept only so the existing
// scripts that import PreprodConfig still compile; do not use it. Use PreviewConfig (public,
// no token) or a Blockfrost-based Preprod config (needs a Preprod project token).
/** @deprecated endpoints retired (HTTP 410) */
export class PreprodConfig implements Config {
  networkId: NetworkId = 'preprod';
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod');
  indexer = 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';
}

// Preview: Midnight-hosted public network (ledger 9), no token needed. Used as the control group
// when diagnosing wallet-sync problems, and for deploy dry runs.
export class PreviewConfig implements Config {
  networkId: NetworkId = 'preview';
  logDir = path.resolve(currentDir, '..', 'logs', 'preview');
  indexer = 'https://indexer.preview.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
  node = 'https://rpc.preview.midnight.network';
  proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';
}

// The Midnight-hosted mainnet indexer/RPC were shut down (2026-09-30); mainnet traffic now
// goes through Blockfrost, which authenticates with a project_id. For the Node CLI (wallet
// SDK / graphql-ws, which cannot set custom headers) the project_id travels as a query
// parameter on each URL. It is read ONLY from the environment / the git-ignored .env.local —
// never hardcode it, and never log these URLs (they contain the token).
const BLOCKFROST_INDEXER = 'https://midnight-mainnet.blockfrost.io/api/v0';
const BLOCKFROST_INDEXER_WS = 'wss://midnight-mainnet.blockfrost.io/api/v0/ws';
const BLOCKFROST_NODE = 'https://rpc.midnight-mainnet.blockfrost.io';

// Loads <repo>/.env.local into process.env if it exists. Variables already exported in the
// shell win (loadEnvFile never overrides), so explicit exports still take precedence.
const loadLocalEnv = (): void => {
  try {
    process.loadEnvFile(path.resolve(currentDir, '..', '.env.local'));
  } catch {
    // no .env.local — fine, fall back to whatever is already exported
  }
};

export interface MainnetEndpoints {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
}

// Mainnet endpoint resolution: indexer (HTTP), indexer (WS) and node RPC ALL come from
// Blockfrost, authenticated by BLOCKFROST_PROJECT_ID (shell or .env.local). The old
// MIDNIGHT_INDEXER / MIDNIGHT_INDEXER_WS / MIDNIGHT_NODE overrides were removed on purpose:
// they pointed at the shut-down Midnight-hosted hosts, so a stale export in a shell would
// silently win over the working endpoint. (MIDNIGHT_DEPLOY_NODE — the private deploy RPC —
// is unrelated and still handled separately by the deploy scripts.)
export const resolveMainnetEndpoints = (): MainnetEndpoints => {
  loadLocalEnv();
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (!projectId) {
    throw new Error('Missing BLOCKFROST_PROJECT_ID: set it in .env.local (git-ignored) or the environment.');
  }
  const withToken = (base: string): string => `${base}?project_id=${encodeURIComponent(projectId)}`;
  return {
    indexer: withToken(BLOCKFROST_INDEXER),
    indexerWS: withToken(BLOCKFROST_INDEXER_WS),
    node: withToken(BLOCKFROST_NODE),
  };
};

// Mainnet config. Endpoints come from resolveMainnetEndpoints() above.
//   MIDNIGHT_PROOF_SERVER — local proof server (default: http://127.0.0.1:6300)
export class MainnetConfig implements Config {
  networkId: NetworkId = 'mainnet';
  logDir = path.resolve(currentDir, '..', 'logs', 'mainnet');
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  constructor() {
    const endpoints = resolveMainnetEndpoints();
    this.indexer = endpoints.indexer;
    this.indexerWS = endpoints.indexerWS;
    this.node = endpoints.node;
    this.proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';
  }
}

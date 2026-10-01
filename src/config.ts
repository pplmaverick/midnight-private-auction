import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js/network-id';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');

export const zkConfigPath = path.resolve(currentDir, '..', 'contract', 'src', 'managed', 'auction');

export const privateStateStoreName = 'auction-private-state';

export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export class PreprodConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'preprod');
  indexer = 'https://indexer.preprod.midnight.network/api/v4/graphql';
  indexerWS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
  node = 'https://rpc.preprod.midnight.network';
  proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';
  constructor() {
    setNetworkId('preprod');
  }
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
    setNetworkId('mainnet');
  }
}

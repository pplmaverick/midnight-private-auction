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

// Mainnet endpoints — set via environment variables before running.
// Required env vars:
//   MIDNIGHT_INDEXER         — e.g. https://indexer.midnight.network/api/v1/graphql
//   MIDNIGHT_INDEXER_WS      — e.g. wss://indexer.midnight.network/api/v1/graphql/ws
//   MIDNIGHT_NODE            — e.g. https://rpc.midnight.network
//   MIDNIGHT_PROOF_SERVER    — local proof server (default: http://127.0.0.1:6300)
export class MainnetConfig implements Config {
  logDir = path.resolve(currentDir, '..', 'logs', 'mainnet');
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  constructor() {
    const missingVars: string[] = [];
    if (!process.env.MIDNIGHT_INDEXER) missingVars.push('MIDNIGHT_INDEXER');
    if (!process.env.MIDNIGHT_INDEXER_WS) missingVars.push('MIDNIGHT_INDEXER_WS');
    if (!process.env.MIDNIGHT_NODE) missingVars.push('MIDNIGHT_NODE');
    if (missingVars.length > 0) {
      throw new Error(`Missing required env vars for mainnet: ${missingVars.join(', ')}`);
    }
    this.indexer = process.env.MIDNIGHT_INDEXER!;
    this.indexerWS = process.env.MIDNIGHT_INDEXER_WS!;
    this.node = process.env.MIDNIGHT_NODE!;
    this.proofServer = process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300';
    setNetworkId('mainnet');
  }
}

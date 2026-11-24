import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  hashVerifierKey,
} from '@midnight-ntwrk/midnight-js-types'
import { artifactPath, redactLookupKey, resolveLookupKey, type ArtifactKind } from './zkKeyLocation.js' // .js: also type-checked by the root (node16) tsconfig via src/test

// Mirrors @midnight-ntwrk/midnight-js-node-zk-config-provider's directory layout, but reads
// via fetch() instead of fs/promises so it can run in the browser against files served from
// frontend/public/. Same two subdirectories, same extensions (see artifactPath in ./zkKeyLocation):
//   {baseUrl}/zkir/{circuitId}.bzkir      → getZKIR
//   {baseUrl}/keys/{circuitId}.prover     → getProverKey
//   {baseUrl}/keys/{circuitId}.verifier   → getVerifierKey
export class BrowserZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(baseUrl: string = '', fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    super()
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
  }

  // The verifier key is fetched up to 4x per key location (vk check + prover/verifier/zkir calls);
  // keep one in-flight/finished fetch per circuit for the life of the provider (dropped on failure).
  private readonly verifierCache = new Map<string, Promise<Uint8Array>>()

  private fetchVerifier(circuitId: string): Promise<Uint8Array> {
    let p = this.verifierCache.get(circuitId)
    if (!p) {
      p = this.fetchFile(artifactPath('verifier', circuitId as never))
      this.verifierCache.set(circuitId, p)
      p.catch(() => this.verifierCache.delete(circuitId))
    }
    return p
  }

  private async fetchFile(path: string): Promise<Uint8Array> {
    const url = `${this.baseUrl}/${path}`
    const response = await this.fetchImpl(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  // `key` is either a bare circuit id (contract-internal path) or a midnight-js key location
  // `contract:<address>/<circuit>?vk=<sha256>` (the wallet's KeyMaterialProvider path and lookupKey).
  // It is resolved to a circuit id BEFORE any URL is built; for a key location the on-disk verifier
  // key must also hash to the pinned vk, for every artifact kind (prover, verifier and zkir alike),
  // so a stale cached/deployed file surfaces as a clear mismatch instead of a proof-server failure.
  private async fetchArtifact(kind: ArtifactKind, key: string): Promise<Uint8Array> {
    const { circuitId, expectedVerifierKeyHash } = resolveLookupKey(key)
    let verifierBytes: Uint8Array | undefined
    if (expectedVerifierKeyHash !== undefined) {
      verifierBytes = await this.fetchVerifier(circuitId)
      const actual = hashVerifierKey(verifierBytes)
      if (actual !== expectedVerifierKeyHash) {
        throw new Error(
          `Verifier key mismatch for circuit '${circuitId}' (key '${redactLookupKey(key)}'): ` +
            `served ${artifactPath('verifier', circuitId)} hashes to ${actual.slice(0, 16)}…, ` +
            `expected ${expectedVerifierKeyHash.slice(0, 16)}…. The deployed frontend files do not match the contract on-chain (stale build or browser cache?).`,
        )
      }
    }
    if (kind === 'verifier' && verifierBytes !== undefined) return verifierBytes
    return this.fetchFile(artifactPath(kind, circuitId))
  }

  // midnight-js 5.x places every contract on a ledger era by the `runtime-version` the compiler
  // recorded in compiler/contract-info.json (never inferred from the generated code), and every
  // contract operation asks the ZK config provider for it. The prebuild script publishes the
  // file at {baseUrl}/compiler/contract-info.json beside keys/ and zkir/.
  async getArtifactRuntimeVersion(): Promise<string> {
    const url = `${this.baseUrl}/compiler/contract-info.json`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
    }
    const info = (await response.json()) as { 'runtime-version'?: unknown }
    const version = info['runtime-version']
    if (typeof version !== 'string') {
      throw new Error(`${url} has no string "runtime-version" field`)
    }
    return version
  }

  async getZKIR(circuitId: K) {
    return createZKIR(await this.fetchArtifact('zkir', circuitId))
  }

  async getProverKey(circuitId: K) {
    return createProverKey(await this.fetchArtifact('prover', circuitId))
  }

  async getVerifierKey(circuitId: K) {
    return createVerifierKey(await this.fetchArtifact('verifier', circuitId))
  }
}

import { ZKConfigProvider, createProverKey, createVerifierKey, createZKIR } from '@midnight-ntwrk/midnight-js-types'

// Mirrors @midnight-ntwrk/midnight-js-node-zk-config-provider's directory layout, but reads
// via fetch() instead of fs/promises so it can run in the browser against files served from
// frontend/public/. Same two subdirectories, same extensions:
//   {baseUrl}/zkir/{circuitId}.bzkir      → getZKIR
//   {baseUrl}/keys/{circuitId}.prover     → getProverKey
//   {baseUrl}/keys/{circuitId}.verifier   → getVerifierKey
const KEY_DIR = 'keys'
const PROVER_EXT = '.prover'
const VERIFIER_EXT = '.verifier'
const ZKIR_DIR = 'zkir'
const ZKIR_EXT = '.bzkir'

export class BrowserZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  private readonly baseUrl: string

  constructor(baseUrl: string = '') {
    super()
    this.baseUrl = baseUrl
  }

  private async fetchBytes(subDir: string, circuitId: K, ext: string): Promise<Uint8Array> {
    const url = `${this.baseUrl}/${subDir}/${circuitId}${ext}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
    }
    const buffer = await response.arrayBuffer()
    return new Uint8Array(buffer)
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
    const bytes = await this.fetchBytes(ZKIR_DIR, circuitId, ZKIR_EXT)
    return createZKIR(bytes)
  }

  async getProverKey(circuitId: K) {
    const bytes = await this.fetchBytes(KEY_DIR, circuitId, PROVER_EXT)
    return createProverKey(bytes)
  }

  async getVerifierKey(circuitId: K) {
    const bytes = await this.fetchBytes(KEY_DIR, circuitId, VERIFIER_EXT)
    return createVerifierKey(bytes)
  }
}

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

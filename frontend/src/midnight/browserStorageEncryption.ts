// Mirrors @midnight-ntwrk/midnight-js-level-private-state-provider's storage-encryption.ts
// approach (PBKDF2 → AES-256-GCM, one salt per store, non-extractable derived key) but uses
// Web Crypto (window.crypto.subtle) instead of Node's crypto module — no extra dependency.
// AES-GCM via SubtleCrypto appends the auth tag to the ciphertext automatically, so unlike
// the Node version there's no manual IV/tag-splitting bookkeeping.

export const SALT_LENGTH = 32 // bytes
const IV_LENGTH = 12 // bytes — standard AES-GCM nonce size
const PBKDF2_ITERATIONS = 600_000 // matches midnight-js-level-private-state-provider's current version
const AES_KEY_LENGTH = 256 // bits, AES-256

export const generateSalt = (): Uint8Array => crypto.getRandomValues(new Uint8Array(SALT_LENGTH))

export const deriveAesKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const passwordKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false, // non-extractable: this CryptoKey can't be read back out via subtle.exportKey
    ['encrypt', 'decrypt'],
  )
}

export interface EncryptedRecord {
  readonly iv: Uint8Array
  readonly ciphertext: Uint8Array // AES-GCM output; auth tag is already appended
}

// BigInt/Uint8Array-safe JSON. AuctionPrivateState has both (bidAmount: bigint,
// secretKey/bidSalt: Uint8Array) and plain JSON.stringify throws on BigInt. Hand-rolled
// instead of pulling in a library (e.g. superjson) per the no-extra-dependency constraint.
const BIGINT_TAG = '__bigint__'
const BYTES_TAG = '__bytes__'

const replacer = (_key: string, value: unknown): unknown => {
  if (typeof value === 'bigint') return { [BIGINT_TAG]: value.toString() }
  if (value instanceof Uint8Array) return { [BYTES_TAG]: Array.from(value) }
  return value
}

const reviver = (_key: string, value: unknown): unknown => {
  if (value && typeof value === 'object') {
    if (BIGINT_TAG in value) return BigInt((value as Record<string, string>)[BIGINT_TAG])
    if (BYTES_TAG in value) return new Uint8Array((value as Record<string, number[]>)[BYTES_TAG])
  }
  return value
}

export const encryptValue = async (value: unknown, key: CryptoKey): Promise<EncryptedRecord> => {
  const plaintext = new TextEncoder().encode(JSON.stringify(value, replacer))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))
  return { iv, ciphertext }
}

// Throws — does not return null/undefined — when decryption/authentication fails (e.g. wrong
// password derived a different key). subtle.decrypt verifies the GCM auth tag internally and
// rejects with OperationError on mismatch; that rejection propagates to the caller unchanged,
// matching PrivateStateProvider.get's documented "decryption errors are not collapsed to null".
export const decryptValue = async <T>(record: EncryptedRecord, key: CryptoKey): Promise<T> => {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv as BufferSource },
    key,
    record.ciphertext as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plaintext), reviver) as T
}

// ─── hex / string encoding for the portable export/import format ────────────
// PrivateStateExport.salt is documented as hex (32 bytes / 64 chars);
// encryptedPayload is a single string, so the iv+ciphertext record is packed into one
// base64 blob for that path (as opposed to the two-field EncryptedRecord used for
// day-to-day IndexedDB storage, where separate fields are simpler to store directly).

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

export const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

export const encodeRecordToString = (record: EncryptedRecord): string => {
  const combined = new Uint8Array(record.iv.length + record.ciphertext.length)
  combined.set(record.iv, 0)
  combined.set(record.ciphertext, record.iv.length)
  return btoa(String.fromCharCode(...combined))
}

export const decodeRecordFromString = (encoded: string): EncryptedRecord => {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  return { iv: combined.slice(0, IV_LENGTH), ciphertext: combined.slice(IV_LENGTH) }
}

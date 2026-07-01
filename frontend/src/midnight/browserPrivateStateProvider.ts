import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime'
import {
  MAX_EXPORT_SIGNING_KEYS,
  MAX_EXPORT_STATES,
  type ExportPrivateStatesOptions,
  type ExportSigningKeysOptions,
  type ImportPrivateStatesOptions,
  type ImportPrivateStatesResult,
  type ImportSigningKeysOptions,
  type ImportSigningKeysResult,
  type PrivateStateExport,
  type PrivateStateId,
  type PrivateStateProvider,
  type SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types'
import {
  bytesToHex,
  decodeRecordFromString,
  decryptValue,
  deriveAesKey,
  encodeRecordToString,
  encryptValue,
  generateSalt,
  hexToBytes,
  type EncryptedRecord,
} from './browserStorageEncryption'

// Mirrors @midnight-ntwrk/midnight-js-level-private-state-provider's method logic
// (scoped keys, setContractAddress guard, get-returns-null-on-miss, conflict-strategy
// handling in import, one PBKDF2-derived key per store) but swaps LevelDB for IndexedDB.
//
// IndexedDB constraint that LevelDB doesn't have: object stores can only be created
// during a versioned onupgradeneeded migration, not dynamically at runtime. LevelDB's
// per-account "sublevel" has no IndexedDB equivalent, so account scoping happens by
// prefixing the KEY instead of by creating a separate store per account.
//
// Session unlock model: unlike the Node provider's privateStoragePasswordProvider
// callback (asked on every operation), the browser provider asks for the password once
// via unlock(password), derives the two AES-256-GCM keys (one per store — same as the
// Node version deriving separately per LevelDB sublevel), and keeps only the derived
// CryptoKey objects in memory (never the password, never on disk). lock() drops them;
// closing/reloading the tab drops them implicitly since they're plain module state.

const DB_NAME = 'midnight-private-state'
const DB_VERSION = 1
const PRIVATE_STATE_STORE = 'private-states'
const SIGNING_KEY_STORE = 'signing-keys'
const ACCOUNT_HASH_LENGTH = 32
const SALT_KEY_SUFFIX = '__salt__'

export class PrivateStateLockedError extends Error {
  constructor() {
    super('Private state storage is locked. Call unlock(password) before accessing private state.')
    this.name = 'PrivateStateLockedError'
  }
}

// ─── IndexedDB primitives ────────────────────────────────────────────────────

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PRIVATE_STATE_STORE)) db.createObjectStore(PRIVATE_STATE_STORE)
      if (!db.objectStoreNames.contains(SIGNING_KEY_STORE)) db.createObjectStore(SIGNING_KEY_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const runRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const idbGet = async <T>(storeName: string, key: string): Promise<T | undefined> => {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readonly')
    return await runRequest<T>(tx.objectStore(storeName).get(key))
  } finally {
    db.close()
  }
}

const idbPut = async (storeName: string, key: string, value: unknown): Promise<void> => {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readwrite')
    await runRequest(tx.objectStore(storeName).put(value, key))
  } finally {
    db.close()
  }
}

const idbDelete = async (storeName: string, key: string): Promise<void> => {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readwrite')
    await runRequest(tx.objectStore(storeName).delete(key))
  } finally {
    db.close()
  }
}

const prefixRange = (prefix: string): IDBKeyRange => IDBKeyRange.bound(prefix, prefix + '￿')
const isSaltKey = (key: string): boolean => key.endsWith(SALT_KEY_SUFFIX)

const idbDeleteByPrefix = async (storeName: string, prefix: string): Promise<void> => {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor(prefixRange(prefix))
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          if (!isSaltKey(String(cursor.key))) cursor.delete()
          cursor.continue()
        } else {
          resolve()
        }
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
  } finally {
    db.close()
  }
}

const idbGetAllByPrefix = async <T>(storeName: string, prefix: string): Promise<Map<string, T>> => {
  const db = await openDb()
  try {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const result = new Map<string, T>()
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor(prefixRange(prefix))
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          if (!isSaltKey(String(cursor.key))) result.set(String(cursor.key), cursor.value as T)
          cursor.continue()
        } else {
          resolve()
        }
      }
      cursorReq.onerror = () => reject(cursorReq.error)
    })
    return result
  } finally {
    db.close()
  }
}

// ─── Account scoping ─────────────────────────────────────────────────────────

const hashAccountId = async (accountId: string): Promise<string> => {
  const data = new TextEncoder().encode(accountId)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, ACCOUNT_HASH_LENGTH)
}

// One salt per (account, store) — not secret, lives alongside the data it protects.
// Matches the Node provider's per-sublevel salt, which is likewise per-account-per-store.
const getOrCreateSalt = async (storeName: string, accountHash: string): Promise<Uint8Array> => {
  const key = `${accountHash}:${SALT_KEY_SUFFIX}`
  const existing = await idbGet<Uint8Array>(storeName, key)
  if (existing) return existing
  const salt = generateSalt()
  await idbPut(storeName, key, salt)
  return salt
}

interface PrivateStatePayload<PSI extends PrivateStateId = PrivateStateId> {
  readonly version: number
  readonly exportedAt: string
  readonly stateCount: number
  readonly states: Record<PSI, unknown>
}

interface SigningKeyPayload {
  readonly version: number
  readonly exportedAt: string
  readonly keyCount: number
  readonly keys: Record<ContractAddress, SigningKey>
}

const CURRENT_EXPORT_VERSION = 1

// ─── Provider ────────────────────────────────────────────────────────────────

export interface BrowserPrivateStateProviderConfig {
  readonly accountId: string
}

export const browserPrivateStateProvider = <PSI extends PrivateStateId, PS = unknown>(
  config: BrowserPrivateStateProviderConfig,
): PrivateStateProvider<PSI, PS> & {
  unlock(password: string): Promise<void>
  lock(): void
  isUnlocked(): boolean
} => {
  if (!config.accountId || config.accountId.trim().length === 0) {
    throw new Error('accountId is required to scope storage and prevent cross-account data access.')
  }

  let contractAddress: ContractAddress | null = null
  const accountHashPromise = hashAccountId(config.accountId)

  // Session-only key cache. Never the password, never persisted — see module-level comment.
  let privateStateKey: CryptoKey | null = null
  let signingKeyKey: CryptoKey | null = null

  const requireUnlocked = (key: CryptoKey | null): CryptoKey => {
    if (key === null) throw new PrivateStateLockedError()
    return key
  }

  const getScopedStateKey = async (privateStateId: PSI): Promise<string> => {
    if (contractAddress === null) {
      throw new Error('Contract address not set. Call setContractAddress() before accessing private state.')
    }
    const accountHash = await accountHashPromise
    return `${accountHash}:${contractAddress}:${privateStateId}`
  }

  const getScopedSigningKeyKey = async (address: ContractAddress): Promise<string> => {
    const accountHash = await accountHashPromise
    return `${accountHash}:${address}`
  }

  return {
    async unlock(password: string): Promise<void> {
      const accountHash = await accountHashPromise
      const [privateStateSalt, signingKeySalt] = await Promise.all([
        getOrCreateSalt(PRIVATE_STATE_STORE, accountHash),
        getOrCreateSalt(SIGNING_KEY_STORE, accountHash),
      ])
      const [derivedPrivateStateKey, derivedSigningKeyKey] = await Promise.all([
        deriveAesKey(password, privateStateSalt),
        deriveAesKey(password, signingKeySalt),
      ])
      privateStateKey = derivedPrivateStateKey
      signingKeyKey = derivedSigningKeyKey
    },

    lock(): void {
      privateStateKey = null
      signingKeyKey = null
    },

    isUnlocked(): boolean {
      return privateStateKey !== null && signingKeyKey !== null
    },

    setContractAddress(address: ContractAddress): void {
      contractAddress = address
    },

    async get(privateStateId: PSI): Promise<PS | null> {
      const key = requireUnlocked(privateStateKey)
      const storageKey = await getScopedStateKey(privateStateId)
      const stored = await idbGet<EncryptedRecord>(PRIVATE_STATE_STORE, storageKey)
      if (stored === undefined) return null
      const value = await decryptValue<PS>(stored, key)
      return value === undefined ? null : value
    },

    async set(privateStateId: PSI, state: PS): Promise<void> {
      const key = requireUnlocked(privateStateKey)
      const storageKey = await getScopedStateKey(privateStateId)
      const record = await encryptValue(state, key)
      await idbPut(PRIVATE_STATE_STORE, storageKey, record)
    },

    async remove(privateStateId: PSI): Promise<void> {
      requireUnlocked(privateStateKey)
      const storageKey = await getScopedStateKey(privateStateId)
      await idbDelete(PRIVATE_STATE_STORE, storageKey)
    },

    async clear(): Promise<void> {
      requireUnlocked(privateStateKey)
      if (contractAddress === null) {
        throw new Error('Contract address not set. Call setContractAddress() before accessing private state.')
      }
      // Matches the Node provider's actual behavior: clears ALL contracts' private
      // states for this account, not just the current contractAddress.
      const accountHash = await accountHashPromise
      await idbDeleteByPrefix(PRIVATE_STATE_STORE, `${accountHash}:`)
    },

    async setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      const key = requireUnlocked(signingKeyKey)
      const storageKey = await getScopedSigningKeyKey(address)
      const record = await encryptValue(signingKey, key)
      await idbPut(SIGNING_KEY_STORE, storageKey, record)
    },

    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      const key = requireUnlocked(signingKeyKey)
      const storageKey = await getScopedSigningKeyKey(address)
      const stored = await idbGet<EncryptedRecord>(SIGNING_KEY_STORE, storageKey)
      if (stored === undefined) return null
      const value = await decryptValue<SigningKey>(stored, key)
      return value === undefined ? null : value
    },

    async removeSigningKey(address: ContractAddress): Promise<void> {
      requireUnlocked(signingKeyKey)
      const storageKey = await getScopedSigningKeyKey(address)
      await idbDelete(SIGNING_KEY_STORE, storageKey)
    },

    async clearSigningKeys(): Promise<void> {
      requireUnlocked(signingKeyKey)
      const accountHash = await accountHashPromise
      await idbDeleteByPrefix(SIGNING_KEY_STORE, `${accountHash}:`)
    },

    // Export/import intentionally do NOT use the session-unlocked key — they take an
    // explicit, one-off password each time (per the decision to use PBKDF2 + a
    // user-chosen password for backup, independent of the day-to-day session key).
    async exportPrivateStates(options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      if (contractAddress === null) {
        throw new Error('Contract address not set. Call setContractAddress() before exporting private states.')
      }
      if (!options?.password) {
        throw new Error('exportPrivateStates requires options.password (no ambient storage password in this provider).')
      }
      const maxStates = options.maxStates ?? MAX_EXPORT_STATES

      const accountHash = await accountHashPromise
      const prefix = `${accountHash}:${contractAddress}:`
      const allEntries = await idbGetAllByPrefix<EncryptedRecord>(PRIVATE_STATE_STORE, prefix)
      const readKey = requireUnlocked(privateStateKey)

      const states: Record<string, unknown> = {}
      let count = 0
      for (const [scopedKey, record] of allEntries.entries()) {
        const rawStateId = scopedKey.slice(prefix.length)
        states[rawStateId] = await decryptValue(record, readKey)
        count++
      }

      if (count === 0) throw new Error('No private states to export')
      if (count > maxStates) throw new Error(`Too many states to export (${count}). Maximum allowed: ${maxStates}`)

      const payload: PrivateStatePayload<PSI> = {
        version: CURRENT_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        stateCount: count,
        states: states as Record<PSI, unknown>,
      }

      const exportSalt = generateSalt()
      const exportKey = await deriveAesKey(options.password, exportSalt)
      const record = await encryptValue(payload, exportKey)

      return {
        format: 'midnight-private-state-export',
        encryptedPayload: encodeRecordToString(record),
        salt: bytesToHex(exportSalt),
      }
    },

    async importPrivateStates(
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      if (contractAddress === null) {
        throw new Error('Contract address not set. Call setContractAddress() before importing private states.')
      }
      if (exportData.format !== 'midnight-private-state-export') {
        throw new Error('Unrecognized export format')
      }
      if (!options?.password) {
        throw new Error('importPrivateStates requires options.password.')
      }

      const conflictStrategy = options.conflictStrategy ?? 'error'
      const maxStates = options.maxStates ?? MAX_EXPORT_STATES

      const importSalt = hexToBytes(exportData.salt)
      const importKey = await deriveAesKey(options.password, importSalt)
      // Wrong password surfaces here: decryptValue's AES-GCM auth-tag check throws.
      const payload = await decryptValue<PrivateStatePayload<PSI>>(
        decodeRecordFromString(exportData.encryptedPayload),
        importKey,
      )
      const stateIds = Object.keys(payload.states) as PSI[]

      if (stateIds.length !== payload.stateCount) throw new Error('Export payload state count mismatch')
      if (stateIds.length > maxStates) {
        throw new Error(`Too many states in export (${stateIds.length}). Maximum allowed: ${maxStates}`)
      }

      if (conflictStrategy === 'error') {
        let conflictCount = 0
        for (const stateId of stateIds) {
          if ((await this.get(stateId)) !== null) conflictCount++
        }
        if (conflictCount > 0) throw new Error(`${conflictCount} state(s) already exist`)
      }

      let imported = 0
      let skipped = 0
      let overwritten = 0
      for (const stateId of stateIds) {
        const existing = await this.get(stateId)
        if (existing !== null) {
          if (conflictStrategy === 'skip') {
            skipped++
            continue
          }
          if (conflictStrategy === 'overwrite') overwritten++
        }
        await this.set(stateId, payload.states[stateId] as PS)
        if (existing === null) imported++
      }

      return { imported, skipped, overwritten }
    },

    async exportSigningKeys(options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      if (!options?.password) {
        throw new Error('exportSigningKeys requires options.password.')
      }
      const maxKeys = options.maxKeys ?? MAX_EXPORT_SIGNING_KEYS
      const accountHash = await accountHashPromise
      const prefix = `${accountHash}:`
      const allEntries = await idbGetAllByPrefix<EncryptedRecord>(SIGNING_KEY_STORE, prefix)
      const readKey = requireUnlocked(signingKeyKey)

      const keys: Record<string, SigningKey> = {}
      let count = 0
      for (const [scopedKey, record] of allEntries.entries()) {
        const address = scopedKey.slice(prefix.length)
        keys[address] = await decryptValue(record, readKey)
        count++
      }

      if (count === 0) throw new Error('No signing keys to export')
      if (count > maxKeys) throw new Error(`Too many keys to export (${count}). Maximum allowed: ${maxKeys}`)

      const payload: SigningKeyPayload = {
        version: CURRENT_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        keyCount: count,
        keys: keys as Record<ContractAddress, SigningKey>,
      }

      const exportSalt = generateSalt()
      const exportKey = await deriveAesKey(options.password, exportSalt)
      const record = await encryptValue(payload, exportKey)

      return {
        format: 'midnight-signing-key-export',
        encryptedPayload: encodeRecordToString(record),
        salt: bytesToHex(exportSalt),
      }
    },

    async importSigningKeys(
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      if (exportData.format !== 'midnight-signing-key-export') {
        throw new Error('Unrecognized export format')
      }
      if (!options?.password) {
        throw new Error('importSigningKeys requires options.password.')
      }

      const conflictStrategy = options.conflictStrategy ?? 'error'
      const maxKeys = options.maxKeys ?? MAX_EXPORT_SIGNING_KEYS

      const importSalt = hexToBytes(exportData.salt)
      const importKey = await deriveAesKey(options.password, importSalt)
      const payload = await decryptValue<SigningKeyPayload>(
        decodeRecordFromString(exportData.encryptedPayload),
        importKey,
      )
      const addresses = Object.keys(payload.keys) as ContractAddress[]

      if (addresses.length !== payload.keyCount) throw new Error('Export payload key count mismatch')
      if (addresses.length > maxKeys) {
        throw new Error(`Too many keys in export (${addresses.length}). Maximum allowed: ${maxKeys}`)
      }

      if (conflictStrategy === 'error') {
        let conflictCount = 0
        for (const address of addresses) {
          if ((await this.getSigningKey(address)) !== null) conflictCount++
        }
        if (conflictCount > 0) throw new Error(`${conflictCount} signing key(s) already exist`)
      }

      let imported = 0
      let skipped = 0
      let overwritten = 0
      for (const address of addresses) {
        const existing = await this.getSigningKey(address)
        if (existing !== null) {
          if (conflictStrategy === 'skip') {
            skipped++
            continue
          }
          if (conflictStrategy === 'overwrite') overwritten++
        }
        await this.setSigningKey(address, payload.keys[address])
        if (existing === null) imported++
      }

      return { imported, skipped, overwritten }
    },
  }
}

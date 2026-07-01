import { Buffer } from 'buffer'

// wallet-sdk-address-format references the Node global `Buffer` directly (no import of
// its own) — same gap found during stage-1 encoding verification. Idempotent check: safe
// to repeat in multiple entry files since it only assigns if not already present.
if (typeof window !== 'undefined' && !(window as unknown as { Buffer?: unknown }).Buffer) {
  ;(window as unknown as { Buffer: unknown }).Buffer = Buffer
}

import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api'
import { Transaction, type CoinPublicKey, type EncPublicKey, type FinalizedTransaction, type TransactionId } from '@midnight-ntwrk/midnight-js-protocol/ledger'
import type { MidnightProvider, UnboundTransaction, WalletProvider } from '@midnight-ntwrk/midnight-js-types'
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format'

// Combines WalletProvider + MidnightProvider into one object, mirroring the Node CLI's
// createWalletAndMidnightProvider (src/api.ts) — same two interfaces, backed by the
// DApp Connector API instead of a locally-held WalletFacade + seed.

export class WalletNotReadyError extends Error {
  constructor() {
    super('Wallet public keys not initialized — call initialize() once after connecting, before using this provider.')
    this.name = 'WalletNotReadyError'
  }
}

// TransactionId per MidnightProviders.midnightProvider.submitTx: use identifiers()[0], not
// transactionHash() — see stage-2 validation C. transactionHash() is explicitly documented
// as unsuitable for tracking a specific transaction because transactions can be merged;
// identifiers() entries are documented as safe for exactly that purpose. Our contract calls
// are always single-intent (no merging), so identifiers()[0] is the one that matters.
const getTransactionId = (tx: FinalizedTransaction): TransactionId => {
  const [transactionId] = tx.identifiers()
  if (!transactionId) {
    throw new Error('Finalized transaction has no identifiers — nothing to submit')
  }
  return transactionId
}

export const createBrowserWalletAndMidnightProvider = (
  connectorAPI: ConnectedAPI,
): WalletProvider & MidnightProvider & { initialize(): Promise<void> } => {
  // Session-cached, populated once by initialize() right after connect() resolves — see
  // stage-2 validation B. getCoinPublicKey()/getEncryptionPublicKey() must be synchronous
  // per the WalletProvider interface, so there is no room to await the connector call here.
  let coinPublicKeyHex: CoinPublicKey | null = null
  let encryptionPublicKeyHex: EncPublicKey | null = null

  return {
    async initialize(): Promise<void> {
      const addresses = await connectorAPI.getShieldedAddresses()
      // Bech32m -> raw hex, same conversion validated in stage 1 (32-byte data, matches
      // what the Node CLI's ShieldedCoinPublicKey.toHexString() already produces and feeds
      // into this exact interface in production).
      coinPublicKeyHex = MidnightBech32m.parse(addresses.shieldedCoinPublicKey).data.toString('hex')
      encryptionPublicKeyHex = MidnightBech32m.parse(addresses.shieldedEncryptionPublicKey).data.toString('hex')
    },

    getCoinPublicKey(): CoinPublicKey {
      if (coinPublicKeyHex === null) throw new WalletNotReadyError()
      return coinPublicKeyHex
    },

    getEncryptionPublicKey(): EncPublicKey {
      if (encryptionPublicKeyHex === null) throw new WalletNotReadyError()
      return encryptionPublicKeyHex
    },

    async balanceTx(tx: UnboundTransaction, ttl?: Date): Promise<FinalizedTransaction> {
      // TODO(ttl): dapp-connector-api's balanceUnsealedTransaction has no ttl parameter —
      // the wallet applies its own default TTL internally. Caller-supplied ttl is currently
      // dropped; revisit if a specific TTL ever becomes load-bearing.
      void ttl

      const serializedHex = Buffer.from(tx.serialize()).toString('hex')
      const { tx: balancedHex } = await connectorAPI.balanceUnsealedTransaction(serializedHex)
      const balancedBytes = Buffer.from(balancedHex, 'hex')
      return Transaction.deserialize('signature', 'proof', 'binding', balancedBytes)
    },

    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      const transactionId = getTransactionId(tx)
      const serializedHex = Buffer.from(tx.serialize()).toString('hex')
      await connectorAPI.submitTransaction(serializedHex)
      return transactionId
    },
  }
}

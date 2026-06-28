/**
 * Offline address derivation — no network connection required.
 *
 * Usage:
 *   WALLET_SEED=<hex-seed> MIDNIGHT_NETWORK=mainnet \
 *     node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm src/derive-address.ts
 *
 * Prints the unshielded (cNIGHT receiving) address and the shielded address.
 */

import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  DustAddress,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Buffer } from 'buffer';

const network = (process.env.MIDNIGHT_NETWORK ?? 'preprod') as 'mainnet' | 'preprod';
setNetworkId(network);

const seed = process.env.WALLET_SEED;
if (!seed) {
  console.error('Error: WALLET_SEED env var is required.');
  process.exit(1);
}
if (!/^[0-9a-fA-F]+$/.test(seed)) {
  console.error('Error: WALLET_SEED must be a hex string.');
  process.exit(1);
}

const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
if (hdWallet.type !== 'seedOk') {
  console.error('Error: Failed to initialize HDWallet from seed.');
  process.exit(1);
}

const result = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);

if (result.type !== 'keysDerived') {
  console.error('Error: Failed to derive keys from seed.');
  process.exit(1);
}

const keys = result.keys;
hdWallet.hdWallet.clear();

const networkId = getNetworkId();

// Unshielded address — this is where cNIGHT should be sent
const keystore = createKeystore(keys[Roles.NightExternal], networkId);
const unshieldedAddress = keystore.getBech32Address();

// Shielded address — derived purely from ZswapSecretKeys (no network needed)
const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
const coinPubKey = ShieldedCoinPublicKey.fromHexString(shieldedSecretKeys.coinPublicKey);
const encPubKey  = ShieldedEncryptionPublicKey.fromHexString(shieldedSecretKeys.encryptionPublicKey);
const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey));

// DUST address — derived from DustSecretKey (no network needed)
const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
const dustAddress = DustAddress.encodePublicKey(networkId, dustSecretKey.publicKey);

const DIVIDER = '══════════════════════════════════════════════════════════════';
console.log(`\n${DIVIDER}`);
console.log(`  Midnight Wallet Addresses (${network})`);
console.log(DIVIDER);
console.log(`  Unshielded : ${unshieldedAddress}`);
console.log(`               ↑ Send cNIGHT here`);
console.log(`  DUST       : ${dustAddress}`);
console.log(`               ↑ Compare with Lace mn_dust1w...`);
console.log(`  Shielded   : ${shieldedAddress}`);
console.log(`${DIVIDER}\n`);

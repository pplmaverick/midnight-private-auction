import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Auction, witnesses, createAuctionPrivateState, type AuctionPrivateState } from '../contract/src/index.js';
// ledger-9 ledger types come through midnight-js-protocol's `/v9` re-export (the ledger-9
// toolchain publishes `@midnightntwrk/ledger-v9`; this keeps a single resolved copy).
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/v9';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  createLedger9MidnightProvider,
  createLedger9WalletProvider,
  type MidnightProvider,
  type WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { WalletSeeds, type WalletSeeds as WalletSeedsType } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js/utils';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { ledgerFromRead } from './ledger-state.js';
import type { Ledger9FinalizedTxData as FinalizedTxData } from '@midnight-ntwrk/midnight-js-types';
import { Buffer } from 'buffer';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import {
  type AuctionCircuits,
  type AuctionProviders,
  type DeployedAuctionContract,
  type AuctionRoleId,
  AUCTIONEER_STATE_ID,
  BIDDER1_STATE_ID,
  BIDDER2_STATE_ID,
} from './common-types.js';
import { type Config, zkConfigPath, privateStateStoreName } from './config.js';

// Wallet checkpoints. The wallet-sdk 5.x snapshot format is NOT the one the 3.x/2.x SDK wrote,
// so v9 checkpoints live in their own subdirectory (the old .wallet-state/*.json files are
// left untouched and are never read). Files are keyed by NETWORK and the shielded coin public
// key (<kind>-<networkId>-<coinPubKey16>.json), and every load re-validates the snapshot's own
// networkId and (shielded) coin public key, so a checkpoint is never restored into another
// network or into a wallet derived from a different seed.
const STATE_DIR = path.resolve(process.cwd(), '.wallet-state', 'v9');
const checkpointFile = (kind: 'shielded' | 'dust', networkId: string, coinPublicKey: string): string =>
  path.resolve(STATE_DIR, `${kind}-${networkId}-${coinPublicKey.slice(0, 16)}.json`);

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: enables WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const auctionCompiledContract = CompiledContract.make('auction', Auction.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  seeds: WalletSeedsType;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
  networkId: Config['networkId'];
  // true when both wallets were restored from .wallet-state/v9 checkpoints (no genesis sync).
  restoredFromCheckpoint: boolean;
}

// ─── Wallet Setup ────────────────────────────────────────────────────────────

// WalletSeeds.fromMasterSeed derives the shielded / unshielded (NightExternal) / dust seeds
// from the 32-byte master seed — the same account-0 / index-0 derivation the old
// HDWallet.selectAccount(0).selectRoles([...]).deriveKeysAt(0) call performed.
const deriveSeeds = (seed: string): WalletSeedsType => WalletSeeds.fromMasterSeed(Buffer.from(seed, 'hex'));

const buildWalletConfiguration = ({ networkId, indexer, indexerWS, node, proofServer }: Config) => ({
  networkId,
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
  costParameters: {
    ledgerParams: ledger.LedgerParameters.initialParameters(),
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
});

// Returns the raw snapshot only if it parses, was written for THIS network and (shielded) belongs to
// THIS wallet's coin public key. Anything else is rejected (null) with a reason on stderr; the
// caller then syncs from genesis (or fails, in 'restore' mode).
const loadCheckpoint = (
  file: string,
  kind: 'shielded' | 'dust',
  networkId: string,
  coinPublicKey: string,
): string | null => {
  if (!existsSync(file)) return null;
  const reject = (why: string): null => {
    console.error(`  ✗ Ignoring ${kind} checkpoint ${path.basename(file)}: ${why}`);
    return null;
  };
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return null; // unreadable — fall back to a full sync
  }
  let snap: { networkId?: unknown; publicKeys?: { coinPublicKey?: unknown } };
  try {
    snap = JSON.parse(raw);
  } catch {
    return reject('not valid JSON');
  }
  if (snap.networkId !== networkId) return reject(`written for network "${String(snap.networkId)}", wallet is on "${networkId}"`);
  if (kind === 'shielded' && String(snap.publicKeys?.coinPublicKey ?? '').toLowerCase() !== coinPublicKey.toLowerCase()) {
    return reject('belongs to a different wallet (coin public key mismatch)');
  }
  return raw;
};

// Atomic: write a temp file (mode 600) next to the target, then rename over it, so a crash or kill
// mid-write can never leave a truncated checkpoint behind.
const saveCheckpoint = (file: string, serialized: string): void => {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, serialized, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
};

// Era handling: midnight-js 5.x hands providers era-tagged transaction handles. This CLI targets
// the ledger-9 network only (createLedger9*Provider serve v9 and refuse v8 handles). The wallet
// facade has its own copy of the ledger, so the transaction crosses as bytes both ways.
export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const coinPublicKey = state.shielded.coinPublicKey.toHexString();
  const encryptionPublicKey = state.shielded.encryptionPublicKey.toHexString();

  const walletProvider = createLedger9WalletProvider({
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,
    async balanceTx(tx, ttl) {
      const handle = ctx.wallet.adoptTransaction(tx.serialize(), 'Unbound');
      const recipe = await ctx.wallet.balanceUnboundTransaction(handle, {
        ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
      });
      // The SDK's own signRecipe replaces the hand-written signTransactionIntents workaround.
      const signed = await ctx.wallet.signRecipe(recipe, (payload) => ctx.unshieldedKeystore.signDataAsync(payload));
      const finalized = await ctx.wallet.finalizeRecipe(signed);
      return finalized.serialize();
    },
  });

  const midnightProvider = createLedger9MidnightProvider(async (tx) =>
    ctx.wallet.submitTransaction(ctx.wallet.adoptTransaction(tx.serialize(), 'Finalized')),
  );

  return Object.assign({}, walletProvider, midnightProvider);
};

// Wait for all three wallets to report synced (FacadeState.isSynced).
export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(wallet.state().pipe(Rx.throttleTime(2_000), Rx.filter((s) => s.isSynced)));

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

export interface BuildWalletOptions {
  // 'restore' requires both checkpoints; 'auto' restores when present, else syncs from genesis.
  readonly mode: 'auto' | 'restore';
  // Suppress informational output (addresses, RSS lines). Sync status is still shown.
  readonly quiet?: boolean;
  // Called once the facade has started syncing (before buildWallet resolves) so a caller can
  // observe progress or enforce its own timeout. Receives the live facade.
  readonly onWalletStarted?: (wallet: WalletFacade, controls: WalletControls) => void;
  // Serialize both wallets to .wallet-state/v9/ every N ms while syncing (0/undefined = off).
  // The snapshot records the applied event index, and restore() resumes from that cursor.
  readonly periodicCheckpointMs?: number;
  // Fresh dust start only: skip replaying the ledger-v8 dust history (SDK option
  // skipLedgerV8DustHistory). Shielded/unshielded still replay from genesis.
  readonly skipLedgerV8DustHistory?: boolean;
}

export interface WalletControls {
  // Serialize and persist both checkpoints right now (atomic, mode 600).
  readonly saveCheckpoints: () => Promise<void>;
}

export const buildWallet = async (
  config: Config,
  seed: string,
  { mode, quiet = false, onWalletStarted, periodicCheckpointMs, skipLedgerV8DustHistory }: BuildWalletOptions,
): Promise<WalletContext> => {
  const log = (message: string): void => {
    if (!quiet) console.log(message);
  };
  const seeds = deriveSeeds(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(seeds.shielded);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(seeds.dust);
  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, config.networkId);

  const shieldedFile = checkpointFile('shielded', config.networkId, shieldedSecretKeys.coinPublicKey);
  const dustFile = checkpointFile('dust', config.networkId, shieldedSecretKeys.coinPublicKey);
  const shieldedCheckpoint = loadCheckpoint(shieldedFile, 'shielded', config.networkId, shieldedSecretKeys.coinPublicKey);
  const dustCheckpoint = loadCheckpoint(dustFile, 'dust', config.networkId, shieldedSecretKeys.coinPublicKey);
  const haveCheckpoints = shieldedCheckpoint !== null && dustCheckpoint !== null;

  if (mode === 'restore' && !haveCheckpoints) {
    throw new Error(
      'Wallet checkpoints not found — complete a full sync first (run without MIDNIGHT_DEPLOY_NODE)',
    );
  }

  const configuration = buildWalletConfiguration(config);
  let memGuard: NodeJS.Timeout | undefined;

  if (haveCheckpoints) {
    log('  Restoring wallet from v9 checkpoints (fast)...');
  } else {
    log('  No v9 checkpoints — full genesis sync (first run is slow).');
    log('  Expected time: 10-20 min per wallet  |  Peak RAM: ~8 GB');
    // WASM linear memory only grows. The old SDK leaked several GB during genesis sync and once
    // hard-locked the machine at ~11 GB RSS; keep the watchdog until the first sync completes.
    const MEM_LIMIT = 9 * 1024 * 1024 * 1024;
    memGuard = setInterval(() => {
      const rss = process.memoryUsage().rss;
      const gb = (rss / 1024 ** 3).toFixed(1);
      log(`\n  [mem] RSS: ${gb} GB`);
      if (rss > MEM_LIMIT) {
        console.error(`\n  ✗ Memory guard: RSS ${gb} GB exceeded 9 GB limit — exiting safely`);
        process.exit(1);
      }
    }, 60_000);
  }

  const wallet = await WalletFacade.init({
    configuration,
    shielded: (cfg) =>
      shieldedCheckpoint !== null
        ? ShieldedWallet(cfg).restore(shieldedCheckpoint)
        : ShieldedWallet(cfg).startWithSeed(seeds.shielded),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      dustCheckpoint !== null
        ? DustWallet(cfg).restore(dustCheckpoint)
        : DustWallet(skipLedgerV8DustHistory ? { ...cfg, skipLedgerV8DustHistory: true } : cfg).startWithSeed(seeds.dust),
  });
  await wallet.start(seeds);
  let saving = false;
  const saveCheckpoints = async (): Promise<void> => {
    if (saving) return; // a snapshot is already being written
    saving = true;
    try {
      saveCheckpoint(shieldedFile, await wallet.shielded.serializeState());
      saveCheckpoint(dustFile, await wallet.dust.serializeState());
    } finally {
      saving = false;
    }
  };
  let periodic: NodeJS.Timeout | undefined;
  if (periodicCheckpointMs && periodicCheckpointMs > 0) {
    periodic = setInterval(() => {
      saveCheckpoints().then(
        () => console.log('  [checkpoint] saved intermediate wallet snapshot'),
        (e) => console.error('  [checkpoint] intermediate save failed:', e instanceof Error ? e.message : String(e)),
      );
    }, periodicCheckpointMs);
  }
  onWalletStarted?.(wallet, { saveCheckpoints });

  log(`\n  Unshielded address: ${unshieldedKeystore.getBech32Address()}`);
  const syncedState = await withStatus('Syncing with network', () => waitForSync(wallet));
  if (memGuard) clearInterval(memGuard);
  if (periodic) clearInterval(periodic);

  // Refresh both checkpoints at the synced tip for the next run.
  try {
    saveCheckpoint(shieldedFile, await wallet.shielded.serializeState());
    saveCheckpoint(dustFile, await wallet.dust.serializeState());
  } catch (e) {
    console.error('  ✗ Failed to save wallet checkpoints (non-fatal):', e instanceof Error ? e.message : e);
  }

  const coinPubKey = ShieldedCoinPublicKey.fromHexString(syncedState.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(syncedState.shielded.encryptionPublicKey.toHexString());
  log(`  Shielded address: ${MidnightBech32m.encode(config.networkId, new ShieldedAddress(coinPubKey, encPubKey))}`);

  return {
    wallet,
    seeds,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
    networkId: config.networkId,
    restoredFromCheckpoint: haveCheckpoints,
  };
};

export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('\n  Building wallet...');
  const ctx = await buildWallet(config, seed, { mode: 'auto' });
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  const balance = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  const dustReady = state.dust.availableCoins.length > 0;
  if (balance === 0n && !dustReady) {
    await withStatus('Waiting for NIGHT tokens (check faucet)', () => waitForFunds(ctx.wallet));
  }
  await registerForDustGeneration(ctx.wallet, ctx.unshieldedKeystore);
  return ctx;
};

// Fast wallet restore from checkpoints with a potentially different node URL.
// Used to create a short-lived deploy-only wallet that connects to the private RPC relay.
export const buildWalletFromCheckpoints = async (config: Config, seed: string): Promise<WalletContext> =>
  buildWallet(config, seed, { mode: 'restore' });

// Providers for the deploy step — uses a separate Level DB store name so it can
// run alongside the main providers without LevelDB lock conflicts.
export const configureDeployProviders = async (ctx: WalletContext, config: Config): Promise<AuctionProviders> =>
  buildProviders(ctx, config, privateStateStoreName + '-deploy');

// Providers for the deploy dry-run — its own Level DB store so nothing touches the real stores.
export const configureDryRunProviders = async (ctx: WalletContext, config: Config): Promise<AuctionProviders> =>
  buildProviders(ctx, config, privateStateStoreName + '-dryrun');

export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = Buffer.from(randomBytes32()).toString('hex');
  console.log('\n  ══════════════════════════════════════════════');
  console.log('  New wallet seed — SAVE THIS BEFORE CONTINUING');
  console.log('  ══════════════════════════════════════════════');
  console.log(`  ${seed}`);
  console.log('  ══════════════════════════════════════════════\n');
  return buildWalletAndWaitForFunds(config, seed);
};

const registerForDustGeneration = async (wallet: WalletFacade, keystore: UnshieldedKeystore): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  if (state.dust.availableCoins.length > 0) {
    console.log(`  ✓ DUST available: ${state.dust.balance(new Date()).toLocaleString()}`);
    return;
  }
  const unregistered = state.unshielded.availableCoins.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration !== true,
  );
  if (unregistered.length > 0) {
    await withStatus(`Registering ${unregistered.length} NIGHT UTXO(s) for DUST generation`, async () => {
      const recipe = await wallet.registerNightUtxosForDustGeneration(
        unregistered,
        keystore.getPublicKey(),
        (payload) => keystore.signDataAsync(payload),
      );
      const finalized = await wallet.finalizeRecipe(recipe);
      await wallet.submitTransaction(finalized);
    });
  }
  await withStatus('Waiting for DUST tokens to generate', () =>
    Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced),
        Rx.filter((s) => s.dust.balance(new Date()) > 0n),
      ),
    ),
  );
};

// ─── Provider Configuration ──────────────────────────────────────────────────

const buildProviders = async (ctx: WalletContext, config: Config, storeName: string): Promise<AuctionProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<AuctionCircuits>(zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<AuctionRoleId>({
      privateStateStoreName: storeName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
    // midnight-js 5.x: the network id travels with the providers (setNetworkId was removed).
    config: { networkId: config.networkId, ttlSeconds: 3600 },
  };
};

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<AuctionProviders> =>
  buildProviders(ctx, config, privateStateStoreName);

// ─── Contract Operations ─────────────────────────────────────────────────────

export const deployAuction = async (
  providers: AuctionProviders,
  auctioneerPrivateState: AuctionPrivateState,
): Promise<DeployedAuctionContract> => {
  const contract = await deployContract(providers, {
    compiledContract: auctionCompiledContract,
    privateStateId: AUCTIONEER_STATE_ID,
    initialPrivateState: auctioneerPrivateState,
  });
  console.log(`  Contract address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const joinAs = async (
  providers: AuctionProviders,
  contractAddress: string,
  roleId: AuctionRoleId,
  initialPrivateState: AuctionPrivateState,
): Promise<DeployedAuctionContract> => {
  assertIsContractAddress(contractAddress);
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: auctionCompiledContract,
    privateStateId: roleId,
    initialPrivateState,
  });
};

// Rejoins using whatever private state is already persisted at roleId, instead of
// overwriting it. Omitting 'initialPrivateState' entirely (not just passing undefined)
// is what makes findDeployedContract read the existing entry rather than replace it —
// needed to recover a role's identity (e.g. the auctioneer) in a later process that
// never generated that role's secretKey itself.
export const joinExisting = async (
  providers: AuctionProviders,
  contractAddress: string,
  roleId: AuctionRoleId,
): Promise<DeployedAuctionContract> => {
  assertIsContractAddress(contractAddress);
  return findDeployedContract(providers, {
    contractAddress,
    compiledContract: auctionCompiledContract,
    privateStateId: roleId,
  });
};

export const createAuction = async (
  contract: DeployedAuctionContract,
  itemName: string,
  description: string,
  startingPrice: bigint,
  endTime: bigint,
  revealDeadline: bigint,
): Promise<{ txData: FinalizedTxData; auctionId: bigint }> => {
  const result = await contract.callTx.createAuction(itemName, description, startingPrice, endTime, revealDeadline);
  return { txData: result.public, auctionId: result.private.result };
};

export const placeBid = async (
  contract: DeployedAuctionContract,
  auctionId: bigint,
): Promise<FinalizedTxData> => {
  const result = await contract.callTx.placeBid(auctionId);
  return result.public;
};

export const closeAuction = async (
  contract: DeployedAuctionContract,
  auctionId: bigint,
  newRevealDeadline: bigint,
): Promise<FinalizedTxData> => {
  const result = await contract.callTx.closeAuction(auctionId, newRevealDeadline);
  return result.public;
};

export const revealBid = async (
  contract: DeployedAuctionContract,
  auctionId: bigint,
  amount: bigint,
  salt: Uint8Array,
): Promise<FinalizedTxData> => {
  const result = await contract.callTx.revealBid(auctionId, amount, salt);
  return result.public;
};

export const claimItem = async (
  contract: DeployedAuctionContract,
  auctionId: bigint,
): Promise<FinalizedTxData> => {
  const result = await contract.callTx.claimItem(auctionId);
  return result.public;
};

export const getLedgerState = async (
  providers: AuctionProviders,
  contractAddress: ContractAddress,
) => {
  assertIsContractAddress(contractAddress);
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  if (state == null) return null;
  return ledgerFromRead(state);
};

// ─── Utilities ───────────────────────────────────────────────────────────────

export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`), 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
};

// Generate 32 cryptographically secure random bytes (used for wallet seeds, secret keys, salts).
// Must not use Math.random — these values protect funds and bid privacy.
export const randomBytes32 = (): Uint8Array => new Uint8Array(cryptoRandomBytes(32));

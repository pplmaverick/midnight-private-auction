import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Auction, witnesses, createAuctionPrivateState, type AuctionPrivateState } from '../contract/src/index.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js/types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js/utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Checkpoint files — real checkpoints come from wallet.serializeState() after a full sync.
// Temp shielded checkpoint is a stub that forces ShieldedWallet into a retry-loop during
// Phase 1 (DustWallet sync only), keeping ShieldedWallet's memory footprint near zero.
const STATE_DIR = path.resolve(process.cwd(), '.wallet-state');
const STATE_FILE = path.resolve(STATE_DIR, 'shielded-checkpoint.json');   // real checkpoint
const SHIELDED_TEMP_FILE = path.resolve(STATE_DIR, 'shielded-temp.json'); // Phase-1 stub
const DUST_STATE_FILE = path.resolve(STATE_DIR, 'dust-checkpoint.json');  // real checkpoint
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

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: enables WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─── Wallet Checkpoints ──────────────────────────────────────────────────────

// Load a real ShieldedWallet checkpoint (saved via serializeState() after a full sync).
// Returns null if not found — triggers startWithSecretKeys on next run (Phase 2).
const loadShieldedCheckpoint = (secretKeys: ledger.ZswapSecretKeys): string | null => {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const saved = JSON.parse(raw) as any;
    if (
      saved?.publicKeys?.coinPublicKey === secretKeys.coinPublicKey &&
      saved?.publicKeys?.encryptionPublicKey === secretKeys.encryptionPublicKey
    ) {
      console.log(`  Loaded shielded checkpoint (offset=${saved.offset})`);
      return raw;
    }
    console.log('  Shielded checkpoint belongs to a different seed — will sync from genesis');
  } catch { /* corrupted */ }
  return null;
};

// Build or load a Phase-1 stub for ShieldedWallet.
// This stub has an empty ZswapLocalState + high offset, which causes ShieldedWallet to
// immediately hit a commitment-tree non-linear error and enter a retry-loop.
// That is the DESIRED behaviour for Phase 1 — ShieldedWallet stays idle (<100 MB) while
// DustWallet does its full sync in the foreground.
const getOrCreateTempShieldedState = async (
  indexerWS: string,
  secretKeys: ledger.ZswapSecretKeys,
): Promise<string> => {
  if (existsSync(SHIELDED_TEMP_FILE)) {
    const saved = JSON.parse(readFileSync(SHIELDED_TEMP_FILE, 'utf-8')) as any;
    if (
      saved?.publicKeys?.coinPublicKey === secretKeys.coinPublicKey &&
      saved?.publicKeys?.encryptionPublicKey === secretKeys.encryptionPublicKey
    ) {
      return readFileSync(SHIELDED_TEMP_FILE, 'utf-8');
    }
  }
  // Fetch current chain tip to set offset
  const maxId = await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(indexerWS, ['graphql-transport-ws']);
    let done = false;
    const finish = (id: number) => { if (!done) { done = true; ws.close(); resolve(id); } };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connection_init', payload: {} })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as any;
      if (msg.type === 'connection_ack') {
        ws.send(JSON.stringify({ id: '1', type: 'subscribe',
          payload: { query: `subscription { zswapLedgerEvents(id: 0) { id maxId } }` } }));
      } else if (msg.type === 'next' && msg.payload?.data?.zswapLedgerEvents) {
        finish(msg.payload.data.zswapLedgerEvents.maxId as number);
      } else if (msg.type === 'error') { done = true; ws.close(); reject(new Error('zswap fetch failed')); }
    });
    ws.on('error', (e) => { if (!done) { done = true; reject(e); } });
    setTimeout(() => { if (!done) { done = true; ws.close(); reject(new Error('zswap fetch timeout')); } }, 15_000);
  });
  const emptyStateHex = Buffer.from(new ledger.ZswapLocalState().serialize()).toString('hex');
  const stub = JSON.stringify({
    publicKeys: { coinPublicKey: secretKeys.coinPublicKey, encryptionPublicKey: secretKeys.encryptionPublicKey },
    state: emptyStateHex, protocolVersion: '0', offset: maxId.toString(),
    networkId: getNetworkId(), coinHashes: {},
  });
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(SHIELDED_TEMP_FILE, stub);
  return stub;
};

// Load an existing DustWallet serialized checkpoint, or return null if none exists.
// On the first run there is no checkpoint — DustWallet must do a full sync from genesis
// so that the commitment tree is built linearly. After that first sync we save the
// resulting state and subsequent runs skip history via restore().
const loadDustCheckpoint = (dustSecretKey: ledger.DustSecretKey): string | null => {
  if (!existsSync(DUST_STATE_FILE)) return null;
  try {
    const raw = readFileSync(DUST_STATE_FILE, 'utf-8');
    const saved = JSON.parse(raw) as any;
    if (saved?.publicKey?.publicKey === dustSecretKey.publicKey.toString()) {
      console.log(`  Loaded dust checkpoint (offset=${saved.offset})`);
      return raw;
    }
    console.log('  Dust checkpoint belongs to a different seed — will re-sync from genesis');
  } catch { /* corrupted file — re-sync */ }
  return null;
};

const auctionCompiledContract = CompiledContract.make('auction', Auction.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

// ─── Wallet Setup ────────────────────────────────────────────────────────────

const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') throw new Error('Failed to initialize HDWallet from seed');
  const result = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Failed to derive keys');
  hdWallet.hdWallet.clear();
  return result.keys;
};

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
});

// Sign transaction intents using the correct proof marker (works around wallet-sdk bug).
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature', proofMarker, 'pre-binding', intent.serialize(),
    );
    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);
    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  return {
    getCoinPublicKey() { return state.shielded.coinPublicKey.toHexString(); },
    getEncryptionPublicKey() { return state.shielded.encryptionPublicKey.toHexString(); },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) { return ctx.wallet.submitTransaction(tx) as any; },
  };
};

// Phase-1 sync: wait only for DustWallet + unshielded.
// ShieldedWallet is in a retry-loop (expected) and is intentionally ignored here.
export const waitForDustSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) =>
        s.unshielded.progress.isStrictlyComplete() &&
        s.dust.state.progress.isStrictlyComplete(),
      ),
    ),
  );

// Normal / Phase-2 sync: all three wallets must be complete.
export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(2_000),
      Rx.filter((s) => {
        if (s.isSynced) return true;
        return (
          s.unshielded.progress.isStrictlyComplete() &&
          s.dust.state.progress.isStrictlyComplete() &&
          s.shielded.state.progress.isCompleteWithin(10n)
        );
      }),
    ),
  );

export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((balance) => balance > 0n),
    ),
  );

export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('\n  Building wallet...');
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const dustCheckpoint    = loadDustCheckpoint(dustSecretKey);
  const shieldedCheckpoint = loadShieldedCheckpoint(shieldedSecretKeys);
  const isFirstDustRun    = dustCheckpoint === null;
  const isFirstShieldedRun = shieldedCheckpoint === null;

  const walletConfig = {
    ...buildShieldedConfig(config),
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };

  // ── Phase 1: DustWallet genesis sync ──────────────────────────────────────
  // ShieldedWallet is kept in a deliberate retry-loop via a temp stub (<100MB).
  // Once DustWallet finishes, we save dust-checkpoint.json and exit.
  // The user re-runs npm run preprod to enter Phase 2.
  if (isFirstDustRun) {
    console.log('  Phase 1 — DustWallet genesis sync (ShieldedWallet intentionally idle)...');
    console.log('  Expected time: 10-20 min  |  Peak RAM: ~8 GB');
    const tempStub = await getOrCreateTempShieldedState(config.indexerWS, shieldedSecretKeys);
    const wallet = await WalletFacade.init({
      configuration: walletConfig,
      shielded:    (cfg) => ShieldedWallet(cfg).restore(tempStub),
      unshielded:  (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust:        (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
    });
    await wallet.start(shieldedSecretKeys, dustSecretKey);

    // WASM memory guard: ShieldedWallet's retry-loop leaks WASM linear memory (can only grow,
    // never shrink). If RPC disconnects extend Phase 1 beyond ~20 min, thousands of retries
    // accumulate several GB. Exit before hitting the 24 GB system limit.
    const MEM_LIMIT = 9 * 1024 * 1024 * 1024; // 9 GB — machine crashed at 11 GB
    const memGuard = setInterval(() => {
      const rss = process.memoryUsage().rss;
      const gb = (rss / (1024 ** 3)).toFixed(1);
      console.log(`\n  [mem] RSS: ${gb} GB`);
      if (rss > MEM_LIMIT) {
        clearInterval(memGuard);
        console.error(`\n  ✗ Memory guard: RSS ${gb} GB exceeded 9 GB limit — exiting safely`);
        console.error('  Root cause: WASM leak from ShieldedWallet retry-loop (likely RPC disconnect stalled DustWallet sync)');
        console.error('  Wait a minute, then re-run "npm run preprod" to retry Phase 1.');
        process.exit(1);
      }
    }, 60_000);

    await withStatus('Phase 1 — DustWallet sync', () => waitForDustSync(wallet));
    clearInterval(memGuard);

    try {
      const dustState = await wallet.dust.serializeState();
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(DUST_STATE_FILE, dustState);
      console.log('\n  ✓ Dust checkpoint saved → .wallet-state/dust-checkpoint.json');
    } catch (e) {
      console.error('  ✗ Failed to save dust checkpoint:', e);
    }

    console.log('\n  ══════════════════════════════════════════════════════════════');
    console.log('  Phase 1 complete! Run "npm run preprod" again to start Phase 2');
    console.log('  (ShieldedWallet will sync from genesis, another ~10-20 min)');
    console.log('  ══════════════════════════════════════════════════════════════\n');
    process.exit(0);
  }

  // ── Phase 2: ShieldedWallet genesis sync ──────────────────────────────────
  // DustWallet restores instantly; ShieldedWallet syncs from genesis.
  // Saves shielded-checkpoint.json then continues to the e2e steps.
  if (isFirstShieldedRun) {
    console.log('  Phase 2 — ShieldedWallet genesis sync (DustWallet restoring fast)...');
    console.log('  Expected time: 10-20 min  |  Peak RAM: ~7 GB');
    const wallet = await WalletFacade.init({
      configuration: walletConfig,
      shielded:    (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
      unshielded:  (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
      dust:        (cfg) => DustWallet(cfg).restore(dustCheckpoint!),
    });
    await wallet.start(shieldedSecretKeys, dustSecretKey);

    const networkId = getNetworkId();
    console.log(`\n  Unshielded address: ${unshieldedKeystore.getBech32Address()}`);

    const syncedState = await withStatus('Phase 2 — ShieldedWallet sync', () => waitForSync(wallet));

    try {
      const shieldedState = await wallet.shielded.serializeState();
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(STATE_FILE, shieldedState);
      console.log('  ✓ Shielded checkpoint saved → .wallet-state/shielded-checkpoint.json');
    } catch (e) {
      console.error('  ✗ Failed to save shielded checkpoint:', e);
    }

    const coinPubKey2 = ShieldedCoinPublicKey.fromHexString(syncedState.shielded.coinPublicKey.toHexString());
    const encPubKey2  = ShieldedEncryptionPublicKey.fromHexString(syncedState.shielded.encryptionPublicKey.toHexString());
    console.log(`  Shielded address: ${MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey2, encPubKey2))}`);

    const balance2 = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
    const dustReady2 = syncedState.dust.availableCoins.length > 0;
    if (balance2 === 0n && !dustReady2) {
      await withStatus('Waiting for tNight tokens (check faucet)', () => waitForFunds(wallet));
    }

    await registerForDustGeneration(wallet, unshieldedKeystore);
    return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
  }

  // ── Phase 3: Both checkpoints exist — fast restore (<1 GB, <30 s) ─────────
  console.log('  Phase 3 — restoring from checkpoints (fast)...');
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded:    (cfg) => ShieldedWallet(cfg).restore(shieldedCheckpoint!),
    unshielded:  (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust:        (cfg) => DustWallet(cfg).restore(dustCheckpoint!),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  const networkId = getNetworkId();
  console.log(`\n  Unshielded address: ${unshieldedKeystore.getBech32Address()}`);

  const syncedState = await withStatus('Syncing with network', () => waitForSync(wallet));

  // Refresh shielded checkpoint to latest tip for the next run
  try {
    const updatedState = await wallet.shielded.serializeState();
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, updatedState);
  } catch { /* non-fatal */ }

  const coinPubKey = ShieldedCoinPublicKey.fromHexString(syncedState.shielded.coinPublicKey.toHexString());
  const encPubKey  = ShieldedEncryptionPublicKey.fromHexString(syncedState.shielded.encryptionPublicKey.toHexString());
  console.log(`  Shielded address: ${MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey))}`);

  const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dustReady = syncedState.dust.availableCoins.length > 0;
  if (balance === 0n && !dustReady) {
    await withStatus('Waiting for tNight tokens (check faucet)', () => waitForFunds(wallet));
  }

  await registerForDustGeneration(wallet, unshieldedKeystore);
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

// Fast wallet restore from checkpoints with a potentially different node URL.
// Used to create a short-lived deploy-only wallet that connects to the private RPC relay.
// Requires both .wallet-state/dust-checkpoint.json and .wallet-state/shielded-checkpoint.json.
export const buildWalletFromCheckpoints = async (config: Config, seed: string): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const dustCheckpoint = loadDustCheckpoint(dustSecretKey);
  const shieldedCheckpoint = loadShieldedCheckpoint(shieldedSecretKeys);
  if (!dustCheckpoint || !shieldedCheckpoint) {
    throw new Error(
      'Wallet checkpoints not found — complete a full sync first (run without MIDNIGHT_DEPLOY_NODE)',
    );
  }

  const walletConfig = {
    ...buildShieldedConfig(config),
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };

  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded:   (cfg) => ShieldedWallet(cfg).restore(shieldedCheckpoint),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust:       (cfg) => DustWallet(cfg).restore(dustCheckpoint),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  await withStatus('Deploy wallet syncing', () => waitForSync(wallet));
  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

// Providers for the deploy step — uses a separate Level DB store name so it can
// run alongside the main providers without LevelDB lock conflicts.
export const configureDeployProviders = async (ctx: WalletContext, config: Config): Promise<AuctionProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<AuctionCircuits>(zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<AuctionRoleId>({
      privateStateStoreName: privateStateStoreName + '-deploy',
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export const buildFreshWallet = async (config: Config): Promise<WalletContext> => {
  const seed = toHex(Buffer.from(generateRandomSeed()));
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
        (payload) => keystore.signData(payload),
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

export const configureProviders = async (ctx: WalletContext, config: Config): Promise<AuctionProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<AuctionCircuits>(zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, 'hex').toString('base64')}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<AuctionRoleId>({
      privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

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
): Promise<FinalizedTxData> => {
  const result = await contract.callTx.closeAuction(auctionId);
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
  return Auction.ledger(state.data);
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

// Generate a random 32-byte salt as Uint8Array.
export const randomBytes32 = (): Uint8Array => {
  const buf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
};

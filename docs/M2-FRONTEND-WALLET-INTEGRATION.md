# Midnight Private Auction — M2 Frontend Wallet Integration Implementation Notes

**Date range**: 2026-07-01 to 2026-07-02
**Project**: `pplmaverick/midnight-private-auction`
**Goal**: Port the contract interaction capability from the CLI version (`src/api.ts`) to the browser frontend (`frontend/`), following the "Route A: DApp Connector Delegation" architecture.

---

## 1. Architecture Decision: Route A vs Route B

**Route B** (originally considered): Port the CLI's entire approach — managing seeds, deriving keys locally, and signing/submitting transactions locally — directly into the browser.

**Route A** (adopted): Private keys remain inside the wallet extension (Lace / 1AM). The frontend delegates signing, transaction balancing, and transaction submission through the `ConnectedAPI` exposed by `@midnight-ntwrk/dapp-connector-api`.

**Rationale**: This is an auction dApp where users bid/claim rewards using their own wallets — private keys should never enter browser JS memory. Route B would force the CLI's security model (developer-controlled seed management) onto a consumer-facing product, which is a security anti-pattern.

---

## 2. MidnightProviders: Overview of the Five Pieces

The `MidnightProviders` interface (`midnight-js-types`) requires 5 providers. Each is documented below with its implementation path, blockers, and final solution.

| Provider | File | Status |
|---|---|---|
| zkConfigProvider | `frontend/src/midnight/browserZkConfigProvider.ts` | ✅ Complete, verified against real circuit files |
| publicDataProvider | `frontend/src/midnight/publicDataProvider.ts` | ✅ Complete, verified against real on-chain contract state |
| proofProvider | `frontend/src/midnight/proofProvider.ts` | ✅ Complete, verified with real 1AM wallet |
| privateStateProvider | `frontend/src/midnight/browserPrivateStateProvider.ts` + `browserStorageEncryption.ts` | ✅ Complete, with AES-256-GCM encryption |
| walletProvider / midnightProvider | `frontend/src/midnight/walletProvider.ts` | ✅ Complete, `balanceTx`/`submitTx` not yet tested against a real chain |

---

## 3. zkConfigProvider (Browser Version)

**Problem**: The three "browser-specific" official package names (`browser-proof-provider`, `indexeddb-private-state-provider`, `browser-zk-config-provider`) all return 404 on npm. These packages do not exist in the currently published Midnight SDK ecosystem.

**Solution**: `ZKConfigProvider<K>` is an abstract class with only 3 abstract methods that actually need implementing (`getZKIR`/`getProverKey`/`getVerifierKey`). Following the path convention used by `NodeZkConfigProvider` (`{dir}/zkir/{id}.bzkir`, `{dir}/keys/{id}.{prover,verifier}`), a custom implementation was written using `fetch().then(r => r.arrayBuffer())` in place of `fs.readFile`.

**Circuit file source**: `contract/src/managed/auction/{zkir,keys}/`, copied to `frontend/public/zkir/` and `frontend/public/keys/`. 5 circuits: `createAuction`, `placeBid`, `closeAuction`, `revealBid`, `claimItem`.

**Verification**: All 5 circuits fetched successfully, with byte counts exactly matching the source files.

---

## 4. publicDataProvider

**Finding**: `indexerPublicDataProvider` is itself an isomorphic package, built on `@apollo/client` + `graphql-ws` + `isomorphic-ws` + `cross-fetch`, with no `fs`/`path`/`net`/`node:*` imports whatsoever — it can be ported into the frontend unmodified.

**Verification**: Called `queryContractState` against the deployed contract `872becfbc9d3142273c5dc5b7b1df5dae0fd0ee467c8857ea4e97f9a0408c21b` and successfully retrieved the real on-chain `ContractState` (`serialize()` length of 11,945 bytes, non-empty state).

**Cosmetic warning**: The Rollup build shows `Import "WebSocket" will always be undefined`, because the browser build of `isomorphic-ws` has no named `.WebSocket` export, while `indexerPublicDataProvider`'s source code uses `ws.WebSocket` as a default parameter. Tracing through `graphql-ws`'s `createClient` source confirms that when `webSocketImpl` is falsy, it falls back to reading the browser's global `WebSocket`. Functionality is unaffected — this is purely build-log noise.

---

## 5. proofProvider — The Biggest Architectural Pivot

### 5.1 Original Plan: Delegate to the Wallet (`getProvingProvider`)

Type comparison: `dapp-connector-api`'s `ProvingProvider` (`check`/`prove`, circuit-level) and `midnight-js-types`'s `ProofProvider` (`proveTx`, transaction-level) are different types, but `midnight-js-types` ships a ready-made adapter:

```ts
export declare const createProofProvider: (
  provingProvider: ProvingProvider,
  costModel?: CostModel
) => ProofProvider;
```

`ZKConfigProvider.asKeyMaterialProvider()` simply implements `return this`, and is structurally compatible with the parameter type required by `getProvingProvider(keyMaterialProvider)` — no additional casting needed.

### 5.2 Blocker: Lace Wallet Does Not Support `getProvingProvider`

**Symptom**: Calling `connectorAPI.getProvingProvider(...)` throws immediately (a `TypeError`, not a Promise rejection). Further investigation showed `hintUsage` exhibits the same behavior — the method "exists" at the type level, but the actual runtime value is `undefined`.

**Root cause confirmed**: The Midnight official forum already has a report of this exact issue from another developer ([Lace wallet doesn't implement getProvingProvider()](https://forum.midnight.network/t/lace-wallet-doesnt-implement-getprovingprovider-expected-behavior-or-version-gap/1213)): `getProvingProvider()` works correctly and ZK proving succeeds when connected via 1AM wallet; the same method throws when connected via Lace. **This is a known wallet SDK version gap, not an architectural issue in this project.**

**Alternative considered and rejected: self-hosting a public proof server**

Official documentation explicitly states that running the proof server locally on the user's machine is a deliberate privacy design choice: "This connection is required because the proof server requires private data as input — using a remote instance would compromise user privacy." This project is a private auction, where bid amounts/salts are private inputs. Hosting a public proof server that all users' browsers connect to for proof generation would mean users' private bid data flows through a server controlled by the developer — directly contradicting the core value proposition of "private auction." **This approach was rejected and is not used.**

**Final solution**: Switched to the 1AM wallet (confirmed to support `getProvingProvider()` and mainnet). `WalletContext.tsx` originally hardcoded `connect('lace')`; this was changed to accept a `walletHint` parameter. `walletConnector.ts`'s underlying implementation already enumerated wallets via `Object.entries(window.midnight)` plus fuzzy rdns/name matching — the architecture itself was sound, only the call site above it was hardcoded.

**Additional option (documented but not adopted)**: `getConfiguration().proverServerUri` (marked deprecated but confirmed still functional by the official team). This is a proof server address that the user specifies themselves in their wallet settings (conceptually equivalent to running `127.0.0.1:6300` on the user's own machine), which is not the same thing as "the dApp hosting a public server" — as long as the dApp does not actively steer users toward entering a developer-controlled address, this path has no inherent privacy issue. Reserved as a potential fallback messaging direction for Lace users; not yet implemented.

### 5.3 Verification

Connected with a real 1AM wallet; `buildProofProvider(api, zk.asKeyMaterialProvider())` successfully returned an object, and the `proveTx` method was present.

---

## 6. privateStateProvider (IndexedDB Version)

### 6.1 Interface Specification

`PrivateStateProvider<PSI, PS>` requires 13 methods: `set`/`get`/`remove`/`clear`/`setSigningKey`/`getSigningKey`/`removeSigningKey`/`clearSigningKeys`/`exportPrivateStates`/`importPrivateStates`/`exportSigningKeys`/`importSigningKeys`/`setContractAddress`.

Hidden constraints (from the type definition comments):
- `get`/`getSigningKey`: return `null` when the key does not exist, but **decryption failures must throw, not be swallowed into `null`**
- `setContractAddress` must be called before `get`, otherwise it must throw
- Implementations are allowed to migrate legacy data formats on read and write the migrated data back

### 6.2 Source of the Encryption Key: Elimination of Three Candidate Approaches

**Approach 1 (signature-derived key) — rejected, disproven by testing**

Idea: Have the wallet sign a fixed message via `signData`, and derive a symmetric key from the signature result.

**Test result**: Signing the same fixed message twice in a row with 1AM produced two completely different results (`verifyingKey` was identical, confirming the account identity was unchanged, but the signature itself differed each time). This is standard behavior for ECDSA/EdDSA-class signature algorithms — for security, the signing process incorporates randomness, so the same message signed with the same private key naturally produces a different result each time. **This is not Midnight-specific; it is a universal property of all mainstream signature algorithms**, so deriving a key directly from a signature result is unsound on any chain. Approach 1 is entirely unworkable: each connection would derive a different key, permanently locking out previously stored data.

**Approach 3 (browser device key / Web Crypto non-extractable CryptoKey) — proposed but not adopted**

A non-exportable key means data becomes permanently inaccessible on browser change or browser data clearing. Given the consequence — a deposit stuck in the contract with no way to retrieve it — this risk was deemed too high and the approach was eliminated first.

**Approach 3' (Midnight's native shieldedEncryptionPublicKey) — rejected, disproven by investigation**

Idea: Investigate whether the `shieldedEncryptionPublicKey` returned by `getEncryptionPublicKey()`/`getShieldedAddresses()` could be used for application-layer encryption/decryption.

**Findings**: The official comment in `ledger-v8.d.ts` explicitly states that `EncryptionSecretKey` is used to "hold the user's encryption key, used to determine whether a given offer contains an output addressed to that user" — this is a mechanism within Midnight's shielded transaction protocol (conceptually similar to Zcash's incoming viewing key), exposing only a single `test(offer): boolean` method, **with no general-purpose `decrypt(ciphertext)` method of any kind**. A line-by-line search of the `WalletConnectedAPI` type definition in `dapp-connector-api` found none of its 13 core methods carries `decrypt` semantics. **Conclusion: this key exists solely so that others can send shielded assets to the user — the dApp side has no channel to request the wallet decrypt arbitrary data.** (For reference: MetaMask previously exposed `eth_getEncryptionPublicKey`/`eth_decrypt`, which were later deprecated due to security concerns; Midnight wallets not exposing this capability may well be an intentional design choice rather than a gap.)

**Approach 2 (user-defined password + PBKDF2) — final choice**

Both routine read/write operations (`set`/`get`/`remove`, etc.) and export/import backups use a single unified password-based scheme, for the following reasons:
- After eliminating the first two approaches, this is the only viable, predictable option that is tied to neither a specific device nor a specific wallet vendor
- Maintaining two separate password systems would only confuse users further, while a unified scheme is cheaper to build and reason about

**UX design**: The password is requested only once per session, the first time private state access is needed. The AES key derived via PBKDF2 is held in an in-memory closure variable (with three additional methods — `unlock`/`lock`/`isUnlocked` — mirroring the pattern used by the Node CLI version's `levelPrivateStateProvider`, which adds a `changePassword` method). It is cleared on `lock()` or when the tab is closed/reloaded, and is never persisted to disk.

### 6.3 Implementation Details

- `browserStorageEncryption.ts`: PBKDF2 (600,000 iterations, matching the Node CLI version) + AES-256-GCM, implemented entirely with `window.crypto.subtle`, no additional package dependencies
- Salt: one per account (accountId) per store (`private-state`/`signing-key`), stored in IndexedDB (the salt itself is not secret and can safely sit alongside the encrypted data) — consistent with the Node CLI version's approach
- Hand-rolled BigInt/Uint8Array-safe JSON serialization (`AuctionPrivateState` contains bigint and Uint8Array fields, which cause native `JSON.stringify` to throw directly; no additional dependency such as `superjson` was introduced)
- `exportPrivateStates`/`importPrivateStates`/`exportSigningKeys`/`importSigningKeys` require the caller to pass a separate `options.password`, independent of the session's unlock state

### 6.4 Verification (5/5 passed)

| # | Test case | Result |
|---|---|---|
| 1 | Call `get` without `unlock()` | Correctly throws `PrivateStateLockedError` |
| 2 | Unlock with the correct password → set → get (including BigInt, Uint8Array) | Data read back with fully correct types |
| 3 | Call `get` after `lock()` | Correctly throws `PrivateStateLockedError` |
| 4 | Read after unlocking with the wrong password | Correctly throws `OperationError` (AES-GCM auth tag verification failure, not garbage data or null) |
| 5 | Read again after switching back to the correct password | Data intact |

---

## 7. walletProvider / midnightProvider

**No official adapter exists**; this had to be assembled manually. npm searches for names such as `midnight-js-dapp-connector-provider` all returned 404.

### 7.1 Three Concrete Gaps and Their Verification Results

**A. Transaction serialization/deserialization**

The `Transaction` class has symmetric `serialize()`/`static deserialize(markerS, markerP, markerB, raw)` methods, using the same marker convention as `Intent.deserialize` (existing usage at `src/api.ts:202`):
- Signature: `'signature' | 'signature-erased'`
- Proof: `'proof' | 'pre-proof' | 'no-proof'`
- Binding: `'binding' | 'pre-binding' | 'no-binding'`

`UnprovenTransaction = Transaction<SignatureEnabled, PreProof, PreBinding>`.

Tested by constructing a minimal tx via `Transaction.fromParts('mainnet')`; the round trip `serialize() → deserialize() → serialize()` produced byte-for-byte identical output (90 bytes). **No Buffer polyfill required** — the entire path uses only `Uint8Array`.

**B. `getCoinPublicKey()`/`getEncryptionPublicKey()` synchronous vs. the wallet's asynchronous API**

The official interface requires synchronous returns, but `getShieldedAddresses()` is asynchronous. Solution: call it once immediately after `connect()` completes and cache the result; `getCoinPublicKey()`/`getEncryptionPublicKey()` read from the cache. Calling before initialization must throw an explicit error rather than returning `undefined`.

**Encoding format gap**: `getShieldedAddresses()` returns a Bech32m-formatted string (e.g. `mn_shield-cpk1...`), while the underlying type expects hex. The conversion package is `@midnight-ntwrk/wallet-sdk-address-format` (not part of `ledger-v8`): `MidnightBech32m.parse()` decodes into `{type, network, data}`, and `ShieldedCoinPublicKey.fromHexString()`/`.toHexString()` handle the conversion in each direction.

**⚠️ Documentation does not match observed behavior**: The official comment in `ledger-v8.d.ts` states "hex-encoded 35-byte string," but testing shows the actual output is **32 bytes (64 hex characters)**. The `ShieldedCoinPublicKey` class itself defines `static readonly keyLength = 32`. Cross-verified against the existing Node CLI version's `src/api.ts:228-229` (`state.shielded.coinPublicKey.toHexString()`, already working correctly on mainnet), confirming that 32-byte hex is the actual accepted format — **the documentation comment has not kept pace with the implementation**. Round-trip verification (hex → object → hex) was consistent.

**Buffer polyfill required**: `wallet-sdk-address-format` internally uses Node's global `Buffer` directly, which does not exist in the browser; the `buffer` package must be installed and attached to `window.Buffer`. (Note: this differs from the Transaction serialization in section A above, which does not require a Buffer polyfill — the two layers must be evaluated independently.)

**C. TransactionId for `submitTx`**

Official interface: `submitTx(tx: FinalizedTransaction): Promise<TransactionId>`; the connector's `submitTransaction(tx: string): Promise<void>` does not return a TransactionId at all — it must be computed locally from the Transaction.

The `Transaction` class exposes both `identifiers(): TransactionId[]` and `transactionHash(): TransactionHash`. **Use `identifiers()`, not `transactionHash()`** — the official comment explicitly states that `transactionHash()` "should not be used to track a specific transaction, since transactions may be merged," while every identifier returned by `identifiers()` "can be used to track this specific transaction."

Verified: `identifiers()` returns an empty array `[]` on an unproven tx with no intent (not a bug — the test tx contained no contract call); after `mockProve()` + `bind()`, `transactionHash()` correctly returns a hex string. This auction contract's operation pattern (createAuction/placeBid/closeAuction, etc.) always issues a single call per transaction and never merges multiple intents, so `identifiers()[0]` is the correct answer for this project.

### 7.2 Not Yet Completed

- Real `balanceTx()` call test (requires a DUST balance; the wallet is currently being funded, full flow not yet tested)
- Real on-chain `submitTx()` test (deliberately deferred to avoid accidentally submitting a transaction mid-debugging)

---

## 8. Build Environment Pitfall: Vite's Support Gap for WASM ESM Imports

**Symptom**: Before `getProvingProvider` was even triggered by connecting to Lace, an error appeared before any console.log output:

```
midnight_ledger_wasm.js:5:6
Cannot access '__wbindgen_start' before initialization
```

**Root cause**: `@midnight-ntwrk/ledger-v8` (the underlying dependency of `midnight-js-types`/`dapp-connector-api`, produced by wasm-bindgen) uses the "WebAssembly ESM Integration" proposal syntax, directly writing `import * as wasm from "./xxx_bg.wasm"`. This syntax is not supported by default in browsers or by Vite/esbuild; without a corresponding plugin to transform it, the wasm module's initialization order breaks.

**Solution**: Installed `vite-plugin-wasm` (3.6.0) + `vite-plugin-top-level-await` (1.6.0), the standard pairing commonly used in official Midnight example dApps. This only affects how the build pipeline handles `.wasm` imports and does not touch business logic code.

### 8.2 A Type Declaration Bug in the vite-plugin-wasm Package Itself

**When discovered**: Only after a Vercel production deployment failure. Locally, only `npx tsc --noEmit` (a partial check) had been run — a full `npm run build` (actual command: `tsc -b && vite build`) had never been run, so `vite.config.ts` itself was never fully type-checked, causing the build to "appear fine" locally while failing outright on deployment. **Lesson: for any future change, the verification command must always be `npm run build`, not just `tsc --noEmit`.**

**Error message**:
vite.config.ts(15,37): error TS2349: This expression is not callable.
Type 'typeof import(".../vite-plugin-wasm/dist/index")' has no call signatures.

**Root cause**: The `vite-plugin-wasm` package's own type declarations are inconsistent with its actual runtime file — `package.json`'s `exports."import".types` points to `dist/index.d.ts` (typed as `export default function wasm(): any`), but the runtime actually loads `exports/import.mjs`, whose flattening of the default export does not match the type declaration. Under TypeScript's `nodenext` module resolution, `import wasm from 'vite-plugin-wasm'` is misinterpreted as the entire module object (`typeof import(...)`) rather than the function itself, hence the `not callable` error.

**Fixes tested but not adopted**:
- Adding `esModuleInterop: true` → the type error persisted
- Changing to `wasm.default()` → type-checking passes, but **testing with a direct Node `require`** confirmed that at runtime, `wasm` itself is the function — there is no `.default` property at all. This would make the build pass while breaking the app at runtime, which is harder to diagnose than the original build failure, so it was not adopted.

**Final solution**: After the import, apply a narrowly-scoped type correction using `as unknown as () => Plugin`, matching the actual runtime type confirmed via Node testing, with a code comment explaining the reasoning (this is not lazily bypassing type-checking with `any` — it corrects a mislabeled type declaration in the upstream package).

**Follow-up**: This is a bug in the upstream `vite-plugin-wasm` package itself, not an architectural issue in this project. When upgrading this package in the future, first check whether this type declaration inconsistency has been fixed upstream; if so, this workaround can be removed.
---

## 9. Developer Notes & Known Pitfalls

1. **Lace's lack of support for `getProvingProvider`/`hintUsage` is a known version gap** — do not waste time re-investigating this same issue. Prioritize testing the proof delegation path with 1AM. If Lace is updated in the future, re-test whether this has been fixed.
2. **Never host a public proof server for user browsers to connect to** — this violates the core value proposition of a private auction; users' private inputs should not pass through a developer-controlled server. If a proving path needs to be provided for Lace users, the direction is "guide the user to run a proof server locally themselves," not "the developer hosts one on their behalf."
3. **Do not derive an encryption key from a signature result** — ECDSA/EdDSA-class signature algorithms are non-deterministic by design, on any chain; this is not a Midnight-specific limitation.
4. **`ledger-v8.d.ts`'s documentation comments may lag behind the actual implementation** (the 35-byte vs. observed 32-byte case is one example). When type definitions/documentation conflict with the existing Node CLI code (`src/api.ts`) that already works on mainnet, trust the behavior of the existing working code and cross-verify.
5. **Use `identifiers()`, not `transactionHash()`**, to obtain an ID usable for tracking a specific transaction.
6. The Buffer polyfill is only needed at the `wallet-sdk-address-format` layer; `Transaction` serialization does not need it — avoid redundant checks or adding it unnecessarily.
7. The Vite wasm plugins (`vite-plugin-wasm` + `vite-plugin-top-level-await`) are a prerequisite for any feature depending on `ledger-v8`. If the project switches to a different build tool in the future (e.g., the previously mentioned rolldown-vite), compatibility needs to be re-confirmed — this has not been fully verified yet. When encountering wasm initialization errors, check the plugin configuration first.

---

## 10. Draft GitHub Issue for the Official Repo (Lace Wallet)

**Repository**: `midnightntwrk/midnight-dapp-connector-api` (or the Lace wallet's own repo, depending on actual ownership)

**Title**: `Lace wallet reports getProvingProvider/hintUsage as present but throws on call (apiVersion 4.0.1)`

**Environment**:
- `@midnight-ntwrk/dapp-connector-api`: 4.0.1
- Lace wallet apiVersion: 4.0.1 (as declared)
- Network: mainnet
- Browser: (TODO: fill in the actual Chrome version used for testing)

**Steps to reproduce**:
1. Connect to the Lace wallet via `connect('mainnet')` to obtain a `ConnectedAPI`
2. Confirm `typeof connectorAPI.getProvingProvider === 'function'` → `true`
3. Call `connectorAPI.getProvingProvider(keyMaterialProvider)`

**Expected behavior**: Per the `dapp-connector-api` v4.0.1 type definitions, `getProvingProvider` is a required (non-optional) method on `WalletConnectedAPI` and should return `Promise<ProvingProvider>` when called.

**Actual behavior**: The call throws a `TypeError` immediately (not a Promise rejection), indicating the underlying value is actually `undefined`, despite the `typeof` check showing the property exists. The `hintUsage` method exhibits the same behavior.

**Additional information**: The same call sequence works correctly with the 1AM wallet (same `dapp-connector-api@4.0.1` version) — `getProvingProvider` successfully returns an object with `check`/`prove` methods. The community forum already has another developer reporting the same issue: [Lace wallet doesn't implement getProvingProvider() - Midnight Forum](https://forum.midnight.network/t/lace-wallet-doesnt-implement-getprovingprovider-expected-behavior-or-version-gap/1213)

**Impact**: Any dApp relying on `getProvingProvider` to delegate ZK proof generation (the officially recommended proving architecture, replacing the older local proof-server-URL model) is completely non-functional for Lace users, forcing them to either switch wallets or self-host a local proof server.

*(Before submitting, fill in the tested browser version and the full error stack trace, and decide whether to attach a minimal reproduction repo.)*

---

## 11. Remaining Work (To Continue Next Time)

- [ ] Wire up the UI password input field (used to unlock private state)
- [ ] Assemble the complete `AuctionProviders` integration object and connect it to the actual bid/create-auction buttons
- [ ] Real `balanceTx()` call test (pending DUST funding)
- [ ] Real on-chain `submitTx()` test (including the full e2e flow: createAuction → placeBid → closeAuction → revealBid → claimItem)
- [ ] Fallback UX copy for Lace users (messaging for when `getProvingProvider` is unavailable)
- [ ] As needed, finalize the issue draft in Section 10 and submit it to the official repo

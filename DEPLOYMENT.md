# Deployment

This document covers deployment history, environment setup, deployment steps, and known limitations for the Midnight Private Auction contract and frontend. For architecture and contract concepts, see [README.md](README.md).

---

## Network Context

Midnight mainnet launched in 2026. As of block **1,498,136** (~3 months post-launch), this contract is **one of 114 contracts deployed on Midnight mainnet**.

| | |
|---|---|
| Active contract | [`4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5`](https://explorer.1am.xyz/contract/4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5) |
| Network | Midnight Mainnet |
| Generation | M3 |
| Status | ✅ Current |

---

## Deployment History

### M3 (Current) — deployed 2026-07-06

Adds `description`, `startingPrice`, `endTime`, `revealDeadline` ledger fields and the `finalizeAuction` circuit (auctioneer reclaims the item if no valid bids were revealed by the reveal deadline).

| | |
|---|---|
| Contract Address | [`4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5`](https://explorer.1am.xyz/contract/4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5) |
| Network | Midnight Mainnet |
| Status | ✅ Current |

**Verified transaction hashes (M3, scripted e2e)**

Full `createAuction` → `placeBid` → `closeAuction` → `revealBid` → `claimItem` flow, verified against the contract address above:

| Step | Tx Hash | Block |
|------|---------|-------|
| createAuction | `0097eff61499d18c31a88c9295a560611ea3aebec7f7b7735b43aa56b0b2eb0048` | 1,569,783 |
| placeBid | `00de38ac0c03a74f9d323c198eafd94f1a2e64d228793dc3623c28beff7c381fb2` | 1,569,787 |
| closeAuction | `00e24633d0ad11acff800c9f65efe7ceb1a6d68f1ccd947df5eb0ffb284e1f6134` | 1,569,791 |
| revealBid | `00b34740053629d82696eee3943928bb850706a6401088118c32d2b92b79e6bcde` | 1,569,795 |
| claimItem | `00259968be1d8af35df4b8ce0f78399c808550429a566b7e719c31da2e59d2b4bf` | 1,569,799 |

Final state: `item = "M2 e2e Item"`, `highestBid = 100`, `bidCount = 1`, `claimed = true`

**Verified transaction hashes (M3, frontend e2e)**

Full `createAuction` → `placeBid` (×2) → `closeAuction` → `revealBid` (×2) → `claimItem` flow, run through the deployed frontend UI (1AM wallet, two bidders, real mainnet transactions) on 2026-07-06:

| Step | Tx Hash |
|------|---------|
| createAuction | `dabade00ee816a914d5d36e0b22b890b7745f553300cf9dda25c9c8e574124e1` |
| placeBid (bidder 1) | `fdfc3aeac994171a2b79f8a2183957393d8d9e542e2bc7de3afc6d07f5e589d7` |
| placeBid (bidder 2) | `0af01384b366749130626a085601a0bdd3d3bc744ae6c7b416b8d3808a7a69c7` |
| closeAuction | `a10611ead44bfe3d21a6df07e22cd7d22e9869f104e4f92c675112c20179110e` |
| revealBid (bidder 1) | `10f1a54398468e8e395bcf06c60f233e1147c8dae0b61030ab0bdb546678d35b` |
| revealBid (bidder 2) | `03510138677d4bf13f75ce232bcc7e185e39c50515ca641167ee95c8a3a1053d` |
| claimItem | `b228976211ee63b0f3e3ae7b6a871afc6de9dd066a64c8ed5770be58549fd19b` |

Final state: `item = "Midnight Genesis #001"`, `highestBid = 130`, `bidCount = 2`, `claimed = true`

## Zero-Bid Finalization Test (2026-07-09)

Contract: `4fd31443...3282e5`

| # | Operation | Block | Tx Hash |
|---|-----------|-------|---------|
| 1 | createAuction (Zero Bid Test) | 1,609,003 | `3d6cf2ee6d...f9d3c7` |
| 2 | closeAuction | 1,609,655 | `a517822eea...c9e307` |
| 3 | finalizeAuction (no sale) | 1,609,935 | `004cc47d35...91df50` |

## Auction #4 — Step-by-Step Flow (2026-07-16)

Contract: `4fd31443...3282e5`

First run split across three separate scripted invocations (`scripts/create-and-bid.ts`, `scripts/close-and-reveal.ts`, `scripts/claim-item.ts`) instead of one continuous e2e process — createAuction/placeBid ran immediately, then closeAuction/revealBid/claimItem ran hours later after `endTime` had passed. Bidder (and, since, auctioneer) secret state is persisted to `logs/pending-reveals/<auctionId>.json` (git-ignored) so the later scripts can reconstruct the exact private state needed to close, reveal, and claim.

`title = "Cardano Midnight Pioneer Badge #001"`, `startingPrice = 100`, `winningBid = 200`

| Step | Tx Hash | Block |
|------|---------|-------|
| createAuction | `00d57bca3305157ebbf225e6c5da67669a93d2c077cd6459d8a3b0559a34c6d030` | 1,709,589 |
| placeBid | `007ef91e8b77fb6f9d8ccfac68e8ca1e1ec9edcc82b9c50517d178f313261c14eb` | 1,709,593 |
| closeAuction | `004d078d45b5bf08428306adc7a89843934c1f18734abab3e1820076a8a3ab548a` | 1,710,871 |
| revealBid | `009a87a04d4c9c7d08c4d50dd2e072d296795d42227d5ab3a306e970da880144e1` | 1,710,875 |
| claimItem | `0018ba0ead13ae1fb5537a482334eda024db21713cf9e089f55ca8d35f2811bf9c` | 1,710,917 |

Final state: `item = "Cardano Midnight Pioneer Badge #001"`, `highestBid = 200`, `bidCount = 1`, `claimed = true`

---

### M2 (Deprecated) — deployed 2026-07-05, superseded 2026-07-06

Multi-auction contract redesign: single-auction → multi-auction architecture, auto-incremented `auctionId` per auction, on-circuit single-bid-per-auction enforcement.

| | |
|---|---|
| Contract Address | [`19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80`](https://explorer.1am.xyz/contract/19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80) |
| Network | Midnight Mainnet |
| Status | ⚠️ Deprecated — superseded by M3 |

**Verified transaction hashes (M2, scripted e2e)**

| Step | Tx Hash | Block |
|------|---------|-------|
| createAuction | `007678e121afb7d0f7ec5559a67c513eafb1d01f7d48fb5d5488bb11be0e770a56` | 1,559,374 |
| placeBid | `00b5b503498af9356d9fc7d7ea8dd8ea6203047a73dd4023ecac81469d5e32b2b4` | 1,559,378 |
| closeAuction | `0078907635e72a201edf0e08304d007676ed9aec74e4b3fbb91d07a03f8c9962c6` | 1,559,381 |
| revealBid | `006270fdcb5383600b5a84de9aa6e3c6c1e8e9b4c0755b975bddaf155347caee57` | 1,559,385 |
| claimItem | `00bb62e5d1863884db547f0ac561e1244a3899bd3fd12dcd81ddc9e996d9f5adb3` | 1,559,389 |

Final state: `item = "M2 e2e Item"`, `highestBid = 100`, `bidCount = 1`, `claimed = true`

**Verified transaction hashes (M2, frontend manual test)**

| Step | Tx Hash | Block |
|------|---------|-------|
| createAuction (frontend) | `d4f907409759a8472806b7e5a4b13e4f7e20c82fd3fba3ae05448cdd7615a4b7` | 1,565,665 |
| placeBid (frontend) | `e82cf747d6b60866998bc7a21ca9860c671f3ec0a2f5ca6958857a7b46c35b77` | 1,566,708 |
| closeAuction (frontend) | `10f9f13c218ea4a69c24a506adf6297bd4742cd761adeb85e7c1326f151f5fbb` | 1,566,989 |
| revealBid (frontend) | `509368f756b5abf6c1859f6bc8b116142b2c716e2355a287c43620d9b8ebf74e` | 1,567,004 |
| claimItem (frontend) | `5bdf4fbf9fb99832f4bcd2b7adeea2e87625e042b35eababcbaf1fbe135f3f61` | 1,567,021 |

---

### M1 (Deprecated) — deployed 2026-06-30, superseded 2026-07-05

Original sealed-bid demo. Single-auction contract with the ZK commit-reveal privacy model.

| | |
|---|---|
| Contract Address | [`872becfbc9d3142273c5dc5b7b1df5dae0fd0ee467c8857ea4e97f9a0408c21b`](https://explorer.1am.xyz/contract/872becfbc9d3142273c5dc5b7b1df5dae0fd0ee467c8857ea4e97f9a0408c21b) |
| Network | Midnight Mainnet |
| Status | ⚠️ Deprecated — superseded by M2 |

Full 7-step e2e verified on mainnet: deploy → bid (×2) → close → reveal (×2) → claim. Introduced the 3-phase wallet sync with checkpoint persistence, the WASM memory guard, and `MIDNIGHT_DEPLOY_NODE` routing (deploy via authorised RPC, all other steps via public RPC) — see [Known Limitations](#known-limitations) below.

---

### Hash format note

The Midnight SDK returns 66-character tx IDs (33 bytes, with a `00` version prefix byte). The public indexer stores 64-character Substrate extrinsic hashes (32 bytes). These are different encodings of the same transaction. **Block height is the authoritative cross-reference** between the two formats.

---

## Environment Setup

| Variable | Required | Used for | Description |
|---|---|---|---|
| `WALLET_SEED` | Yes | Deploy, run | Hex seed for the deploying/operating wallet. If unset in non-deploy scripts, a fresh wallet is generated |
| `MIDNIGHT_NETWORK` | Optional | Deploy, run | `preprod` (default) or `mainnet` |
| `MIDNIGHT_PROOF_SERVER` | Optional | Deploy, run | Override proof server URL (default: `http://127.0.0.1:6300`) |
| `MIDNIGHT_INDEXER` | Mainnet only | Deploy, run | Indexer GraphQL HTTP endpoint |
| `MIDNIGHT_INDEXER_WS` | Mainnet only | Deploy, run | Indexer GraphQL WebSocket endpoint |
| `MIDNIGHT_NODE` | Mainnet only | Deploy, run | Public node RPC endpoint, used for wallet sync |
| `MIDNIGHT_DEPLOY_NODE` | Mainnet deploy only | Deploy | Authorised/private node RPC endpoint. Used **only** for the `contractDeploy` transaction — see [Known Limitations](#known-limitations) |

**Prerequisites**

- Node.js ≥ 22
- `compact` compiler in `PATH`
- Midnight Proof Server running locally (default port 6300)
- Night tokens funded to the deploying wallet — real mainnet tokens for mainnet deploys, [faucet](https://faucet.preprod.midnight.network) tokens for preprod

---

## Deployment Steps

1. **Compile the contract from source** (pre-compiled artifacts are already committed under `contract/src/managed/auction/`, so this step is only needed after editing `auction.compact`):
   ```bash
   npm run compile
   ```

2. **Verify against preprod first.** Run the full scripted e2e flow (deploy → bid → close → reveal → claim) on preprod to catch regressions before spending real Night tokens:
   ```bash
   WALLET_SEED=<hex> npm run preprod
   ```

3. **Deploy to mainnet** using the deploy-only script (`src/deploy-only.ts`):
   ```bash
   MIDNIGHT_NETWORK=mainnet \
   MIDNIGHT_INDEXER=<url> MIDNIGHT_INDEXER_WS=<url> MIDNIGHT_NODE=<url> \
   MIDNIGHT_DEPLOY_NODE=<authorised-rpc-url> \
   WALLET_SEED=<hex> npm run deploy:mainnet
   ```
   The script:
   - Syncs the wallet from checkpoints (or genesis on first run — see wallet sync phases in [README.md](README.md#quick-start))
   - Generates a fresh auctioneer secret key and private state
   - If `MIDNIGHT_DEPLOY_NODE` is set, builds a second wallet instance pointed at that endpoint, routes **only** the `contractDeploy` transaction through it, then stops that wallet and falls back to the public RPC for everything else
   - Prints the resulting contract address, deploy tx hash, and block height

4. **Record the new contract address.** Update the `README.md` "Live Demo" contract reference and this file's "Network Context" section with the new contract ID, then re-verify with:
   ```bash
   MIDNIGHT_NETWORK=mainnet WALLET_SEED=<hex> npm run e2e:existing:mainnet
   ```
   which runs the same createAuction → claimItem flow against an **existing** deployed contract address (set inside the script/config), rather than deploying a new one.

5. **Deploy the frontend.** The `frontend/` app is a static Vite build deployed to Vercel (see `vercel.json`: `buildCommand: npm run build`, `outputDirectory: dist`). Update the contract address used by the frontend, then deploy via the Vercel CLI or dashboard as usual.

---

## Known Limitations

**Deploy transaction size exceeds public RPC limits**

A Midnight contract deploy transaction embeds the ZK verifier keys for every circuit in the contract. For this auction contract (6 impure circuits: `createAuction`, `placeBid`, `closeAuction`, `revealBid`, `claimItem`, `finalizeAuction`), the resulting transaction exceeds the per-transaction size limit enforced by the public RPC (`rpc.mainnet.midnight.network`), causing an immediate `1016: Immediately Dropped` rejection regardless of mempool state.

All post-deploy transactions carry only the ZK proof for a single circuit and succeed on the public RPC without issue. **`contractDeploy` must target an authorised/private RPC endpoint** — set `MIDNIGHT_DEPLOY_NODE` to route only that one transaction through it.

**ShieldedWallet WASM memory leak during genesis sync**

ShieldedWallet runs a WASM-backed ZSwap commitment tree. WASM linear memory can only grow, never shrink. During Phase 1 of wallet genesis sync (DustWallet syncing while ShieldedWallet is idle), if ShieldedWallet is allowed to start normally it enters a retry loop replaying thousands of ledger events, leaking several MB of WASM memory per retry. Over a 3–4 hour genesis sync this accumulates to crash-level (observed hard machine lockup at ~11 GB RSS on the first attempt).

Workaround: construct a `shielded-temp.json` stub with an empty `ZswapLocalState` and `offset = chain tip`, so ShieldedWallet immediately hits a non-linear commitment tree error and stays in a tight, low-memory retry loop while DustWallet syncs. A 9 GB RSS watchdog exits cleanly if an RPC disconnect stalls DustWallet long enough for retries to accumulate anyway.

**Wallet genesis sync time**

First run requires a 3-phase wallet sync (DustWallet genesis, ShieldedWallet genesis, then a fast checkpoint-restore path). Phases 1 and 2 each take 10–20 minutes with peak RAM of 7–8 GB. Checkpoints are saved to `.wallet-state/` (git-ignored); subsequent runs restore from checkpoint in under 30 seconds.

**`signTransactionIntents` workaround**

The wallet SDK's `balanceUnboundTransaction` does not automatically apply the unshielded signer's signature to transaction intents in some SDK versions. The `signTransactionIntents` helper in `src/api.ts` manually deserialises each intent, signs the payload, and re-attaches the signatures to both `fallibleUnshieldedOffer` and `guaranteedUnshieldedOffer` before finalising the recipe.

**Tx hash format mismatch**

See [Hash format note](#hash-format-note) above — SDK tx IDs (66-char) and public indexer hashes (64-char) are different encodings of the same transaction; cross-reference by block height, not by string equality.

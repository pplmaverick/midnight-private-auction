# Midnight Private Auction

## 🌐 Live Demo
https://midnight-private-auction.vercel.app

![CI](https://github.com/pplmaverick/midnight-private-auction/actions/workflows/test.yml/badge.svg)
![Network](https://img.shields.io/badge/Midnight_Network-Preprod%20%7C%20Mainnet-blue)
![Compact](https://img.shields.io/badge/Compact-0.20-purple)
![License](https://img.shields.io/badge/license-MIT-green)

Sealed-bid auction on Midnight Network. During the bidding phase, bid amounts and bidder identities are hidden by ZK proofs — chain observers can see that a `placeBid()` call occurred, but not who made it or how much they bid. The amount only appears on-chain when the bidder voluntarily calls `revealBid()`. Purpose-built for Midnight's Compact language, not a port from EVM.

**Mainnet Deployment**

Contract deployed and full e2e verified on Midnight mainnet (2026-06-30).

| | |
|---|---|
| Contract Address | [`19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80`](https://explorer.1am.xyz/contract/19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80) |
| Network | Midnight Mainnet |

**Verified Transaction Hashes**

_Pending — the M1 contract's 7-step e2e verification table lived here, but those hashes belong to the previous single-auction contract address and no longer apply to the M2 contract above. Will be replaced once the M2 multi-auction e2e flow is verified._

> **Hash format note:** The Midnight SDK returns 66-character tx IDs (33 bytes, with a `00` version prefix byte). The public indexer stores 64-character Substrate extrinsic hashes (32 bytes). These are different encodings of the same transaction. Block height is the authoritative cross-reference.

---

## Why Midnight-Native

This project is not ported from another chain. Every design decision maps to a Midnight-native capability.

| Problem | Generic EVM approach | Midnight-native approach |
|---|---|---|
| Bid privacy during bidding | Bids are public in calldata the moment they're sent | Bid amount lives in Compact private state; only a ZK commitment hash goes on-chain |
| Preventing frontrunning | Manual commit-hash schemes in Solidity | Privacy enforced by the Compact compiler and ZK circuit — no manual scheme needed |
| Bidder identity | EOA address trivially linkable across bids | Domain-separated `bidderPublicKey = H("auction:bidder:", sk)` derived per-auction |
| Reveal integrity | Trust event logs or off-chain computation | ZK circuit asserts `H(sk, amount, salt) == stored commitment` before accepting reveal |

---

## Architecture

```
BIDDING PHASE

  Bidder local private state         Midnight ledger (public, on-chain)
  ┌─────────────────────────┐        ┌────────────────────────────────────┐
  │  localSecretKey  (sk)   │─┐      │                                    │
  │  myBidAmount    (amount)│─┼─ZK──►│  sealedBids[bidderPK]              │
  │  myBidSalt      (salt)  │─┘ proof│    = H("auction:seal:", sk, amt, salt) │
  └─────────────────────────┘        │  bidCount++                        │
                                     └────────────────────────────────────┘
  Chain observers see: bidderPK + 32-byte hash
  Chain observers cannot see: amount, salt, secretKey


REVEAL PHASE  (after closeAuction)

  Bidder discloses                   Midnight ledger verifies & updates
  ┌─────────────────────────┐        ┌────────────────────────────────────┐
  │  amount = 200           │──ZK───►│  assert H(sk, 200, salt)           │
  │  salt   = 0xabc...      │  verify│    == sealedBids[bidderPK]          │
  └─────────────────────────┘        │  if 200 > highestBid:              │
                                     │    highestBid = 200                │
                                     │    highestBidderPK = bidderPK      │
                                     └────────────────────────────────────┘
```

---

## Core Features

### Sealed Bids via ZK Commitment

`placeBid()` computes `commitment = persistentHash("auction:seal:", sk, amount, salt)` entirely inside the ZK circuit. The amount is a Compact `witness` — it is never serialised into the transaction or posted to the indexer. Chain observers learn only that a valid sealed bid exists.

### Compact Private State as Bid Vault

Compact's `witness` declarations (`localSecretKey`, `myBidAmount`, `myBidSalt`) act as a type-safe private state vault. The TypeScript SDK stores these locally in LevelDB per role identity (`auctioneer`, `bidder1`, `bidder2`) and passes them to the circuit at prove-time — they never leave the prover machine.

### ZK Commitment Verification in Reveal

`revealBid(amount, salt)` recomputes the commitment inside the circuit and asserts it matches the stored on-chain hash before updating the leaderboard. The Compact compiler enforces that `disclose(amount)` appears unconditionally before any comparison, preventing the circuit from leaking branch outcome to observers (see Implementation Notes).

---

## Quick Start

**Prerequisites**
- Node.js ≥ 22
- `compact` compiler in `PATH`
- Midnight Proof Server running locally (default port 6300)
- Night tokens — Preprod: [faucet](https://faucet.preprod.midnight.network); Mainnet: real tokens

```bash
git clone git@github.com:pplmaverick/midnight-private-auction.git
cd midnight-private-auction
npm install
```

**Environment variables**

| Variable | Required | Description |
|---|---|---|
| `WALLET_SEED` | Optional | Hex seed to reuse an existing wallet; if unset, a fresh wallet is generated |
| `MIDNIGHT_NETWORK` | Optional | `preprod` (default) or `mainnet` |
| `MIDNIGHT_PROOF_SERVER` | Optional | Override proof server URL (default: `http://127.0.0.1:6300`) |
| `MIDNIGHT_INDEXER` | Mainnet only | Indexer GraphQL HTTP endpoint |
| `MIDNIGHT_INDEXER_WS` | Mainnet only | Indexer GraphQL WebSocket endpoint |
| `MIDNIGHT_NODE` | Mainnet only | Node RPC endpoint |

```bash
# Recompile contract from source (pre-compiled artifacts are committed)
npm run compile

# Run on Preprod
WALLET_SEED=<hex> npm run preprod

# Run on Mainnet
MIDNIGHT_INDEXER=<url> MIDNIGHT_INDEXER_WS=<url> MIDNIGHT_NODE=<url> \
WALLET_SEED=<hex> npm run mainnet
```

**Wallet sync phases**

On first run the wallet must sync from genesis. The script handles this automatically in three phases:

| Phase | What happens | Time | Peak RAM |
|---|---|---|---|
| Phase 1 | DustWallet genesis sync; ShieldedWallet deliberately idle via stub | 10–20 min | ~8 GB |
| Phase 2 | ShieldedWallet genesis sync; DustWallet restores from checkpoint | 10–20 min | ~7 GB |
| Phase 3 | Both wallets restore from saved checkpoints — fast path | < 30 sec | < 1 GB |

Checkpoints are saved to `.wallet-state/` (git-ignored). Subsequent runs go straight to Phase 3.

---

## Contract Interface

**File:** `contract/src/auction.compact`

```
// Pure circuits (no state change)
bidderPublicKey(sk: Bytes<32>): Bytes<32>
computeCommitment(sk: Bytes<32>, auctionId: Uint<32>, amount: Uint<32>, salt: Bytes<32>): Bytes<32>

// Impure circuits (change ledger state)
createAuction(item: Opaque<"string">): Uint<32>                    — auctioneer only
placeBid(auctionId: Uint<32>): []                                  — any bidder, BIDDING phase
closeAuction(auctionId: Uint<32>): []                              — auctioneer only
revealBid(auctionId: Uint<32>, amount: Uint<32>, salt: Bytes<32>): []   — any bidder, CLOSED phase
claimItem(auctionId: Uint<32>): []                                 — highest bidder only
```

**Auction phase transitions**

```
VACANT  ──createAuction()──►  BIDDING  ──closeAuction()──►  CLOSED
```

---

## Security

**Privacy boundary**

What a chain observer (or block explorer) can see for each `placeBid()` transaction:

| Observable | Visible? | Notes |
|---|---|---|
| Function called (`placeBid`) | ✓ Yes | Transaction metadata is public |
| When it occurred (block number) | ✓ Yes | Transaction metadata is public |
| Fee paid | ✓ Yes | DUST fee amount is public |
| **Sender / bidder address** | **✗ No** | No "from" field — DUST fee is paid via shielded mechanism |
| **Bid amount** | **✗ No** | Compact `witness` — never serialised into the transaction |
| **Commitment hash preimage** | **✗ No** | Without `(sk, amount, salt)` the on-chain hash reveals nothing |

Compare with an equivalent EVM contract: `placeBid(uint256 amount, bytes32 salt)` would expose both the sender address and the bid amount in calldata, permanently and publicly. On Midnight, the function name is visible but the meaningful data (who and how much) is not.

**Commitment properties**

- **Commitment binding:** each commitment is tied to `localSecretKey` — a bidder cannot replay another bidder's commitment
- **Commitment hiding:** without all three of `sk`, `amount`, and `salt`, the on-chain hash reveals nothing
- **Auctioneer auth:** `closeAuction()` asserts `auctioneerPK == bidderPublicKey(localSecretKey())` inside the ZK circuit — no external role system needed
- **Claim guard:** `claimItem()` asserts the caller's derived public key equals `highestBidderPK` and `highestBid > 0` and `!itemClaimed`
- **No private key on-chain:** all secret material stays in Compact `witness` — never serialised into any transaction
- **Single bid enforcement:** `placeBid()` asserts the caller has not previously submitted a sealed bid for this auction — each bidder may place exactly one bid per auction, enforced on-circuit

---

## Implementation Notes

**`disclose()` placement constraint in Compact**

The Compact compiler enforces that `disclose()` cannot appear inside a conditional branch — if it did, chain observers could infer the branch outcome from whether a disclosure event fired. In `revealBid`, this means `amount` must be disclosed unconditionally _before_ the `if (pubAmount > highestBid)` comparison:

```compact
const pubAmount = disclose(amount);   // disclose first — required by compiler
if (pubAmount > highestBid) {         // comparison is between two already-public values
  highestBid = pubAmount;
```

Attempting `if (amount > highestBid) { highestBid = disclose(amount); }` fails to compile with a hard error. Since `revealBid` is the reveal phase, disclosing unconditionally is correct by design.

**ShieldedWallet WASM memory leak — Phase 1 stub**

ShieldedWallet runs a WASM-backed ZSwap commitment tree. WASM linear memory can only grow, never shrink. During Phase 1 (DustWallet genesis sync), if ShieldedWallet is allowed to start normally it enters a retry-loop replaying thousands of ledger events — each retry leaks several MB of WASM memory. On a 3–4 hour genesis sync this accumulates to crash-level (machine hard-locked at ~11 GB on the first attempt).

Solution: construct a `shielded-temp.json` stub with an empty `ZswapLocalState` and `offset = chain tip`. ShieldedWallet sees the offset as already-current, immediately hits a non-linear commitment tree error (`expected index 0, received N`), and stays in a tight retry loop consuming < 100 MB while DustWallet syncs in the foreground. A 9 GB RSS watchdog exits cleanly if an RPC disconnect stalls DustWallet long enough for retries to accumulate anyway.

**Deploy transaction size and RPC requirements**

A Midnight contract deploy transaction embeds the ZK verifier keys for every circuit in the contract. For this auction contract (5 circuits), this produces a transaction that exceeds the per-transaction size limit enforced by the public RPC (`rpc.mainnet.midnight.network`), causing an immediate `1016: Immediately Dropped` rejection regardless of pool state.

All post-deploy transactions (createAuction, placeBid, closeAuction, revealBid, claimItem) are significantly smaller — they carry only the ZK proof for their single circuit and succeed on the public RPC without issue.

**Practical requirement:** `contractDeploy` must target an authorised/private RPC endpoint. All other operations can use the public RPC. Set `MIDNIGHT_DEPLOY_NODE` to your authorised endpoint; the script routes only the deploy transaction through it and switches back automatically.

**`signTransactionIntents` workaround**

The wallet SDK's `balanceUnboundTransaction` does not automatically apply the unshielded signer's signature to transaction intents in some SDK versions. The `signTransactionIntents` helper in `api.ts` manually deserialises each intent, signs the payload, and re-attaches the signatures to both `fallibleUnshieldedOffer` and `guaranteedUnshieldedOffer` before finalising the recipe.

---

## Stack

| Layer | Technology |
|---|---|
| Smart contract | Compact 0.20 |
| ZK backend | Midnight Proof Server (local) |
| Runtime SDK | `@midnight-ntwrk/midnight-js` ^4.0.4 |
| Wallet | `@midnight-ntwrk/wallet-sdk-facade` ^3.0.0 (Shielded + Dust + Unshielded) |
| Private state storage | LevelDB via `midnight-js-level-private-state-provider` |
| Language | TypeScript (ESM, Node.js ≥ 22) |

---

## Roadmap

**✅ M1 — Sealed-bid demo, fully verified on mainnet (2026-06-30)**
- Compact contract with ZK commit-reveal privacy model
- Full 7-step e2e verified on Midnight mainnet: deploy → bid (×2) → close → reveal (×2) → claim
- Contract: [`872becfbc9d3142273c5dc5b7b1df5dae0fd0ee467c8857ea4e97f9a0408c21b`](https://explorer.1am.xyz/contract/872becfbc9d3142273c5dc5b7b1df5dae0fd0ee467c8857ea4e97f9a0408c21b)
- 3-phase wallet sync with checkpoint persistence
- WASM memory guard
- `MIDNIGHT_DEPLOY_NODE` routing: deploy via authorised RPC, all other steps via public RPC

**✅ M2 — Multi-auction contract redesign, deployed to mainnet (2026-07-05)**
- Redesigned from single-auction to multi-auction architecture
- Each auction identified by auto-incremented auctionId (no ID collision)
- Single bid enforcement per bidder per auction (on-circuit assertion)
- Contract: [`19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80`](https://explorer.1am.xyz/contract/19a01a461b85d71985aebac12d14f1a392a5797bb0013be87958f072f6cc5f80)

---

## Developer

GitHub: [pplmaverick](https://github.com/pplmaverick)

---

## License

MIT

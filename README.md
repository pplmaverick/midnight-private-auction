# Midnight Private Auction

## 🌐 Live Demo
https://midnight-private-auction.vercel.app

> Current Contract: [`4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5`](https://explorer.1am.xyz/contract/4fd31443997bd04bbf0b94e2ef3d5b0ff05479c4fb80bcac0dc74b2c763282e5) · Full deployment history, tx hashes, and block numbers: [DEPLOYMENT.md](DEPLOYMENT.md)

![CI](https://github.com/pplmaverick/midnight-private-auction/actions/workflows/test.yml/badge.svg)
![Network](https://img.shields.io/badge/Midnight_Network-Preprod%20%7C%20Mainnet-blue)
![Compact](https://img.shields.io/badge/Compact-0.20-purple)
![License](https://img.shields.io/badge/license-MIT-green)

## Overview

Sealed-bid auction on Midnight Network. During the bidding phase, bid amounts and bidder identities are hidden by ZK proofs — chain observers can see that a `placeBid()` call occurred, but not who made it or how much they bid. The amount only appears on-chain when the bidder voluntarily calls `revealBid()`. This is a commit-reveal auction implemented as a **Compact smart contract**, purpose-built for Midnight's ZK circuit model — not a port from an EVM contract.

As of block 1,498,136 (~3 months after Midnight mainnet launch), this contract is one of 114 contracts deployed on Midnight mainnet. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment history across three contract generations (M1–M3), including every verified transaction hash and block number.

---

## Why Midnight-Native

This project is not ported from another chain. Every design decision maps to a Midnight-native capability.

**The structural reason:** an EVM chain reaches consensus by having every validator re-execute a transaction against fully public state — so every input to that execution (sender, calldata, storage reads) must be public by construction. There is no way to keep an input private and still let validators independently verify the result.

Midnight breaks that coupling. A **Compact** contract compiles to a ZK circuit; the party submitting a transaction generates a proof (via the local Proof Server) that a valid state transition happened, using both public ledger state and private **witness** data as circuit inputs. Validators then check the proof, not the private inputs. Correctness is verified without the private data ever being reconstructible from what's on-chain. Bid privacy here isn't a feature bolted onto a public-by-default chain — it falls directly out of how Midnight validates transactions.

| Problem | Generic EVM approach | Midnight-native approach |
|---|---|---|
| Bid privacy during bidding | Bids are public in calldata the moment they're sent | Bid amount lives in Compact private state (`witness`); only a ZK commitment hash goes on-chain |
| Preventing frontrunning | Manual commit-hash schemes hand-rolled in Solidity | Privacy enforced by the Compact compiler and ZK circuit — no manual scheme needed |
| Bidder identity | EOA address trivially linkable across bids | Domain-separated `bidderPublicKey = H("auction:bidder:", sk)` derived from a local secret, never transmitted |
| Reveal integrity | Trust event logs or off-chain computation | ZK circuit asserts `H(sk, auctionId, amount, salt) == stored commitment` before accepting a reveal |
| Double-bid prevention | Requires an explicit "hasBid" mapping keyed by `msg.sender` | Nullifier-style on-circuit assertion: `placeBid` rejects a second bid the moment the caller's derived `bidderPublicKey` is already a key in that auction's `sealedBids` map |

---

## Architecture

Two things are true on Midnight at once: everyone can see the ledger, and no one but the bidder can see the bid. The diagram below shows what crosses that boundary and what never does.

```
BIDDING PHASE

  Bidder local private state          Midnight ledger (public, on-chain)
  ┌──────────────────────────┐        ┌─────────────────────────────────────┐
  │ localSecretKey   (sk)    │─┐      │                                     │
  │ myBidAmount   (amount)   │─┼─ZK──►│ sealedBids[auctionId][bidderPK]     │
  │ myBidSalt       (salt)   │─┘ proof│   = H("auction:seal:", sk,          │
  └──────────────────────────┘        │        auctionId, amount, salt)     │
                                      │ bidCount[auctionId]++                │
                                      └─────────────────────────────────────┘
  Chain observers see: bidderPK + a 32-byte opaque hash
  Chain observers cannot see: amount, salt, secretKey


REVEAL PHASE  (after closeAuction)

  Bidder discloses                    Midnight ledger verifies & updates
  ┌──────────────────────────┐        ┌─────────────────────────────────────┐
  │ amount = 200             │──ZK───►│ assert H(sk, auctionId, 200, salt)  │
  │ salt   = 0xabc...        │  verify│   == sealedBids[auctionId][bidderPK]│
  └──────────────────────────┘        │ if 200 > highestBid[auctionId]:     │
                                      │   highestBid = 200                  │
                                      │   highestBidderPK = bidderPK        │
                                      └─────────────────────────────────────┘
```

The circuit itself is compiled once from `contract/src/auction.compact` down to WASM-executable ZK IR (`.zkir` files) plus per-circuit prover/verifier key pairs, committed under `contract/src/managed/auction/`. Every `placeBid`, `revealBid`, etc. call runs its circuit's WASM through the local Proof Server to produce a proof, which is what actually gets submitted on-chain — the circuit logic never runs on a public node.

---

## Core Features

### Sealed Bids via ZK Commitment

`placeBid()` computes `commitment = persistentHash("auction:seal:", sk, auctionId, amount, salt)` entirely inside the ZK circuit. `amount` and `salt` are Compact `witness` values — they are never serialised into the transaction or posted to the indexer. Chain observers learn only that a valid sealed bid exists for a given `bidderPK` in a given auction.

### Compact Private State as a Bid Vault

Compact's `witness` declarations (`localSecretKey`, `myBidAmount`, `myBidSalt`) act as a type-safe private state vault, distinct from the public `ledger` declarations. The TypeScript SDK stores these locally in LevelDB per role identity (`auctioneer`, `bidder1`, `bidder2`) and passes them to the circuit at prove-time — they never leave the prover's machine.

### ZK Commitment Verification and Nullifier-Style Enforcement in Reveal

`revealBid(amount, salt)` recomputes the commitment inside the circuit and asserts it matches the stored on-chain hash before updating the leaderboard. Two enforcement mechanisms make this safe without any off-chain bookkeeping:
- **Single-bid enforcement**, checked in `placeBid`: once a bidder's derived public key exists as a key in `sealedBids` for an auction, the circuit rejects a second `placeBid` call from that same key — functionally a nullifier, scoped per-auction.
- **Disclosure-ordering enforcement**, checked by the Compact compiler itself in `revealBid`: `disclose(amount)` must happen unconditionally before the `if (pubAmount > highestBid)` comparison, so branch outcome never leaks unrevealed information (see [Implementation Notes](#implementation-notes)).

---

## Contract Interface

**File:** `contract/src/auction.compact` · Compact pragma `>= 0.20`; committed build artifacts were compiled with compact compiler `0.31.0` / language version `0.23.0` (see `contract/src/managed/auction/compiler/contract-info.json`).

```
// Pure circuits (computation only, no proof, no state change)
bidderPublicKey(sk: Bytes<32>): Bytes<32>
computeCommitment(sk: Bytes<32>, auctionId: Uint<32>, amount: Uint<32>, salt: Bytes<32>): Bytes<32>

// Impure circuits (proof required, ledger state changes)
createAuction(item: Opaque<"string">, desc: Opaque<"string">, startPrice: Uint<32>,
              auctionEndTime: Uint<64>, auctionRevealDeadline: Uint<64>): Uint<32>   — auctioneer only
placeBid(auctionId: Uint<32>): []                                                    — any bidder, BIDDING phase
closeAuction(auctionId: Uint<32>): []                                                — auctioneer only
revealBid(auctionId: Uint<32>, amount: Uint<32>, salt: Bytes<32>): []                — any bidder, CLOSED phase
claimItem(auctionId: Uint<32>): []                                                   — highest bidder only
finalizeAuction(auctionId: Uint<32>): []                                             — auctioneer only, no valid bids
```

**Ledger state** is a set of `Map<Uint<32>, ...>` keyed by `auctionId` — `phase`, `itemName`, `description`, `startingPrice`, `endTime`, `revealDeadline`, `auctioneerPK`, `sealedBids`, `bidCount`, `highestBidderPK`, `highestBid`, `itemClaimed` — plus a single global `nextAuctionId: Counter`. Every auction's state is independent, so one contract deployment hosts many concurrent auctions.

**Auction phase transitions**

```
VACANT ──createAuction()──► BIDDING ──closeAuction()──► CLOSED
                                                            │
                                          highestBid > 0 ───┼── claimItem() (highest bidder)
                                          highestBid == 0 ──┴── finalizeAuction() (auctioneer reclaims item)
```

---

## Quick Start

### Backend / contract scripts

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

Deploy-specific variables (`MIDNIGHT_DEPLOY_NODE`, funding requirements) are covered in [DEPLOYMENT.md](DEPLOYMENT.md).

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

### Frontend

```bash
cd frontend
npm install
npm run dev       # local dev server (Vite)
npm run build     # production build, output in frontend/dist
```

The frontend is a React 19 + Vite single-page app that connects to a browser wallet extension (e.g. 1AM, Lace) via `@midnight-ntwrk/dapp-connector-api` and talks to the deployed contract using the same `@midnight-ntwrk/midnight-js` stack as the backend scripts. It's deployed to Vercel — see `vercel.json` for the build configuration.

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
| **Commitment hash preimage** | **✗ No** | Without `(sk, auctionId, amount, salt)` the on-chain hash reveals nothing |

Compare with an equivalent EVM contract: `placeBid(uint256 amount, bytes32 salt)` would expose both the sender address and the bid amount in calldata, permanently and publicly. On Midnight, the function name is visible but the meaningful data (who and how much) is not.

**Commitment properties**

- **Commitment binding:** each commitment is tied to `localSecretKey` and `auctionId` — a bidder cannot replay another bidder's commitment, or replay their own commitment across auctions
- **Commitment hiding:** without all four of `sk`, `auctionId`, `amount`, and `salt`, the on-chain hash reveals nothing
- **Auctioneer auth:** `closeAuction()` and `finalizeAuction()` assert `auctioneerPK == bidderPublicKey(localSecretKey())` inside the ZK circuit — no external role system needed
- **Claim guard:** `claimItem()` asserts the caller's derived public key equals `highestBidderPK` and `highestBid > 0` and `!itemClaimed`
- **No private key on-chain:** all secret material stays in Compact `witness` — never serialised into any transaction
- **Single-bid / nullifier enforcement:** `placeBid()` asserts the caller has not previously submitted a sealed bid for this auction — each bidder may place exactly one bid per auction, enforced on-circuit, not by an off-chain check

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

Deployment-specific limitations (public RPC transaction size limits, wallet WASM memory behavior, SDK signing workarounds) are documented in [DEPLOYMENT.md § Known Limitations](DEPLOYMENT.md#known-limitations).

---

## Stack

| Layer | Technology |
|---|---|
| Smart contract | Compact (pragma ≥0.20; compiled with compiler 0.31.0 / language 0.23.0) |
| ZK backend | Midnight Proof Server (local), WASM-executed `.zkir` circuits |
| Runtime SDK | `@midnight-ntwrk/midnight-js` ^4.0.4 |
| Wallet (backend scripts) | `@midnight-ntwrk/wallet-sdk-facade` ^3.0.0 (Shielded + Dust + Unshielded) |
| Private state storage | LevelDB via `midnight-js-level-private-state-provider` |
| Backend language | TypeScript (ESM, Node.js ≥ 22) |
| Frontend | React 19, Vite, Tailwind CSS 4, `@midnight-ntwrk/dapp-connector-api` |
| Frontend hosting | Vercel |

---

## Roadmap

Full contract IDs, dates, and verified transaction/block records for every generation below are in [DEPLOYMENT.md](DEPLOYMENT.md).

**✅ M3 — Item descriptions, reserve price, timed auctions — Current**
- Added `description`, `startingPrice`, `endTime`, `revealDeadline` ledger fields, keyed per auction
- Added `finalizeAuction` circuit — auctioneer reclaims the item if no valid bids were revealed by the reveal deadline
- `revealBid` now enforces that revealed bids meet the auction's starting price

**✅ M2 — Multi-auction contract redesign — Deprecated**
- Redesigned from single-auction to multi-auction architecture
- Each auction identified by an auto-incremented `auctionId` (no ID collision)
- Single-bid enforcement per bidder per auction (on-circuit assertion)

**✅ M1 — Sealed-bid demo, fully verified on mainnet — Deprecated**
- Compact contract with ZK commit-reveal privacy model
- Full 7-step e2e verified on Midnight mainnet: deploy → bid (×2) → close → reveal (×2) → claim
- 3-phase wallet sync with checkpoint persistence, WASM memory guard, `MIDNIGHT_DEPLOY_NODE` routing

---

## Developer

GitHub: [pplmaverick](https://github.com/pplmaverick)

---

## License

MIT

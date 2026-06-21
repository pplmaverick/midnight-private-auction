# Midnight Private Auction

Sealed-bid auction smart contract on [Midnight Network](https://midnight.network), built with [Compact](https://docs.midnight.network/develop/reference/compact/) and the Midnight JS SDK.

Bid amounts are kept **completely private** during the bidding phase using zero-knowledge proofs and commit-reveal. Chain observers see only a 32-byte commitment hash — the actual amount is never on-chain until the bidder voluntarily reveals it.

---

## Why Midnight vs. EVM

| | EVM (Ethereum, etc.) | Midnight |
|---|---|---|
| Bid amount during bidding | Public in calldata | Never on-chain (ZK proof only) |
| Who can see bids | Everyone | No one until reveal |
| Privacy primitive | None | Compact private state + ZK circuit |
| Bid linkability | Trivially traceable | Unlinkable (domain-separated hash) |

---

## Privacy Model

The contract uses a **commit-reveal** scheme:

### Bidding Phase
The bidder's local private state holds three secrets:
- `localSecretKey` — 32-byte identity key, never leaves the prover
- `myBidAmount` — the actual bid (e.g. 200 Night)
- `myBidSalt` — 32-byte random nonce, prevents two equal bids from producing the same hash

When `placeBid()` is called, the circuit computes:

```
commitment = persistentHash("auction:seal:", secretKey, amount, salt)
```

Only `commitment` is stored on-chain. Chain observers see: `bidderPublicKey → commitment`. They cannot reverse the hash to learn `amount`.

### Reveal Phase
After the auctioneer calls `closeAuction()`, each bidder calls `revealBid(amount, salt)`. The circuit:
1. Recomputes `commitment = H(sk, amount, salt)`
2. Asserts it matches the stored on-chain hash
3. Calls `disclose(amount)` to make the amount public and compares against the current leader

The Compact compiler enforces that `disclose()` cannot appear inside a conditional branch — this prevents the circuit from leaking the branch outcome to observers. Since `revealBid` is the intended reveal step, disclosing `amount` unconditionally is correct by design.

---

## Contract Architecture

**File:** `contract/src/auction.compact`

### Ledger State (public, on-chain)

| Field | Type | Description |
|---|---|---|
| `phase` | `AuctionPhase` | `VACANT → BIDDING → CLOSED` |
| `itemName` | `Opaque<"string">` | Item being auctioned |
| `auctioneerPK` | `Bytes<32>` | Auctioneer's derived public key |
| `sealedBids` | `Map<Bytes<32>, Bytes<32>>` | bidderPK → commitment hash |
| `bidCount` | `Counter` | Number of sealed bids placed |
| `highestBid` | `Uint<32>` | Revealed after close |
| `highestBidderPK` | `Bytes<32>` | Winner's public key |
| `itemClaimed` | `Boolean` | True once winner claims |

### Private State (witnesses — local only, never on-chain)

| Witness | Type | Description |
|---|---|---|
| `localSecretKey()` | `Bytes<32>` | Identity key |
| `myBidAmount()` | `Uint<32>` | Bid amount (sealed during bidding) |
| `myBidSalt()` | `Bytes<32>` | Random salt for commitment |

### Circuits

| Circuit | Who calls | What it does |
|---|---|---|
| `createAuction(item)` | Auctioneer | Sets item name, transitions `VACANT → BIDDING` |
| `placeBid()` | Bidder | Submits sealed commitment, increments `bidCount` |
| `closeAuction()` | Auctioneer | Transitions `BIDDING → CLOSED` |
| `revealBid(amount, salt)` | Bidder | Verifies commitment, updates leaderboard if new highest |
| `claimItem()` | Winner | Marks item as claimed |

---

## Auction Flow (End-to-End Demo)

```
Step 1  Deploy + createAuction("Vintage Watch")   [auctioneer]
        → phase: BIDDING, auctioneerPK set

Step 2  placeBid()                                 [bidder1, amount=100, hidden]
        → sealedBids[bidder1PK] = H(sk1, 100, salt1)

Step 3  placeBid()                                 [bidder2, amount=200, hidden]
        → sealedBids[bidder2PK] = H(sk2, 200, salt2)

Step 4  closeAuction()                             [auctioneer]
        → phase: CLOSED

Step 5  revealBid(100, salt1)                      [bidder1]
        → highestBid=100, highestBidder=bidder1

Step 6  revealBid(200, salt2)                      [bidder2]
        → highestBid=200, highestBidder=bidder2

Step 7  claimItem()                                [bidder2]
        → itemClaimed=true
```

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 22 | |
| Compact compiler | latest | `compact` must be in `PATH` |
| Midnight Proof Server | latest | Running locally on port 6300 |
| Night tokens | — | Preprod: use the [faucet](https://faucet.preprod.midnight.network); Mainnet: real tokens |

---

## Setup

```bash
git clone <repo-url>
cd midnight-private-auction
npm install
```

The compiled contract artifacts (`contract/src/managed/auction/`) are committed to the repo. To recompile from source:

```bash
npm run compile
```

---

## Running on Preprod

```bash
# First run — generates a fresh wallet and prints its seed
npm run preprod

# Save the seed, fund the address from the faucet, then re-run with the seed
WALLET_SEED=<hex-seed> npm run preprod
```

### Wallet Sync Phases

The script handles wallet sync in three phases automatically:

| Phase | What happens | Time | RAM |
|---|---|---|---|
| **Phase 1** | DustWallet genesis sync; ShieldedWallet deliberately idle | 10–20 min | ~8 GB |
| **Phase 2** | ShieldedWallet genesis sync; DustWallet restores from checkpoint | 10–20 min | ~7 GB |
| **Phase 3** | Both wallets restore from saved checkpoints | < 30 sec | < 1 GB |

Checkpoints are saved to `.wallet-state/` (git-ignored). After Phase 2 completes, subsequent runs use Phase 3 (fast restore).

**Memory note:** A 9 GB RSS guard is in place. If the process exceeds this limit (due to RPC disconnects stalling DustWallet sync), it exits cleanly with instructions to retry.

---

## Running on Mainnet

Set the required environment variables, then run:

```bash
export MIDNIGHT_INDEXER=<indexer-http-url>
export MIDNIGHT_INDEXER_WS=<indexer-ws-url>
export MIDNIGHT_NODE=<node-rpc-url>
export WALLET_SEED=<hex-seed>

npm run mainnet
```

Or override the proof server if not on the default port:

```bash
export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
```

---

## Repository Structure

```
midnight-private-auction/
├── contract/
│   └── src/
│       ├── auction.compact          # Compact contract source
│       ├── witnesses.ts             # Private state type + witness bridge
│       ├── index.ts                 # Contract exports
│       └── managed/auction/
│           ├── contract/            # Compiled JS contract
│           ├── keys/                # ZK prover/verifier keys
│           └── zkir/                # ZK intermediate representation
├── src/
│   ├── index.ts                     # End-to-end demo script
│   ├── api.ts                       # Wallet setup + contract call wrappers
│   ├── config.ts                    # PreprodConfig / MainnetConfig
│   └── common-types.ts              # Shared types
├── package.json
└── tsconfig.json
```

---

## License

MIT

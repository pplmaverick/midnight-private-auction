# Independent Reference Model Testing — auction.compact (8-item fix)

Verifies the contract changes to `contract/src/auction.compact`, in two rounds:

**Round 1 (6 items):**
1. `auctioneerPublicKey` domain-separated from `bidderPublicKey`
2. `createAuction`: `assert(revealDeadline > endTime)`
3. `placeBid`: `assert(blockTimeLt(endTime))`
4. `closeAuction(auctionId, newRevealDeadline)`: `assert(blockTimeLt(newRevealDeadline))`, writes `revealDeadline`
5. `revealBid`: `assert(blockTimeLt(revealDeadline))`
6. `claimItem`: `assert(blockTimeGte(revealDeadline))`

**Round 2 (2 additional items):**
7. `bidderPublicKey(sk, auctionId)`: auctionId folded into the hash so a bidder's identity is no
   longer correlatable across auctions (`auctioneerPublicKey` deliberately left unchanged — stable
   auctioneer identity across auctions is an intentional lightweight reputation mechanism, since
   `createAuction` is open to anyone)
8. `finalizeAuction`: `assert(blockTimeGte(revealDeadline.lookup(id)))`, added after the
   phase==CLOSED check and before the auctioneer check / itemClaimed write

## Result: ALL MATCH — 0 mismatches across 6,060 comparisons

| Category | Comparisons | Status |
|---|---|---|
| Domain separation (`auctioneerPublicKey(sk)` != `bidderPublicKey(sk, auctionId)`) | 1,000 | MATCH |
| Determinism (`computeCommitment` stable across repeat calls) | 500 | MATCH |
| Input sensitivity (4 variants x 500 base cases) | 2,000 | MATCH |
| `computeCommitment` auctionId isolation (300 groups, each checked for a collision among its 5 ids) | 300 | MATCH |
| `bidderPublicKey` auctionId isolation (300 groups, same sk, checked for a collision among its 5 ids) | 300 | MATCH |
| `createAuction` boundary (`revealDeadline > endTime`) | 700 | MATCH |
| `placeBid` boundary (`now < endTime`) | 700 | MATCH |
| `closeAuction` boundary (`now < newRevealDeadline`) | 210 | MATCH |
| `revealBid` boundary (`now < revealDeadline`) | 105 | MATCH |
| `claimItem` boundary (`now >= revealDeadline`) | 105 | MATCH |
| `finalizeAuction` boundary (`now >= revealDeadline`) | 140 | MATCH |
| **Total** | **6,060** | **ALL MATCH** |

Raw reports: `verification/reports/relations_report.json`, `verification/reports/time_boundaries_report.json`.
Trace integrity: `verification/commitments.sha256` (SHA-256 of every file under `data/` and `reports/`).

## Why two different verification strategies

`persistentHash` (backing `bidderPublicKey`, `auctioneerPublicKey`, `computeCommitment`) is a
compiled WASM primitive inside `@midnight-ntwrk/onchain-runtime-v3` with no publicly readable
bit-level spec in this environment. A from-scratch Python reimplementation could not be verified
byte-for-byte against it — any comparison would either silently reuse the real hash (making
"independent" meaningless) or compare against a guessed algorithm (making every case a
guaranteed, uninformative MISMATCH). This was surfaced and the scope was explicitly narrowed by
agreement before implementation: hash-based circuits are verified by **relational property**
(domain separation, determinism, input sensitivity, auctionId isolation for both
`computeCommitment` and, since round 2, `bidderPublicKey` itself) against real outputs from the
compiled contract, not by recomputing the hash.

The numeric/time-gated checks are plain integer comparisons with a fully public spec (the assert
conditions in `auction.compact` itself), so those ARE verified byte/boolean-exact:
`reference_model.py`'s predictions are compared row-by-row against what the real compiled
contract actually did at and around each boundary.

## Coverage

**Covered:**
- Domain separation holds across 1,000 random secret keys (not just one hand-picked case).
- `computeCommitment` determinism across 500 random `(sk, auctionId, amount, salt)` tuples.
- Input sensitivity: for 500 base tuples, independently varying `sk`, `auctionId`, `amount`, or
  `salt` (one field at a time) always changes the output — no field is silently ignored, no
  observed collision.
- `computeCommitment` auctionId isolation: 300 groups of 5 distinct auctionIds each, same
  `(sk, amount, salt)` — `auctionId` is confirmed to actually participate in the hash (not a
  decorative parameter).
- `bidderPublicKey` auctionId isolation (round 2): 300 groups of 5 distinct auctionIds each, same
  `sk` — confirms the round-2 fix actually removes cross-auction bidder identity correlation, not
  just that the function compiles with an extra parameter.
- All 6 numeric/time boundaries (`createAuction`, `placeBid`, `closeAuction`, `revealBid`,
  `claimItem`, `finalizeAuction`) tested at exact equality (delta=0), one-below, one-above, and far
  below/above, across 15-100 randomized base timestamps per check (not a single hardcoded example).
- Empirically confirmed exact strict-vs-inclusive semantics at delta=0: `createAuction`,
  `placeBid`, `closeAuction`, `revealBid` all reject at exact equality (strict `<`/`>`); `claimItem`
  and `finalizeAuction` both accept at exact equality (inclusive `>=`) — see the `by_delta`
  breakdown in `reports/time_boundaries_report.json`.
- All 8 contract changes compile cleanly (`npm run compile`, exit 0) and the existing 12-test suite
  plus all consumer call sites (frontend, `src/api.ts`, scripts, simulator) were updated and
  typecheck/pass (`tsc --noEmit` x2, `npm run test` 12/12).

**Not covered (explicitly out of scope, not silently skipped):**
- Byte-exact verification of `persistentHash`'s output — see rationale above. If an official
  bit-level spec becomes available, `reference_model.py` should be extended to reimplement it and
  this gap closed.
- Concurrency / interleaving properties (e.g. two bidders revealing in the same block, race
  conditions between `closeAuction` and a pending `placeBid`) — this testing is single-threaded,
  sequential circuit invocation; it does not model transaction ordering or mempool races.
- Gas/proof-cost characteristics of the new asserts — out of scope for a correctness verification.
- `finalizeAuction`'s own itemClaimed-write logic (the `highestBid==0` branch) was already covered
  structurally by the original 12-test suite and was not re-verified here; only its new
  reveal-deadline gate (round 2 item 8) is covered by this Independent Reference Model Testing pass.
- The WASM double-instantiation crash under `ts-node/esm` (encountered generating this data) was
  routed around by running via vitest instead, per agreement; its root cause in this project's
  dependency tree was not investigated further.

## How to reproduce

```bash
npm run compile                                                    # confirms all 8 contract changes still compile
npx vitest run verification/generate-relations.test.ts             # real-contract hash-relation data -> data/relations.json
npx vitest run verification/generate-time-boundaries.test.ts       # real-contract time-boundary data -> data/time_*.json
python3 verification/verify_relations.py                           # relational checks -> reports/relations_report.json
python3 verification/verify_time_boundaries.py                     # numeric/time checks -> reports/time_boundaries_report.json
./verification/archive_commitments.sh                              # refresh commitments.sha256
```

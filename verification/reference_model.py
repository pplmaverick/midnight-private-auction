"""
Independent Python reference model for the 6 auction.compact fixes.

Written directly from the specification (circuit signatures, assert conditions,
and assert messages in contract/src/auction.compact) -- not by reading or porting
persistentHash's implementation.

Scope split, per the agreed plan:

1. Pure numeric/time logic (createAuction's revealDeadline > endTime check, and
   the blockTimeLt/blockTimeGte gates in placeBid/closeAuction/revealBid/claimItem)
   is plain integer comparison. It is fully and independently reproducible here,
   so verify_time_boundaries.py compares this model's predictions byte-for-byte
   (well, boolean-for-boolean) against real compiled-contract outcomes.

2. bidderPublicKey / auctioneerPublicKey / computeCommitment are backed by
   persistentHash, a compiled WASM primitive (@midnight-ntwrk/onchain-runtime-v3)
   with no publicly readable bit-level spec available in this environment. This
   file does NOT attempt to reimplement that hash. Instead it states the
   RELATIONAL properties the spec requires of it, which verify_relations.py checks
   against real outputs captured from the compiled contract (see
   verification/generate-relations.test.ts). See REPORT.md for the full rationale.
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# 1. Pure numeric / time logic
# ---------------------------------------------------------------------------

def create_auction_valid(end_time: int, reveal_deadline: int) -> bool:
    """auction.compact:119 -- assert(disclose(auctionRevealDeadline) > disclose(auctionEndTime))."""
    return reveal_deadline > end_time


def can_place_bid(now: int, end_time: int) -> bool:
    """auction.compact:148 -- assert(blockTimeLt(endTime.lookup(id)))."""
    return now < end_time


def can_close(now: int, new_reveal_deadline: int) -> bool:
    """auction.compact:172 -- assert(blockTimeLt(disclose(newRevealDeadline)))."""
    return now < new_reveal_deadline


def can_reveal(now: int, reveal_deadline: int) -> bool:
    """auction.compact:182 -- assert(blockTimeLt(revealDeadline.lookup(id)))."""
    return now < reveal_deadline


def can_claim(now: int, reveal_deadline: int) -> bool:
    """auction.compact:202 -- assert(blockTimeGte(revealDeadline.lookup(id)))."""
    return now >= reveal_deadline


def can_finalize(now: int, reveal_deadline: int) -> bool:
    """finalizeAuction -- assert(blockTimeGte(revealDeadline.lookup(id))), added after
    phase==CLOSED and before the auctioneer check / itemClaimed write. Same comparison
    as can_claim, kept as a separate function since it gates a different circuit."""
    return now >= reveal_deadline


# ---------------------------------------------------------------------------
# 2. Relational properties expected of the hash-based circuits
#    (no hash reimplementation -- these only state properties to check)
# ---------------------------------------------------------------------------

def check_domain_separation(pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """auctioneerPublicKey(sk) must differ from bidderPublicKey(sk) for the same sk."""
    return [row for row in pairs if row["auctioneerPK"] == row["bidderPK"]]


def check_determinism(pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """computeCommitment(sk, auctionId, amount, salt) must be stable across repeat calls."""
    return [row for row in pairs if row["result1"] != row["result2"]]


def check_sensitivity(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Changing exactly one input to computeCommitment must change the output."""
    failures = []
    for row in rows:
        base = row["base"]
        for variant_name in ("varySk", "varyAuctionId", "varyAmount", "varySalt"):
            if row[variant_name] == base:
                failures.append({"case": row, "variant": variant_name})
    return failures


def check_auctionid_isolation(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Same (sk, amount, salt) across several distinct auctionIds must not collide."""
    failures = []
    for row in groups:
        commitments = list(row["commitmentsByAuctionId"].values())
        if len(commitments) != len(set(commitments)):
            failures.append(row)
    return failures


def check_bidderpk_auctionid_isolation(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Same sk, across several distinct auctionIds, must produce distinct bidderPublicKey
    outputs -- confirms auctionId actually participates in bidderPublicKey's hash (the
    fix that removes cross-auction bidder identity correlation), not just computeCommitment."""
    failures = []
    for row in groups:
        pks = list(row["bidderPksByAuctionId"].values())
        if len(pks) != len(set(pks)):
            failures.append(row)
    return failures

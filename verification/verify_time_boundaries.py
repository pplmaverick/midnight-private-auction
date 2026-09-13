#!/usr/bin/env python3
"""
Row-by-row comparison of reference_model.py's pure-Python predictions against
the real compiled contract's actual outcomes (captured by
generate-time-boundaries.test.ts into verification/data/time_*.json).

Covers all 6 numeric/time-gated checks:
  - createAuction:    revealDeadline > endTime
  - placeBid:         now < endTime
  - closeAuction:     now < newRevealDeadline
  - revealBid:        now < revealDeadline
  - claimItem:        now >= revealDeadline
  - finalizeAuction:  now >= revealDeadline

Usage: python3 verification/verify_time_boundaries.py
Writes: verification/reports/time_boundaries_report.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import reference_model as ref

VERIFICATION_DIR = Path(__file__).parent
DATA_DIR = VERIFICATION_DIR / "data"
REPORT_PATH = VERIFICATION_DIR / "reports" / "time_boundaries_report.json"

CHECKS = {
    "createAuction": {
        "file": "time_createAuction.json",
        "predict": lambda row: ref.create_auction_valid(int(row["endTime"]), int(row["revealDeadline"])),
    },
    "placeBid": {
        "file": "time_placeBid.json",
        "predict": lambda row: ref.can_place_bid(int(row["now"]), int(row["endTime"])),
    },
    "closeAuction": {
        "file": "time_closeAuction.json",
        "predict": lambda row: ref.can_close(int(row["now"]), int(row["newRevealDeadline"])),
    },
    "revealBid": {
        "file": "time_revealBid.json",
        "predict": lambda row: ref.can_reveal(int(row["now"]), int(row["revealDeadline"])),
    },
    "claimItem": {
        "file": "time_claimItem.json",
        "predict": lambda row: ref.can_claim(int(row["now"]), int(row["revealDeadline"])),
    },
    "finalizeAuction": {
        "file": "time_finalizeAuction.json",
        "predict": lambda row: ref.can_finalize(int(row["now"]), int(row["revealDeadline"])),
    },
}


def main() -> int:
    report = {"sections": []}
    total_cases = 0
    total_mismatches = 0
    all_match = True

    for name, spec in CHECKS.items():
        path = DATA_DIR / spec["file"]
        rows = json.loads(path.read_text())
        mismatches = []
        for row in rows:
            expected_pass = spec["predict"](row)
            actual_pass = row["actualPass"]
            if expected_pass != actual_pass:
                mismatches.append(
                    {
                        "row": row,
                        "expectedPass": expected_pass,
                        "actualPass": actual_pass,
                    }
                )

        total_cases += len(rows)
        total_mismatches += len(mismatches)
        status = "MATCH" if not mismatches else "MISMATCH"
        if mismatches:
            all_match = False

        # Boundary-delta breakdown (delta=0 is the exact-equality edge case).
        by_delta: dict[str, dict[str, int]] = {}
        for row in rows:
            d = row["delta"]
            by_delta.setdefault(d, {"cases": 0, "actualPass": 0})
            by_delta[d]["cases"] += 1
            if row["actualPass"]:
                by_delta[d]["actualPass"] += 1

        report["sections"].append(
            {
                "name": name,
                "cases": len(rows),
                "status": status,
                "mismatch_count": len(mismatches),
                "by_delta": by_delta,
                "mismatches": mismatches[:20],
            }
        )
        print(f"[{status}] {name}: {len(rows)} cases, {len(mismatches)} mismatches")

    report["overall_status"] = "ALL MATCH" if all_match else "MISMATCHES FOUND"
    report["total_cases"] = total_cases
    report["total_mismatches"] = total_mismatches

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2))

    print(f"\nOverall: {report['overall_status']} ({total_cases} cases, {total_mismatches} mismatches)")
    print(f"Report written to {REPORT_PATH}")

    return 0 if all_match else 1


if __name__ == "__main__":
    raise SystemExit(main())

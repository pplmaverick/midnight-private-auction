#!/usr/bin/env python3
"""
Verifies the relational properties of the real compiled contract's hash-based
circuits (bidderPublicKey / auctioneerPublicKey / computeCommitment) against
the data captured in verification/data/relations.json (produced by
generate-relations.test.ts, which calls the actual compiled contract -- no
hash is reimplemented here; see reference_model.py's module docstring).

Usage: python3 verification/verify_relations.py
Writes: verification/reports/relations_report.json
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import reference_model as ref

VERIFICATION_DIR = Path(__file__).parent
DATA_PATH = VERIFICATION_DIR / "data" / "relations.json"
REPORT_PATH = VERIFICATION_DIR / "reports" / "relations_report.json"


def main() -> int:
    data = json.loads(DATA_PATH.read_text())

    domain_failures = ref.check_domain_separation(data["domainSeparation"])
    determinism_failures = ref.check_determinism(data["determinism"])
    sensitivity_failures = ref.check_sensitivity(data["sensitivity"])
    isolation_failures = ref.check_auctionid_isolation(data["isolation"])
    bidderpk_isolation_failures = ref.check_bidderpk_auctionid_isolation(data["bidderPkIsolation"])

    sensitivity_comparisons = len(data["sensitivity"]) * 4  # 4 variants checked per case

    sections = [
        {
            "name": "domain_separation",
            "description": "auctioneerPublicKey(sk) != bidderPublicKey(sk) for the same sk",
            "cases": len(data["domainSeparation"]),
            "failures": domain_failures,
        },
        {
            "name": "determinism",
            "description": "computeCommitment(sk, auctionId, amount, salt) is stable across repeat calls",
            "cases": len(data["determinism"]),
            "failures": determinism_failures,
        },
        {
            "name": "input_sensitivity",
            "description": "changing exactly one input to computeCommitment changes the output",
            "cases": len(data["sensitivity"]),
            "comparisons": sensitivity_comparisons,
            "failures": sensitivity_failures,
        },
        {
            "name": "auctionid_isolation",
            "description": "same (sk, amount, salt) across distinct auctionIds never collides",
            "cases": len(data["isolation"]),
            "failures": isolation_failures,
        },
        {
            "name": "bidderpk_auctionid_isolation",
            "description": "bidderPublicKey(sk, auctionId): same sk across distinct auctionIds never collides",
            "cases": len(data["bidderPkIsolation"]),
            "failures": bidderpk_isolation_failures,
        },
    ]

    report = {"sections": []}
    total_cases = 0
    total_failures = 0
    all_match = True

    for section in sections:
        n_failures = len(section["failures"])
        total_cases += section.get("comparisons", section["cases"])
        total_failures += n_failures
        status = "MATCH" if n_failures == 0 else "MISMATCH"
        if n_failures > 0:
            all_match = False
        report["sections"].append(
            {
                "name": section["name"],
                "description": section["description"],
                "cases": section["cases"],
                "comparisons": section.get("comparisons", section["cases"]),
                "status": status,
                "failure_count": n_failures,
                "failures": section["failures"][:20],  # cap sample size in the report
            }
        )
        print(f"[{status}] {section['name']}: {section['cases']} cases, {n_failures} failures")

    report["overall_status"] = "ALL MATCH" if all_match else "MISMATCHES FOUND"
    report["total_comparisons"] = total_cases
    report["total_failures"] = total_failures

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2))

    print(f"\nOverall: {report['overall_status']} ({total_cases} comparisons, {total_failures} failures)")
    print(f"Report written to {REPORT_PATH}")

    return 0 if all_match else 1


if __name__ == "__main__":
    raise SystemExit(main())

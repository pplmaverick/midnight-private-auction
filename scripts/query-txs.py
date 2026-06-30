#!/usr/bin/env python3
"""
Scan for new contract interactions and update tx-log.json.

Usage:
  python3 scripts/query-txs.py          # scan for new txs since lastScannedBlock
  python3 scripts/query-txs.py --list   # just print the current log, no scan
"""

import sys
import json
import urllib.request
from pathlib import Path

LOG_PATH = Path(__file__).parent.parent / "tx-log.json"

def gql(indexer: str, query: str) -> dict:
    req = urllib.request.Request(
        indexer,
        data=json.dumps({"query": query}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

def latest_block(indexer: str) -> int:
    r = gql(indexer, "{ block { height } }")
    return r["data"]["block"]["height"]

def scan_block(indexer: str, height: int, contract: str) -> list[dict]:
    r = gql(indexer, f"""
    {{
      block(offset: {{ height: {height} }}) {{
        transactions {{ hash contractActions {{ address }} }}
      }}
    }}""")
    b = r["data"]["block"]
    if not b:
        return []
    found = []
    for tx in (b.get("transactions") or []):
        for ca in (tx.get("contractActions") or []):
            if ca["address"] == contract:
                found.append(tx["hash"])
    return found

def print_log(log: dict) -> None:
    txs = log["transactions"]
    print(f"\nContract : {log['contract']}")
    print(f"Network  : {log['network']}")
    print(f"Total    : {len(txs)} transactions\n")
    print(f"{'#':<4} {'Block':<12} {'Operation':<30} {'Hash'}")
    print("-" * 100)
    for tx in txs:
        print(f"  {tx['seq']:<2}  {tx['block']:<12} {tx['operation']:<30} {tx['hash']}")
        print(f"        {'':12} {'':30} {tx['explorerUrl']}")
    print()

def main() -> None:
    if not LOG_PATH.exists():
        print(f"Error: {LOG_PATH} not found.")
        sys.exit(1)

    log = json.loads(LOG_PATH.read_text())
    contract = log["contract"]
    indexer = log["indexer"]

    if "--list" in sys.argv:
        print_log(log)
        return

    from_block = log["lastScannedBlock"] + 1
    to_block = latest_block(indexer)

    print(f"Scanning blocks {from_block}–{to_block} for new interactions…")

    new_count = 0
    for h in range(from_block, to_block + 1):
        hashes = scan_block(indexer, h, contract)
        for hash_ in hashes:
            new_count += 1
            seq = len(log["transactions"]) + 1
            entry = {
                "seq": seq,
                "block": h,
                "operation": f"(unknown — add label manually)",
                "hash": hash_,
                "explorerUrl": f"https://explorer.1am.xyz/tx/{hash_}",
            }
            log["transactions"].append(entry)
            print(f"  NEW  block {h}  hash={hash_[:16]}…")

    log["lastScannedBlock"] = to_block
    LOG_PATH.write_text(json.dumps(log, indent=2))

    if new_count == 0:
        print(f"  No new interactions found (scanned {to_block - from_block + 1} blocks).")
    else:
        print(f"\n  {new_count} new tx(s) added to tx-log.json.")

    print()
    print_log(log)

if __name__ == "__main__":
    main()

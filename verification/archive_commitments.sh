#!/bin/bash
# Archives every generated trace (raw contract-call data + verification reports)
# under a single SHA-256 manifest, so the inputs and outputs of this verification
# run are tamper-evident. Re-run any time after regenerating data/ or reports/.
set -euo pipefail
cd "$(dirname "$0")"

OUT=commitments.sha256
: > "$OUT"

find data reports -type f \( -name '*.json' \) | sort | while read -r f; do
  shasum -a 256 "$f" >> "$OUT"
done

echo "Wrote $(wc -l < "$OUT" | tr -d ' ') file hashes to verification/$OUT"

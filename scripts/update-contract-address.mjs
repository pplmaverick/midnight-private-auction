#!/usr/bin/env node
// Usage: node scripts/update-contract-address.mjs <NEW_ADDRESS> [--tx <hash>] [--block <height>] [--apply]
// Replaces the legacy address with the new one. DRY RUN unless --apply is given.
//  - code files: every occurrence is replaced
//  - README.md: only the "> Current Contract:" line; the "Legacy Contract" section is left untouched
//  - DEPLOYMENT.md: only the "| Active contract |" row, plus the blank M6 "Contract Address" row
//    (and Tx/Block rows when --tx/--block are given); the "Supersedes" row and the M5 block keep
//    the old address.
// Afterwards run: node scripts/check-contract-address.mjs <NEW_ADDRESS>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { OLD_ADDRESS, CODE_FILES, DOC_FILES, isAddress } from './contract-address-files.mjs';

const args = process.argv.slice(2);
const NEW = (args[0] ?? '').trim();
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes('--apply');
const TX = flag('--tx');
const BLOCK = flag('--block');
if (!isAddress(NEW) || NEW === OLD_ADDRESS) {
  console.error('Usage: node scripts/update-contract-address.mjs <new 64-hex address> [--tx <hash>] [--block <height>] [--apply]');
  process.exit(2);
}
const EXPLORER = 'https://explorer.1am.xyz/contract/';
const swap = (s) => s.split(OLD_ADDRESS).join(NEW);
let total = 0;
const plan = [];

for (const file of CODE_FILES) {
  if (!existsSync(file)) { console.error(`missing: ${file}`); process.exit(1); }
  const text = readFileSync(file, 'utf8');
  const n = text.split(OLD_ADDRESS).length - 1;
  total += n;
  plan.push({ file, n, next: swap(text) });
}

for (const d of DOC_FILES) {
  if (!existsSync(d.file)) { console.error(`missing: ${d.file}`); process.exit(1); }
  const lines = readFileSync(d.file, 'utf8').split('\n');
  let n = 0;
  const out = lines.map((l) => {
    if (d.current.test(l) && l.includes(OLD_ADDRESS)) { n += l.split(OLD_ADDRESS).length - 1; return swap(l); }
    if (d.m6Row && d.m6Row.test(l)) { n += 1; return `| Contract Address | [\`${NEW}\`](${EXPLORER}${NEW}) |`; }
    if (d.m6Row && TX && /^\| Deploy Tx Hash \| _\(blank/.test(l)) { n += 1; return `| Deploy Tx Hash | \`${TX}\` |`; }
    if (d.m6Row && BLOCK && /^\| Block Height \| _\(blank/.test(l)) { n += 1; return `| Block Height | ${BLOCK} |`; }
    return l;
  });
  total += n;
  plan.push({ file: d.file, n, next: out.join('\n') });
}

for (const p of plan) console.log(`${APPLY ? 'update' : 'would update'}  ${p.file}  (${p.n} change(s))`);
console.log(`total: ${total} change(s) across ${plan.length} files`);
if (plan.some((p) => p.n === 0)) { console.error('A file has 0 changes — refusing (unexpected layout or already updated).'); process.exit(1); }
if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }
for (const p of plan) writeFileSync(p.file, p.next);
console.log('\nWritten. Not done by this script: DEPLOYMENT.md M6 "Status" / "Generation" / M5 "(Current)" wording, README badges.');
console.log(`Next: node scripts/check-contract-address.mjs ${NEW}`);

#!/usr/bin/env node
// Usage: node scripts/check-contract-address.mjs <NEW_ADDRESS>
// Compares, character by character, the contract address at every hard-coded location against the
// new address. Exit 0 only if every location is consistent; exit 1 otherwise. Read-only.
import { readFileSync, existsSync } from 'node:fs';
import { OLD_ADDRESS, CODE_FILES, DOC_FILES, ADDRESS_RE, isAddress } from './contract-address-files.mjs';

const NEW = (process.argv[2] ?? '').trim();
if (!isAddress(NEW)) {
  console.error('Usage: node scripts/check-contract-address.mjs <64-hex lowercase address>');
  process.exit(2);
}
if (NEW === OLD_ADDRESS) {
  console.error('The "new" address equals the legacy address — refusing.');
  process.exit(2);
}

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

// First differing index between two strings, for a precise report on near-misses.
const diffAt = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };

const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n') : null);

console.log(`new address : ${NEW.slice(0, 8)}…${NEW.slice(-8)} (${NEW.length} chars)`);
console.log('\nCode files (every address token must equal the new address; the old one must be gone):');
for (const file of CODE_FILES) {
  const lines = readLines(file);
  if (!lines) { fail(`${file}: file missing`); continue; }
  const tokens = [];
  lines.forEach((l, i) => { for (const m of l.matchAll(ADDRESS_RE)) tokens.push({ line: i + 1, tok: m[0] }); });
  const hits = tokens.filter((t) => t.tok === NEW);
  const old = tokens.filter((t) => t.tok === OLD_ADDRESS);
  const other = tokens.filter((t) => t.tok !== NEW && t.tok !== OLD_ADDRESS);
  if (old.length) fail(`${file}:${old.map((t) => t.line).join(',')} still has the OLD address`);
  for (const t of other) fail(`${file}:${t.line} has a 64-hex token that is neither new nor old (first diff vs new at index ${diffAt(t.tok, NEW)})`);
  if (!hits.length) fail(`${file}: new address not found`);
  if (hits.length && !old.length && !other.length) ok(`${file}:${hits.map((t) => t.line).join(',')}`);
}

console.log('\nDocs (current-address line updated; legacy/history occurrences preserved):');
for (const d of DOC_FILES) {
  const lines = readLines(d.file);
  if (!lines) { fail(`${d.file}: file missing`); continue; }
  const cur = lines.map((l, i) => ({ l, i: i + 1 })).filter((x) => d.current.test(x.l));
  if (cur.length !== 1) { fail(`${d.file}: expected exactly 1 current-address line, found ${cur.length}`); }
  else {
    const toks = [...cur[0].l.matchAll(ADDRESS_RE)].map((m) => m[0]);
    if (toks.length && toks.every((t) => t === NEW)) ok(`${d.file}:${cur[0].i} current line = new (${toks.length} occurrence(s))`);
    else fail(`${d.file}:${cur[0].i} current line is not the new address (first diff index ${toks[0] ? diffAt(toks[0], NEW) : 'n/a'})`);
  }
  const text = lines.join('\n');
  const oldCount = (text.match(new RegExp(OLD_ADDRESS, 'g')) ?? []).length;
  const oldOnCurrent = cur.length ? (cur[0].l.match(new RegExp(OLD_ADDRESS, 'g')) ?? []).length : 0;
  if (oldCount - oldOnCurrent >= d.preservedOldMin) ok(`${d.file}: legacy address preserved (${oldCount - oldOnCurrent} occurrence(s), need >= ${d.preservedOldMin})`);
  else fail(`${d.file}: legacy address missing from history/legacy section (found ${oldCount - oldOnCurrent}, need >= ${d.preservedOldMin})`);
  if (d.m6Row) {
    const row = lines.find((l) => /^\| Contract Address \|/.test(l) && l.includes(NEW));
    if (row) ok(`${d.file}: M6 block "Contract Address" row has the new address`);
    else fail(`${d.file}: M6 block "Contract Address" row does not contain the new address`);
  }
}

console.log('\nNot checked here (manual, required by CLAUDE.md):');
console.log('  - Vercel env (Production AND Preview): this project keeps NO address env var; confirm with `vercel env ls`.');
console.log('  - Deployed frontend actually serves the new address.');

console.log(failures ? `\nRESULT: FAIL (${failures} problem(s))` : '\nRESULT: PASS — all locations consistent');
process.exit(failures ? 1 : 0);

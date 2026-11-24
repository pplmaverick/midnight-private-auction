/**
 * Post-deploy check: read the deployed contract's state from the indexer and compare each circuit's
 * verifier key fingerprint (first 16 hex of SHA-256) with
 *   (a) the M6 column of the fingerprint table in DEPLOYMENT.md, and
 *   (b) the local compiled key file contract/src/managed/auction/keys/<circuit>.verifier.
 * Also flags a contract whose keys equal the M5 column (i.e. the wrong/old contract).
 *
 * Read-only: needs NO seed and sends nothing. The Blockfrost token is read from .env.local inside
 * src/config.ts and never printed.
 *
 * Usage:  CONTRACT_ADDRESS=<64hex> npm run verify:keys           (mainnet, default)
 *         CONTRACT_ADDRESS=<64hex> MIDNIGHT_NETWORK=preview npm run verify:keys
 *   (the address may also be passed as the first CLI argument)
 * Exit code 0 only if all six circuits match on all comparisons.
 *
 * Caveat (unverified until the first real run): this assumes the on-chain verifierKey bytes are
 * identical to the .verifier file bytes. If every circuit shows MISMATCH while DEPLOYMENT.md and the
 * local file agree with each other, suspect a byte-format difference before suspecting the contract.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import * as ledger from '@midnight-ntwrk/midnight-js-protocol/v9';
import { MainnetConfig, PreviewConfig } from '../src/config.js';

const CIRCUITS = ['createAuction', 'placeBid', 'closeAuction', 'revealBid', 'finalizeAuction', 'claimItem'] as const;
const fp = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const redact = (t: string): string =>
  t.replace(/project_id=[^&\s"')]+/gi, 'project_id=***').replace(/\b(https?|wss?):\/\/[^\s"']*/gi, (u) => u.split('?')[0]).slice(0, 300);

const address = (process.argv[2] ?? process.env.CONTRACT_ADDRESS ?? '').trim();
if (!/^[0-9a-f]{64}$/.test(address)) {
  console.error('Error: pass the contract address (64 lowercase hex) as argument or CONTRACT_ADDRESS.');
  process.exit(2);
}
const network = process.env.MIDNIGHT_NETWORK ?? 'mainnet';
if (network !== 'mainnet' && network !== 'preview') {
  console.error('Error: MIDNIGHT_NETWORK must be "mainnet" or "preview".');
  process.exit(2);
}

// ── expected fingerprints from DEPLOYMENT.md ─────────────────────────────────
const parseTable = (): { m6: Record<string, string>; m5: Record<string, string> } => {
  const text = readFileSync(path.resolve(process.cwd(), 'DEPLOYMENT.md'), 'utf8');
  const m6: Record<string, string> = {};
  const m5: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(\w+)\s*\|\s*`([0-9a-f]{16})`\s*\|\s*`([0-9a-f]{16})`\s*\|/);
    if (m && (CIRCUITS as readonly string[]).includes(m[1])) {
      m6[m[1]] = m[2];
      m5[m[1]] = m[3];
    }
  }
  return { m6, m5 };
};

async function main(): Promise<void> {
  const { m6, m5 } = parseTable();
  const missingDoc = CIRCUITS.filter((c) => !m6[c]);
  if (missingDoc.length) {
    console.error(`Error: DEPLOYMENT.md fingerprint table has no row for: ${missingDoc.join(', ')}`);
    process.exit(2);
  }

  const config = network === 'mainnet' ? new MainnetConfig() : new PreviewConfig();
  console.log(`network: ${network}`);
  console.log(`contract: ${address.slice(0, 8)}…${address.slice(-8)}`);

  const provider = indexerPublicDataProvider(config.indexer, config.indexerWS);
  let read;
  try {
    read = await provider.queryContractState(address as never);
  } catch (e) {
    console.error(`Error: indexer query failed: ${redact(e instanceof Error ? e.message : String(e))}`);
    process.exit(1);
  }
  if (!read) {
    console.error('Error: contract not found on this network (indexer returned nothing).');
    process.exit(1);
  }
  const state = read.contractState.deserialize({ v9: ledger.ContractState });

  const onChainNames = state.operations().map((o) => (typeof o === 'string' ? o : Buffer.from(o).toString('utf8')));
  console.log(`on_chain_circuits: ${onChainNames.sort().join(', ')}`);

  let bad = 0;
  let allEqualM5 = true;
  console.log('\ncircuit            on-chain          DEPLOYMENT.md M6   local file         result');
  for (const c of CIRCUITS) {
    const op = state.operation(c);
    const onChain = op ? fp(op.verifierKey) : 'MISSING';
    const localFile = path.resolve(process.cwd(), 'contract/src/managed/auction/keys', `${c}.verifier`);
    const local = existsSync(localFile) ? fp(readFileSync(localFile)) : 'NO-FILE';
    const okDoc = onChain === m6[c];
    const okLocal = onChain === local;
    if (onChain !== m5[c]) allEqualM5 = false;
    if (!okDoc || !okLocal) bad += 1;
    console.log(`${c.padEnd(18)} ${onChain.padEnd(17)} ${m6[c].padEnd(18)} ${local.padEnd(18)} ${okDoc && okLocal ? 'MATCH' : `MISMATCH${okDoc ? '' : ' (vs DEPLOYMENT.md)'}${okLocal ? '' : ' (vs local file)'}`}`);
  }
  const extra = onChainNames.filter((n) => !(CIRCUITS as readonly string[]).includes(n));
  if (extra.length) {
    bad += 1;
    console.log(`\nEXTRA on-chain circuits not in the expected set: ${extra.join(', ')}`);
  }
  if (allEqualM5) console.log('\nWARNING: on-chain keys equal the M5 column — this is the OLD contract, not the M6 deploy.');

  console.log(bad === 0 ? '\nRESULT: PASS — all 6 verifier keys match' : `\nRESULT: FAIL — ${bad} problem(s)`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`Error: ${redact(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
});

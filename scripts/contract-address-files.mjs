// Single source of truth for where the contract address lives in this repo.
// Used by check-contract-address.mjs and update-contract-address.mjs.
export const OLD_ADDRESS = '5de1a75b560c1fad56bd4b41eece7ec15f16e8e0734617b46afd0a664a1e4069';

// Files whose every occurrence of the address is "the current contract" (a hard-coded constant).
export const CODE_FILES = [
  'frontend/src/midnight/contract.ts',
  'src/e2e-existing.ts',
  'scripts/claim-item.ts',
  'scripts/close-and-reveal.ts',
  'scripts/close-from-pending-reveal.ts',
  'scripts/close-only-test.ts',
  'scripts/create-and-bid.ts',
  'scripts/create-only-test.ts',
  'scripts/debug-commitment.ts',
  'verification/e2e-mainnet-test.ts',
];

// Docs: only the lines matching `current` carry the current address. Every other occurrence of the
// OLD address is intentional history and MUST stay (README "Legacy Contract" table, DEPLOYMENT.md
// "Supersedes" row and the M5 history block).
export const DOC_FILES = [
  { file: 'README.md', current: /^> Current Contract:/, preservedOldMin: 1 },
  { file: 'DEPLOYMENT.md', current: /^\| Active contract \|/, preservedOldMin: 2, m6Row: /^\| Contract Address \| _\(blank — fill after deploy\)_ \|/ },
];

export const ADDRESS_RE = /\b[0-9a-f]{64}\b/g;
export const isAddress = (s) => /^[0-9a-f]{64}$/.test(s);

// Generates a brand-new throwaway Preview seed with node:crypto and writes it to
// .wallet-state/preview-seed (mode 600). Never prints the seed; refuses to overwrite.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';

const dir = '.wallet-state';
const file = `${dir}/preview-seed`;
if (existsSync(file)) {
  console.log(`exists: ${file} (not overwritten)`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
writeFileSync(file, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`written: ${file} (mode 600, contents not printed)`);

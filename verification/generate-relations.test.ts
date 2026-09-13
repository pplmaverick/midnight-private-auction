// Independent Reference Model Testing — hash-relation data generator.
//
// persistentHash (used by bidderPublicKey / auctioneerPublicKey / computeCommitment)
// is implemented as a compiled WASM primitive inside @midnight-ntwrk/onchain-runtime-v3
// with no publicly readable bit-level spec available in this environment, so a Python
// re-implementation cannot be verified byte-for-byte against it. Instead, this generates
// raw outputs from the REAL compiled circuits (via AuctionSimulator — no proof server,
// no mocking; see src/test/auction-simulator.ts) so verify_relations.py can check that
// those real outputs satisfy the RELATIONAL properties the spec requires (domain
// separation, determinism, input sensitivity, auctionId isolation) without ever
// reimplementing the hash itself.
//
// Run via vitest (not a standalone ts-node/esm script): constructing AuctionSimulator
// under this repo's `node --loader ts-node/esm` invocation reproducibly aborts the
// process before any circuit call runs, while the exact same code runs cleanly under
// vitest (see src/test/auction.test.ts, 12/12 passing). This is environment-specific
// module resolution behavior around the WASM-backed onchain-runtime dependency, not a
// property of the contract or the data being generated, so it does not change what
// this generator is actually testing — it only changes which runner executes it.
import { describe, it, expect } from 'vitest';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { writeFileSync, mkdirSync } from 'node:fs';
import { AuctionSimulator } from '../src/test/auction-simulator.js';
import { randomBytes } from '../src/test/utils.js';

setNetworkId('undeployed');

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const UINT32_MAX = 4294967295n;
const randomUint32 = (): bigint => BigInt(Math.floor(Math.random() * 4294967296));

describe('Independent Reference Model Testing — hash relation data generation', () => {
  it('generates domain-separation, determinism, sensitivity, and isolation datasets from the real compiled contract', () => {
    const sim = new AuctionSimulator(randomBytes(32));
    const ctx = sim.circuitContext;

    const auctioneerPK = (sk: Uint8Array): Uint8Array =>
      sim.contract.circuits.auctioneerPublicKey(ctx, sk).result;
    const bidderPK = (sk: Uint8Array, auctionId: bigint): Uint8Array =>
      sim.contract.circuits.bidderPublicKey(ctx, sk, auctionId).result;
    const commitment = (sk: Uint8Array, auctionId: bigint, amount: bigint, salt: Uint8Array): Uint8Array =>
      sim.contract.circuits.computeCommitment(ctx, sk, auctionId, amount, salt).result;

    // ---- 1. Domain separation: auctioneerPublicKey(sk) vs bidderPublicKey(sk, auctionId) ----
    const N_DOMAIN_SEPARATION = 1000;
    const domainSeparation = [];
    for (let i = 0; i < N_DOMAIN_SEPARATION; i++) {
      const sk = randomBytes(32);
      const auctionId = randomUint32();
      domainSeparation.push({
        sk: hex(sk),
        auctionId: auctionId.toString(),
        auctioneerPK: hex(auctioneerPK(sk)),
        bidderPK: hex(bidderPK(sk, auctionId)),
      });
    }

    // ---- 1b. bidderPublicKey auctionId isolation: same sk, different auctionIds ----
    const N_BIDDERPK_ISOLATION_GROUPS = 300;
    const AUCTION_IDS_PER_BIDDERPK_GROUP = 5;
    const bidderPkIsolation = [];
    for (let i = 0; i < N_BIDDERPK_ISOLATION_GROUPS; i++) {
      const sk = randomBytes(32);
      const seenIds = new Set<string>();
      const bidderPksByAuctionId: Record<string, string> = {};
      while (seenIds.size < AUCTION_IDS_PER_BIDDERPK_GROUP) {
        const auctionId = randomUint32();
        const key = auctionId.toString();
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        bidderPksByAuctionId[key] = hex(bidderPK(sk, auctionId));
      }
      bidderPkIsolation.push({ sk: hex(sk), bidderPksByAuctionId });
    }

    // ---- 2. Determinism: same inputs -> same computeCommitment output ----
    const N_DETERMINISM = 500;
    const determinism = [];
    for (let i = 0; i < N_DETERMINISM; i++) {
      const sk = randomBytes(32);
      const auctionId = randomUint32();
      const amount = randomUint32();
      const salt = randomBytes(32);
      determinism.push({
        sk: hex(sk),
        auctionId: auctionId.toString(),
        amount: amount.toString(),
        salt: hex(salt),
        result1: hex(commitment(sk, auctionId, amount, salt)),
        result2: hex(commitment(sk, auctionId, amount, salt)),
      });
    }

    // ---- 3. Input sensitivity: changing exactly one field must change the output ----
    const N_SENSITIVITY = 500;
    const sensitivity = [];
    for (let i = 0; i < N_SENSITIVITY; i++) {
      const sk = randomBytes(32);
      const auctionId = randomUint32();
      const amount = randomUint32();
      const salt = randomBytes(32);
      const base = commitment(sk, auctionId, amount, salt);

      const otherSk = randomBytes(32);
      const varySk = commitment(otherSk, auctionId, amount, salt);

      const otherAuctionId = auctionId === UINT32_MAX ? auctionId - 1n : auctionId + 1n;
      const varyAuctionId = commitment(sk, otherAuctionId, amount, salt);

      const otherAmount = amount === UINT32_MAX ? amount - 1n : amount + 1n;
      const varyAmount = commitment(sk, auctionId, otherAmount, salt);

      const flippedSalt = new Uint8Array(salt);
      flippedSalt[0] ^= 0xff;
      const varySalt = commitment(sk, auctionId, amount, flippedSalt);

      sensitivity.push({
        sk: hex(sk),
        auctionId: auctionId.toString(),
        amount: amount.toString(),
        salt: hex(salt),
        base: hex(base),
        varySk: hex(varySk),
        varyAuctionId: hex(varyAuctionId),
        varyAmount: hex(varyAmount),
        varySalt: hex(varySalt),
      });
    }

    // ---- 4. auctionId isolation: same (sk, amount, salt), different auctionIds ----
    const N_ISOLATION_GROUPS = 300;
    const AUCTION_IDS_PER_GROUP = 5;
    const isolation = [];
    for (let i = 0; i < N_ISOLATION_GROUPS; i++) {
      const sk = randomBytes(32);
      const amount = randomUint32();
      const salt = randomBytes(32);
      const seenIds = new Set<string>();
      const commitmentsByAuctionId: Record<string, string> = {};
      while (seenIds.size < AUCTION_IDS_PER_GROUP) {
        const auctionId = randomUint32();
        const key = auctionId.toString();
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        commitmentsByAuctionId[key] = hex(commitment(sk, auctionId, amount, salt));
      }
      isolation.push({ sk: hex(sk), amount: amount.toString(), salt: hex(salt), commitmentsByAuctionId });
    }

    mkdirSync('verification/data', { recursive: true });
    writeFileSync(
      'verification/data/relations.json',
      JSON.stringify({ domainSeparation, determinism, sensitivity, isolation, bidderPkIsolation }, null, 2),
    );

    // Sanity assertions so a vitest failure surfaces immediately if generation
    // itself broke, before Python-side relational verification even runs.
    expect(domainSeparation).toHaveLength(N_DOMAIN_SEPARATION);
    expect(determinism).toHaveLength(N_DETERMINISM);
    expect(sensitivity).toHaveLength(N_SENSITIVITY);
    expect(isolation).toHaveLength(N_ISOLATION_GROUPS);
    expect(bidderPkIsolation).toHaveLength(N_BIDDERPK_ISOLATION_GROUPS);
  });
});

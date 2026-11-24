import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { BrowserZkConfigProvider } from '../../frontend/src/midnight/browserZkConfigProvider.js';
import { AUCTION_CIRCUITS, artifactPath, redactLookupKey, resolveLookupKey } from '../../frontend/src/midnight/zkKeyLocation.js';

const PUBLIC = resolve(__dirname, '../../frontend/public');
const MANAGED = resolve(__dirname, '../../contract/src/managed/auction');
const ADDR = '118dc9f773df2137a1e0cfb0e9e0243dbf1c64e6a908c84442ca8bb272347e78';
const sha = (b: Uint8Array | Buffer) => createHash('sha256').update(b).digest('hex');
const vkOf = (c: string) => {
  try { return sha(readFileSync(`${PUBLIC}/keys/${c}.verifier`)); } catch { return 'b'.repeat(64); } // unknown circuit: any valid-looking hash
};
const loc = (c: string, vk = vkOf(c), addr = ADDR) => `contract:${addr}/${c}?vk=${vk}`;

// Fake fetch serving frontend/public; records every requested URL.
const makeFetch = (served: (path: string) => Buffer | undefined = (p) => {
  try { return readFileSync(`${PUBLIC}/${p}`); } catch { return undefined; }
}) => {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(url);
    const body = served(url.replace(/^\//, ''));
    return body
      ? { ok: true, status: 200, statusText: 'OK', arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
      : { ok: false, status: 404, statusText: 'Not Found', arrayBuffer: async () => new ArrayBuffer(0) };
  }) as unknown as typeof fetch;
  return { f, urls };
};

describe('lookup key resolution', () => {
  it('parses key locations and bare ids for all 6 circuits', () => {
    expect(AUCTION_CIRCUITS).toHaveLength(6);
    for (const c of AUCTION_CIRCUITS) {
      expect(resolveLookupKey(c)).toEqual({ circuitId: c });
      expect(resolveLookupKey(loc(c))).toEqual({ circuitId: c, expectedVerifierKeyHash: vkOf(c) });
    }
  });

  it('maps each circuit to the right file paths', () => {
    expect(artifactPath('prover', 'createAuction')).toBe('keys/createAuction.prover');
    expect(artifactPath('verifier', 'placeBid')).toBe('keys/placeBid.verifier');
    expect(artifactPath('zkir', 'claimItem')).toBe('zkir/claimItem.bzkir');
  });

  it('rejects unknown circuits, malformed locations and builtins, without echoing hex', () => {
    expect(() => resolveLookupKey(loc('nope'))).toThrow(/Unknown circuit 'nope'/);
    expect(() => resolveLookupKey('nope')).toThrow(/Unknown circuit/);
    expect(() => resolveLookupKey('midnight/zswap/spend')).toThrow(/Unknown circuit/);
    const bad = `contract:${ADDR}/createAuction?vk=XYZ`;
    expect(() => resolveLookupKey(bad)).toThrow(/Malformed contract key location/);
    expect(() => resolveLookupKey(`contract:${ADDR.slice(2)}/createAuction?vk=${'a'.repeat(64)}`)).toThrow(/Malformed/);
    expect(() => resolveLookupKey(loc('createAuction', 'A'.repeat(64)))).toThrow(/Malformed/); // vk must be lowercase
    for (const k of [loc('nope'), bad]) {
      try { resolveLookupKey(k); } catch (e) { expect(String((e as Error).message)).not.toMatch(/[0-9a-f]{16}/); }
    }
    expect(redactLookupKey(loc('createAuction'))).toBe('contract:<hex>/createAuction?vk=<hex>');
  });
});

describe('BrowserZkConfigProvider with key locations', () => {
  it('fetches the circuit file (never a path built from the raw key) for all circuits and kinds', async () => {
    const { f, urls } = makeFetch();
    const p = new BrowserZkConfigProvider<string>('', f);
    for (const c of AUCTION_CIRCUITS) {
      await p.getProverKey(loc(c));
      await p.getVerifierKey(loc(c));
      await p.getZKIR(loc(c));
      await p.getZKIR(c); // bare id still works
    }
    expect(urls.every((u) => !u.includes('contract:'))).toBe(true);
    expect(urls).toContain('/zkir/createAuction.bzkir');
    expect(urls).toContain('/keys/createAuction.prover');
    expect(urls).toContain('/keys/createAuction.verifier');
    expect(new Set(urls).size).toBe(AUCTION_CIRCUITS.length * 3);
  });

  it('returns the exact bytes of the files', async () => {
    const p = new BrowserZkConfigProvider<string>('', makeFetch().f);
    expect(Buffer.from(await p.getVerifierKey(loc('revealBid')))).toEqual(readFileSync(`${PUBLIC}/keys/revealBid.verifier`));
  });

  it('fails clearly when the served verifier key does not match the pinned vk (all three kinds)', async () => {
    const stale = makeFetch((path) => (path === 'keys/createAuction.verifier' ? Buffer.from('stale-key') : readFileSync(`${PUBLIC}/${path}`)));
    const p = new BrowserZkConfigProvider<string>('', stale.f);
    for (const call of [() => p.getProverKey(loc('createAuction')), () => p.getVerifierKey(loc('createAuction')), () => p.getZKIR(loc('createAuction'))]) {
      await expect(call()).rejects.toThrow(/Verifier key mismatch for circuit 'createAuction'/);
    }
    // other circuits are unaffected
    await expect(p.getProverKey(loc('placeBid'))).resolves.toBeDefined();
    // the wrong vk pinned by the caller is caught the same way
    const ok = new BrowserZkConfigProvider<string>('', makeFetch().f);
    await expect(ok.getZKIR(loc('createAuction', 'f'.repeat(64)))).rejects.toThrow(/Verifier key mismatch/);
  });

  it('unknown circuit or malformed key: clear error and no request is made', async () => {
    const { f, urls } = makeFetch();
    const p = new BrowserZkConfigProvider<string>('', f);
    await expect(p.getZKIR(loc('bogus'))).rejects.toThrow(/Unknown circuit 'bogus'/);
    await expect(p.getProverKey('contract:garbage')).rejects.toThrow(/Malformed/);
    expect(urls).toHaveLength(0);
  });

  it('surfaces a missing file as a fetch error naming the real path', async () => {
    const p = new BrowserZkConfigProvider<string>('', makeFetch(() => undefined).f);
    await expect(p.getZKIR('createAuction')).rejects.toThrow('Failed to fetch /zkir/createAuction.bzkir: 404');
  });
});

describe('frontend/public is in sync with the compiled contract', () => {
  it('keys and zkir are byte-identical to contract/src/managed/auction for every circuit', () => {
    for (const c of AUCTION_CIRCUITS) {
      for (const [a, b] of [
        [`${PUBLIC}/keys/${c}.prover`, `${MANAGED}/keys/${c}.prover`],
        [`${PUBLIC}/keys/${c}.verifier`, `${MANAGED}/keys/${c}.verifier`],
        [`${PUBLIC}/zkir/${c}.bzkir`, `${MANAGED}/zkir/${c}.bzkir`],
      ]) {
        expect(sha(readFileSync(a)), `${c}: ${a}`).toBe(sha(readFileSync(b)));
      }
    }
  });
});

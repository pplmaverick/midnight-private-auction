import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import proxy from '../../frontend/api/indexer.js';

// Unit tests for the Vercel Function in frontend/api/indexer.ts. Upstream (Blockfrost) is
// mocked via a stubbed global fetch, so no network access or real token is needed.

const OWN_HOST = 'midnight-private-auction.vercel.app';
const ENV_KEYS = [
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'ALLOWED_ORIGIN_HOSTS',
  'BLOCKFROST_PROJECT_ID',
] as const;

// The proxy's response cache is module-level, so every request gets a unique query to keep
// tests independent of each other.
let seq = 0;
const makeRequest = (opts: { origin?: string | null; host?: string; headers?: Record<string, string> } = {}): Request => {
  const query = `query Q${seq++}($a: HexEncoded!) { contractAction(address: $a) { state } }`;
  return makeRequestWithQuery(query, opts);
};
const makeRequestWithQuery = (
  query: string,
  opts: { origin?: string | null; host?: string; headers?: Record<string, string> } = {},
): Request => {
  const host = opts.host ?? OWN_HOST;
  const headers: Record<string, string> = { host, 'content-type': 'application/json', ...opts.headers };
  if (opts.origin !== null) headers.origin = opts.origin ?? `https://${host}`;
  return new Request(`https://${host}/api/indexer`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: { a: 'ab' } }),
  });
};

const okBody = JSON.stringify({ data: { contractAction: { state: 'deadbeef' } } });

let upstreamFetch: ReturnType<typeof vi.fn>;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.BLOCKFROST_PROJECT_ID = 'test-token';
  // Default: behave like a production deployment whose allow-list is just the production host.
  process.env.VERCEL_ENV = 'production';
  process.env.VERCEL_PROJECT_PRODUCTION_URL = OWN_HOST;
  upstreamFetch = vi.fn(async () => new Response(okBody, { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', upstreamFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('indexer proxy — response cache', () => {
  it('serves an identical successful query from cache (upstream hit once)', async () => {
    const q = 'query CacheOk { contractAction(address: "x") { state } }';
    const first = await proxy.fetch(makeRequestWithQuery(q));
    const second = await proxy.fetch(makeRequestWithQuery(q));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('x-proxy-cache')).toBe('hit');
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache HTTP 200 + {"errors":[...]} — the second identical request hits upstream again', async () => {
    upstreamFetch.mockImplementation(
      async () => new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 }),
    );
    const q = 'query CacheErrors { contractAction(address: "x") { state } }';
    const first = await proxy.fetch(makeRequestWithQuery(q));
    const second = await proxy.fetch(makeRequestWithQuery(q));
    expect(first.status).toBe(200);
    expect(second.headers.get('x-proxy-cache')).toBeNull();
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache a 200 that carries both data and errors (partial failure)', async () => {
    upstreamFetch.mockImplementation(
      async () => new Response(JSON.stringify({ data: { contractAction: null }, errors: [{ message: 'x' }] }), { status: 200 }),
    );
    const q = 'query CachePartial { contractAction(address: "x") { state } }';
    await proxy.fetch(makeRequestWithQuery(q));
    await proxy.fetch(makeRequestWithQuery(q));
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache {"data": null}', async () => {
    upstreamFetch.mockImplementation(async () => new Response(JSON.stringify({ data: null }), { status: 200 }));
    const q = 'query CacheNull { contractAction(address: "x") { state } }';
    await proxy.fetch(makeRequestWithQuery(q));
    await proxy.fetch(makeRequestWithQuery(q));
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it.each([403, 500, 502])('does NOT cache upstream HTTP %i, and passes the status through', async (status) => {
    upstreamFetch.mockImplementation(async () => new Response('{"message":"nope"}', { status }));
    const q = `query CacheHttp${status} { contractAction(address: "x") { state } }`;
    const first = await proxy.fetch(makeRequestWithQuery(q));
    const second = await proxy.fetch(makeRequestWithQuery(q));
    expect(first.status).toBe(status);
    expect(second.status).toBe(status);
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache a non-JSON 200 body', async () => {
    upstreamFetch.mockImplementation(async () => new Response('<html>gateway</html>', { status: 200 }));
    const q = 'query CacheHtml { contractAction(address: "x") { state } }';
    await proxy.fetch(makeRequestWithQuery(q));
    await proxy.fetch(makeRequestWithQuery(q));
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it('sends the project_id as a header, never in the URL', async () => {
    await proxy.fetch(makeRequest());
    const [url, init] = upstreamFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('project_id');
    expect((init.headers as Record<string, string>).project_id).toBe('test-token');
  });
});

describe('indexer proxy — Origin allow-list', () => {
  const status = async (origin: string | null, extra: Parameters<typeof makeRequest>[0] = {}) =>
    (await proxy.fetch(makeRequest({ ...extra, origin }))).status;

  it('allows VERCEL_URL, VERCEL_BRANCH_URL and VERCEL_PROJECT_PRODUCTION_URL hosts over https', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'midnight-private-auction-abc123-team.vercel.app';
    process.env.VERCEL_BRANCH_URL = 'midnight-private-auction-git-feature-team.vercel.app';
    expect(await status('https://midnight-private-auction-abc123-team.vercel.app')).toBe(200);
    expect(await status('https://midnight-private-auction-git-feature-team.vercel.app')).toBe(200);
    expect(await status(`https://${OWN_HOST}`)).toBe(200);
  });

  it('allows hosts from ALLOWED_ORIGIN_HOSTS (comma-separated, whitespace and case tolerant)', async () => {
    process.env.ALLOWED_ORIGIN_HOSTS = ' auction.example.com , Other.Example.org ';
    expect(await status('https://auction.example.com')).toBe(200);
    expect(await status('https://other.example.org')).toBe(200);
  });

  it('requires https — http origins are rejected even for an allowed host', async () => {
    expect(await status(`http://${OWN_HOST}`)).toBe(403);
  });

  it('matches the host exactly — no substring, suffix, prefix, subdomain or port tricks', async () => {
    expect(await status(`https://evil-${OWN_HOST}`)).toBe(403);
    expect(await status(`https://${OWN_HOST}.evil.com`)).toBe(403);
    expect(await status(`https://evil.com/${OWN_HOST}`)).toBe(403);
    expect(await status(`https://sub.${OWN_HOST}`)).toBe(403);
    expect(await status(`https://${OWN_HOST}:8443`)).toBe(403);
    expect(await status(`https://user@evil.com#${OWN_HOST}`)).toBe(403);
  });

  it('rejects a missing or malformed Origin', async () => {
    expect(await status(null)).toBe(403);
    expect(await status('not a url')).toBe(403);
  });

  it('ignores x-forwarded-host and the request Host header on a real deployment', async () => {
    expect(
      await status('https://evil.example', { host: 'evil.example', headers: { 'x-forwarded-host': 'evil.example' } }),
    ).toBe(403);
  });

  it('fails closed on a deployment with no allow-list values at all', async () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(await status(`https://${OWN_HOST}`)).toBe(403);
  });

  describe('local development (VERCEL_ENV unset)', () => {
    beforeEach(() => {
      delete process.env.VERCEL_ENV;
      delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    });

    it('falls back to the request host, and allows http for localhost only', async () => {
      expect(await status('http://localhost:5173', { host: 'localhost:5173' })).toBe(200);
      expect(await status('http://127.0.0.1:3000', { host: '127.0.0.1:3000' })).toBe(200);
    });

    it('still rejects a different site, and http for a non-local host', async () => {
      expect(await status('https://evil.example', { host: 'localhost:5173' })).toBe(403);
      expect(await status('http://example.com', { host: 'example.com' })).toBe(403);
    });
  });
});

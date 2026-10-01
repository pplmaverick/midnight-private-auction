// Vercel Function: same-origin read-only proxy to the Blockfrost-hosted Midnight indexer.
//
// The Midnight-hosted indexer was shut down (2026-09-30); the replacement requires a
// Blockfrost project_id. That token must never reach the browser, so the frontend POSTs its
// GraphQL queries here and this function adds the token as a header (BLOCKFROST_PROJECT_ID,
// deliberately without a VITE_ prefix so Vite never bundles it).
//
// Only GraphQL *queries* are forwarded: no subscriptions (the frontend polls over HTTP),
// no mutations. Upstream HTTP status codes are passed through unchanged so the frontend can
// tell an auth failure (403) from an ordinary read failure.

const UPSTREAM_URL = 'https://midnight-mainnet.blockfrost.io/api/v0'
const MAX_BODY_BYTES = 32 * 1024
const UPSTREAM_TIMEOUT_MS = 15_000

// Blockfrost bills per request, and Vercel's CDN does not cache POST responses, so a
// Cache-Control: s-maxage header would be a no-op here. A short in-memory cache (per warm
// function instance) gives the same effect for bursts of identical reads.
const CACHE_TTL_MS = 5_000
const CACHE_MAX_ENTRIES = 50
const cache = new Map<string, { expires: number; body: string; contentType: string }>()

const json = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  })

// Origin allow-list, built from Vercel's system environment variables (no reliance on
// x-forwarded-host or any client-supplied header):
//   VERCEL_URL                     this deployment's own URL (production and preview)
//   VERCEL_BRANCH_URL              the git-branch URL (preview / branch deployments)
//   VERCEL_PROJECT_PRODUCTION_URL  the project's production domain (set in every environment)
//   ALLOWED_ORIGIN_HOSTS           optional, comma-separated extra hosts (custom domains)
// All hold a bare host (no scheme), e.g. "my-site.vercel.app", and are matched against the
// request's Origin host by exact string equality. The Origin scheme must be https.
const allowedOriginHosts = (): Set<string> => {
  const raw = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ...(process.env.ALLOWED_ORIGIN_HOSTS ?? '').split(','),
  ]
  return new Set(raw.map((h) => h?.trim().toLowerCase()).filter((h): h is string => !!h))
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

const isAllowedOrigin = (request: Request): boolean => {
  const origin = request.headers.get('origin')
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  const originHost = parsed.host.toLowerCase()

  // VERCEL_ENV is "production" / "preview" / "development" on Vercel (incl. `vercel dev`)
  // and unset under plain Node, so this is only true for local runs.
  const isLocalDev = !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'development'
  const isLocalOrigin = isLocalDev && LOCAL_HOSTNAMES.has(parsed.hostname.toLowerCase())
  // https is required everywhere except a localhost origin during local development.
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalOrigin)) return false

  const allowed = allowedOriginHosts()
  if (allowed.size > 0) return allowed.has(originHost)

  // No allow-list values at all: only local development may fall back to comparing against
  // the request's own host. On a real deployment this fails closed (a misconfiguration, e.g.
  // system environment variables disabled, then shows up as 403 rather than as an open proxy).
  if (!isLocalDev) return false
  const ownHost = (request.headers.get('host') ?? new URL(request.url).host).toLowerCase()
  return originHost === ownHost
}

// Only successful, error-free GraphQL results may be cached. GraphQL servers report query
// failures as HTTP 200 with an `errors` array, so the status code alone is not enough.
const isCacheableGraphqlResponse = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
    const body = parsed as { data?: unknown; errors?: unknown }
    return !('errors' in body) && body.data !== null && body.data !== undefined
  } catch {
    return false
  }
}

// Sound (never under-rejects): any mutation/subscription operation must contain its
// keyword, and an anonymous `{ ... }` document is always a query. May over-reject a query
// that merely mentions the word in a string literal, which is acceptable.
const FORBIDDEN_OPERATION = /\b(mutation|subscription)\b/i

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json(405, { error: 'Method not allowed' }, { allow: 'POST' })
    }
    if (!isAllowedOrigin(request)) {
      return json(403, { error: 'Origin not allowed' })
    }

    const token = process.env.BLOCKFROST_PROJECT_ID
    if (!token) {
      return json(500, { error: 'Indexer proxy is not configured' })
    }

    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (declaredLength > MAX_BODY_BYTES) {
      return json(413, { error: 'Request body too large' })
    }
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).length > MAX_BODY_BYTES) {
      return json(413, { error: 'Request body too large' })
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      return json(400, { error: 'Body must be JSON' })
    }
    // A single GraphQL operation only — no batched arrays.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return json(400, { error: 'Body must be a single GraphQL request object' })
    }
    const query = (parsed as { query?: unknown }).query
    if (typeof query !== 'string' || query.length === 0) {
      return json(400, { error: 'Missing GraphQL query' })
    }
    if (FORBIDDEN_OPERATION.test(query)) {
      return json(400, { error: 'Only GraphQL queries are allowed' })
    }

    const cached = cache.get(bodyText)
    if (cached && cached.expires > Date.now()) {
      return new Response(cached.body, {
        status: 200,
        headers: { 'content-type': cached.contentType, 'cache-control': 'no-store', 'x-proxy-cache': 'hit' },
      })
    }

    let upstream: Response
    try {
      upstream = await fetch(UPSTREAM_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', project_id: token },
        body: bodyText,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      return json(timedOut ? 504 : 502, { error: timedOut ? 'Indexer timed out' : 'Indexer unreachable' })
    }

    const upstreamBody = await upstream.text()
    const contentType = upstream.headers.get('content-type') ?? 'application/json'

    if (upstream.ok && isCacheableGraphqlResponse(upstreamBody)) {
      if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
      cache.set(bodyText, { expires: Date.now() + CACHE_TTL_MS, body: upstreamBody, contentType })
    }

    // Status code and body pass through untouched (403 stays 403).
    return new Response(upstreamBody, {
      status: upstream.status,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    })
  },
}

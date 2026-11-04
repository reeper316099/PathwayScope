// Tests for the main-process fetch pipeline using a fake fetch and an in-memory cache (no network, no Electron).
import { describe, expect, it, vi } from 'vitest';
import { RateLimiter, performFetch } from '../../electron/remoteFetch.js';
import { validateFetchRequest } from '../../electron/validate.js';

// In-memory stand-in for DiskCache.
function memCache() {
  const m = new Map();
  return {
    read: async (k) => m.get(k) ?? null,
    write: async (k, v) => void m.set(k, v),
    size: () => m.size,
  };
}
// Builds a minimal fetch Response-like object from text.
function reply(body, { status = 200, type = 'application/json', headers = {} } = {}) {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    status,
    headers: new Map(Object.entries({ 'content-type': type, ...headers })),
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
      }),
    },
  };
}
const limiter = () => new RateLimiter({ 'reactome.org': 0 });
const GET = 'https://reactome.org/ContentService/data/database/info';

describe('performFetch', () => {
  it('parses JSON, and serves the second call from cache', async () => {
    const cache = memCache();
    const fetchImpl = vi.fn(async () => reply('{"releaseNumber":98}'));
    const req = validateFetchRequest(GET, { cacheTtlSeconds: 60 });
    const first = await performFetch(req, { cache, limiter: limiter(), fetchImpl });
    const second = await performFetch(req, { cache, limiter: limiter(), fetchImpl });
    expect(first.data).toEqual({ releaseNumber: 98 });
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('returns non-JSON bodies as text (SVG)', async () => {
    const out = await performFetch(validateFetchRequest(GET), {
      cache: memCache(),
      limiter: limiter(),
      fetchImpl: async () => reply('<svg/>', { type: 'image/svg+xml' }),
    });
    expect(out.data).toBe('<svg/>');
  });
  it('reports HTTP errors with status and body', async () => {
    const out = await performFetch(validateFetchRequest(GET), {
      cache: memCache(),
      limiter: limiter(),
      fetchImpl: async () => reply('{"code":404}', { status: 404 }),
    });
    expect(out).toMatchObject({ ok: false, status: 404, data: { code: 404 } });
  });
  it('falls back to a stale cached copy when the network fails, and says so', async () => {
    const cache = memCache();
    const req = validateFetchRequest(GET, { cacheTtlSeconds: 1 });
    let t = 1000;
    await performFetch(req, {
      cache,
      limiter: limiter(),
      fetchImpl: async () => reply('{"a":1}'),
      now: () => t,
    });
    t = 999_999;
    const out = await performFetch(req, {
      cache,
      limiter: limiter(),
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
      now: () => t,
    });
    expect(out).toMatchObject({ ok: true, stale: true, fromCache: true, data: { a: 1 } });
  });
  it('returns an error (not a crash) when offline and nothing is cached', async () => {
    const out = await performFetch(validateFetchRequest(GET), {
      cache: memCache(),
      limiter: limiter(),
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });
    expect(out.ok).toBe(false);
  }, 10_000);
  it('never retries a POST', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('boom');
    });
    const req = validateFetchRequest(
      'https://reactome.org/AnalysisService/identifiers/projection',
      { method: 'POST', body: 'TP53' },
    );
    await performFetch(req, { cache: memCache(), limiter: limiter(), fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('refuses a redirect to a non-allowlisted host', async () => {
    const fetchImpl = vi.fn(async () =>
      reply('', { status: 302, headers: { location: 'https://evil.example.com/x' } }),
    );
    const out = await performFetch(validateFetchRequest(GET), {
      cache: memCache(),
      limiter: limiter(),
      fetchImpl,
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('host-not-allowed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('includes the POST body in the cache key', async () => {
    const cache = memCache();
    const fetchImpl = vi.fn(async () => reply('{"ok":1}'));
    const url = 'https://reactome.org/AnalysisService/identifiers/projection';
    for (const body of ['TP53', 'BRCA1']) {
      await performFetch(validateFetchRequest(url, { method: 'POST', body, cacheTtlSeconds: 60 }), {
        cache,
        limiter: limiter(),
        fetchImpl,
      });
    }
    expect(cache.size()).toBe(2);
  });
});

describe('RateLimiter', () => {
  it('spaces calls to the same host by the minimum interval', async () => {
    let now = 0;
    const l = new RateLimiter({ h: 100 }, () => now);
    const slots = [];
    for (let i = 0; i < 3; i += 1) {
      l.nextSlot.get('h');
      const before = Math.max(now, l.nextSlot.get('h') ?? 0);
      slots.push(before);
      l.nextSlot.set('h', before + 100);
    }
    expect(slots).toEqual([0, 100, 200]);
  });
});

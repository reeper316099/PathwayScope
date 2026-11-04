// Tests for the browser path of the HTTP adapter (fetch is stubbed; no network).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_LIMITS, cache, getJson, getJsonWithMeta, HttpError } from '../../src/core/http.js';

const saved = { ...BROWSER_LIMITS };
afterEach(() => {
  Object.assign(BROWSER_LIMITS, saved);
  vi.unstubAllGlobals();
  cache.clear();
});

// Builds a fetch Response-like object.
const res = (body, { status = 200, type = 'application/json' } = {}) => ({
  ok: status < 400,
  status,
  headers: { get: () => type },
  text: async () => body,
});

describe('getJson (browser path)', () => {
  it('parses JSON and returns text for non-JSON', async () => {
    vi.stubGlobal('fetch', async () => res('{"a":1}'));
    expect(await getJson('https://x/a')).toEqual({ a: 1 });
    vi.stubGlobal('fetch', async () => res('<svg/>', { type: 'image/svg+xml' }));
    expect(await getJson('https://x/b')).toBe('<svg/>');
  });
  it('throws HttpError(http) with status for 404', async () => {
    vi.stubGlobal('fetch', async () => res('{"code":404}', { status: 404 }));
    await expect(getJson('https://x/c')).rejects.toMatchObject({ kind: 'http', status: 404 });
  });
  it('throws a network error when fetch fails and nothing is cached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(getJson('https://x/d')).rejects.toBeInstanceOf(HttpError);
  });
  it('caches when ttl > 0 and falls back to the stale copy when offline', async () => {
    const f = vi.fn(async () => res('{"v":1}'));
    vi.stubGlobal('fetch', f);
    await getJsonWithMeta('https://x/e', { ttl: 60 });
    const hit = await getJsonWithMeta('https://x/e', { ttl: 60 });
    expect(hit.fromCache).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported methods', () => {
    expect(() => getJsonWithMeta('https://x', { method: 'DELETE' })).toThrow(HttpError);
  });
  it('honours an already-aborted signal', async () => {
    vi.stubGlobal('fetch', async (_u, { signal }) => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return res('{}');
    });
    const ac = new AbortController();
    ac.abort();
    await expect(getJson('https://x/f', { signal: ac.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});

describe('getJson (Electron path via window.api)', () => {
  // Installs a fake preload API on a fake window for the duration of one test.
  const withApi = (fetchJson) => vi.stubGlobal('window', { api: { fetchJson } });
  it('passes options through to the main process and returns cache metadata', async () => {
    const fetchJson = vi.fn(async () => ({
      ok: true,
      data: { a: 1 },
      cachedAt: 123,
      fromCache: true,
      stale: false,
    }));
    withApi(fetchJson);
    const out = await getJsonWithMeta('https://reactome.org/x', {
      method: 'POST',
      body: 'TP53',
      headers: { 'Content-Type': 'text/plain' },
      ttl: 60,
      timeoutMs: 5000,
    });
    expect(out).toEqual({ data: { a: 1 }, cachedAt: 123, fromCache: true, stale: false });
    expect(fetchJson).toHaveBeenCalledWith('https://reactome.org/x', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'TP53',
      cacheTtlSeconds: 60,
      timeoutMs: 5000,
      label: 'Cached POST response from reactome.org',
      kind: 'other',
    });
  });
  it('maps main-process errors to HttpError kinds', async () => {
    withApi(async () => ({ ok: false, status: 404, error: 'HTTP 404', data: { code: 404 } }));
    await expect(getJson('https://reactome.org/x')).rejects.toMatchObject({
      kind: 'http',
      status: 404,
      data: { code: 404 },
    });
    withApi(async () => ({ ok: false, error: 'Request timed out.', code: 'timeout' }));
    await expect(getJson('https://reactome.org/x')).rejects.toMatchObject({ kind: 'timeout' });
    withApi(async () => ({ ok: false, error: 'offline', code: 'network' }));
    await expect(getJson('https://reactome.org/x')).rejects.toMatchObject({ kind: 'network' });
    withApi(async () => ({ ok: false, error: 'Host not allowlisted', code: 'host-not-allowed' }));
    await expect(getJson('https://reactome.org/x')).rejects.toMatchObject({ kind: 'blocked' });
  });
  it('rejects with kind "aborted" when the caller cancels while the main process is busy', async () => {
    withApi(() => new Promise(() => {}));
    const ac = new AbortController();
    const pending = getJson('https://reactome.org/x', { signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    withApi(async () => ({ ok: true, data: 1 }));
    await expect(getJson('https://reactome.org/x', { signal: ac.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });
});

describe('getJson (browser retry and throttling)', () => {
  it('retries a GET once after a network failure (CDN rate limits often look like CORS errors)', async () => {
    BROWSER_LIMITS.retryDelayMs = 0;
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return res('{"ok":1}');
    });
    expect(await getJson('https://x/retry')).toEqual({ ok: 1 });
    expect(calls).toBe(2);
  });
  it('retries a GET once on HTTP 429 and 503, but not on 404', async () => {
    BROWSER_LIMITS.retryDelayMs = 0;
    for (const [status, expected] of [
      [429, 2],
      [503, 2],
      [404, 1],
    ]) {
      let calls = 0;
      vi.stubGlobal('fetch', async () => {
        calls += 1;
        return calls === 1 || status === 404 ? res('{}', { status }) : res('{"ok":1}');
      });
      await getJson(`https://x/${status}`).catch(() => {});
      expect(calls).toBe(expected);
    }
  });
  it('never retries a POST', async () => {
    BROWSER_LIMITS.retryDelayMs = 0;
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    });
    await expect(getJson('https://x/post', { method: 'POST', body: 'a' })).rejects.toMatchObject({
      kind: 'network',
    });
    expect(calls).toBe(1);
  });
  it('gives up after the single retry', async () => {
    BROWSER_LIMITS.retryDelayMs = 0;
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      throw new TypeError('Failed to fetch');
    });
    await expect(getJson('https://x/dead')).rejects.toMatchObject({ kind: 'network' });
    expect(calls).toBe(2);
  });
  it('limits concurrent requests per host and spaces them apart', async () => {
    BROWSER_LIMITS.gapMs = 20;
    BROWSER_LIMITS.maxInFlight = 2;
    let active = 0;
    let peak = 0;
    const starts = [];
    vi.stubGlobal('fetch', async () => {
      active += 1;
      peak = Math.max(peak, active);
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      return res('{}');
    });
    await Promise.all(Array.from({ length: 6 }, (_, i) => getJson(`https://same.host/${i}`)));
    expect(peak).toBeLessThanOrEqual(2);
    expect(starts[5] - starts[0]).toBeGreaterThanOrEqual(80); // 5 gaps of ~20 ms, with timer slack
  });
});

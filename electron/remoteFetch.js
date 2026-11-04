// The main-process network client: rate limiting, timeout, size cap, manual redirects, retry (GET only), disk cache.
import { FETCH_HOSTS, LIMITS, MIN_INTERVAL_MS } from './allowlist.js';
import { cacheKey } from './diskCache.js';

const MAX_REDIRECTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Per-host limiter: each call waits until at least minInterval ms after the previous call to that host.
export class RateLimiter {
  // Stores the per-host minimum gaps and the next free slot per host.
  constructor(intervals = MIN_INTERVAL_MS, now = () => Date.now()) {
    this.intervals = intervals;
    this.now = now;
    this.nextSlot = new Map();
  }

  // Reserves the next slot for a host and sleeps until it arrives (reservation is synchronous, so it is race-free).
  async wait(host) {
    const gap = this.intervals[host] ?? 100;
    const start = Math.max(this.now(), this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, start + gap);
    const delay = start - this.now();
    if (delay > 0) await sleep(delay);
  }
}

// Reads a response body as text but aborts once it exceeds the byte cap.
async function readCapped(res, controller) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.maxResponseBytes) {
      controller.abort();
      throw Object.assign(new Error('Response too large.'), { code: 'response-too-large' });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// One network attempt: follows redirects manually and re-checks every hop against the host allowlist.
async function attempt(req, limiter, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    let url = req.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (url.protocol !== 'https:' || !FETCH_HOSTS.has(url.hostname)) {
        throw Object.assign(new Error('Redirect to a non-allowlisted host blocked.'), {
          code: 'host-not-allowed',
        });
      }
      await limiter.wait(url.hostname);
      const res = await fetchImpl(url.href, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      const text = await readCapped(res, controller);
      const type = res.headers.get('content-type') ?? '';
      let data = text;
      if (type.includes('json')) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return { status: res.status, data };
    }
    throw Object.assign(new Error('Too many redirects.'), { code: 'too-many-redirects' });
  } catch (error) {
    if (controller.signal.aborted && !error.code) {
      throw Object.assign(new Error('Request timed out.'), { code: 'timeout' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Fetches with one backoff retry for GET only (a POST is never blindly repeated).
async function fetchWithRetry(req, limiter, fetchImpl) {
  const retriable = (e) =>
    req.method === 'GET' && !['host-not-allowed', 'response-too-large'].includes(e.code);
  try {
    const out = await attempt(req, limiter, fetchImpl);
    if (req.method === 'GET' && (out.status === 429 || out.status >= 500)) {
      await sleep(out.status === 429 ? 2500 : 800);
      return await attempt(req, limiter, fetchImpl);
    }
    return out;
  } catch (error) {
    if (!retriable(error)) throw error;
    await sleep(800);
    return attempt(req, limiter, fetchImpl);
  }
}

// Full pipeline for a validated request: fresh cache -> network -> (on network failure) stale cache.
export async function performFetch(req, { cache, limiter, fetchImpl = fetch, now = Date.now }) {
  const key = cacheKey(req.method, req.url.href, req.body ?? '');
  const cached = req.cacheTtlSeconds > 0 ? await cache.read(key) : null;
  if (cached && now() - cached.cachedAt < req.cacheTtlSeconds * 1000) {
    return {
      ok: true,
      status: cached.status,
      data: cached.data,
      cachedAt: cached.cachedAt,
      fromCache: true,
      stale: false,
    };
  }
  try {
    const { status, data } = await fetchWithRetry(req, limiter, fetchImpl);
    if (status >= 200 && status < 300) {
      const cachedAt = now();
      if (req.cacheTtlSeconds > 0)
        await cache.write(key, { cachedAt, status, data }, { label: req.label, kind: req.kind });
      return { ok: true, status, data, cachedAt: null, fromCache: false, stale: false };
    }
    return { ok: false, status, data, error: `HTTP ${status}` };
  } catch (error) {
    // Offline or blocked: fall back to ANY cached copy (even expired) and say so honestly.
    const old = await cache.read(key);
    if (old && req.cacheTtlSeconds > 0) {
      return {
        ok: true,
        status: old.status,
        data: old.data,
        cachedAt: old.cachedAt,
        fromCache: true,
        stale: true,
      };
    }
    return { ok: false, error: error.message || 'Network error', code: error.code ?? 'network' };
  }
}

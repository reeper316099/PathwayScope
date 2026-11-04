// THE network adapter. Every request in the app goes through getJson(); nothing else may call fetch.
// In Electron it uses window.api.fetchJson (main process: allowlist, rate limit, disk cache). In a browser it uses fetch().
import { createCache } from './cache.js';

export const cache = createCache();

// Error with a `kind` the UI can switch on: 'network' | 'timeout' | 'http' | 'blocked' | 'aborted'.
export class HttpError extends Error {
  constructor(kind, message, { status = null, data = null } = {}) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.status = status;
    this.data = data;
  }
}

// True when running inside the Electron shell (preload exposed window.api).
export const isElectron = () =>
  typeof window !== 'undefined' && typeof window.api?.fetchJson === 'function';

// Small deterministic string hash (FNV-1a) used to put POST bodies into cache keys.
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Builds the cache key for a request (method + URL + body hash).
export const requestKey = (method, url, body) => `${method} ${url} ${hashString(body ?? '')}`;

// Rejects when the caller's AbortSignal fires, so a newer search can cancel an older one.
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new HttpError('aborted', 'Request cancelled.'));
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      signal.addEventListener(
        'abort',
        () => reject(new HttpError('aborted', 'Request cancelled.')),
        { once: true },
      ),
    ),
  ]);
}

// Electron path: delegate to the main process and translate its {ok,...} reply.
async function viaElectron(url, opts) {
  const reply = await abortable(
    window.api.fetchJson(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      cacheTtlSeconds: opts.ttl,
      timeoutMs: opts.timeoutMs,
    }),
    opts.signal,
  );
  if (reply.ok)
    return {
      data: reply.data,
      cachedAt: reply.cachedAt,
      fromCache: reply.fromCache,
      stale: reply.stale,
    };
  if (reply.status)
    throw new HttpError('http', reply.error, { status: reply.status, data: reply.data });
  const kind =
    reply.code === 'timeout' ? 'timeout' : reply.code === 'network' ? 'network' : 'blocked';
  throw new HttpError(kind, reply.error);
}

// Browser path: memory/localStorage cache, then fetch() with timeout; on network failure fall back to a stale copy.
async function viaBrowser(url, opts) {
  if (opts.signal?.aborted) throw new HttpError('aborted', 'Request cancelled.');
  const key = requestKey(opts.method, url, opts.body);
  if (opts.ttl > 0) {
    const hit = cache.get(key);
    if (hit) return { data: hit.value, cachedAt: hit.cachedAt, fromCache: true, stale: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = text;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) throw new HttpError('http', `HTTP ${res.status}`, { status: res.status, data });
    if (opts.ttl > 0) cache.set(key, data, opts.ttl);
    return { data, cachedAt: null, fromCache: false, stale: false };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (opts.signal?.aborted) throw new HttpError('aborted', 'Request cancelled.');
    const stale = opts.ttl > 0 ? cache.get(key, { allowStale: true }) : null;
    if (stale) return { data: stale.value, cachedAt: stale.cachedAt, fromCache: true, stale: true };
    if (controller.signal.aborted) throw new HttpError('timeout', 'Request timed out.');
    throw new HttpError(
      'network',
      'Network request failed (offline, or the source blocks browser access).',
    );
  } finally {
    clearTimeout(timer);
  }
}

// Fetches a URL and returns { data, cachedAt, fromCache, stale } so the UI can show "cached 2 days ago".
export function getJsonWithMeta(
  url,
  { method = 'GET', headers = {}, body, ttl = 0, timeoutMs = 20_000, signal } = {},
) {
  if (method !== 'GET' && method !== 'POST')
    throw new HttpError('blocked', 'Only GET and POST are supported.');
  const opts = { method, headers, body, ttl, timeoutMs, signal };
  return isElectron() ? viaElectron(url, opts) : viaBrowser(url, opts);
}

// Convenience wrapper that returns only the data (JSON object, or text for non-JSON responses such as SVG).
export async function getJson(url, options) {
  return (await getJsonWithMeta(url, options)).data;
}

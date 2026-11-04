// THE network adapter. Every request in the app goes through getJson(); nothing else may call fetch.
// In Electron it uses window.api.fetchJson (main process: allowlist, rate limit, disk cache). In a browser it uses fetch().
import { createCache } from './cache.js';
import { describeRequest } from './describe.js';

export const cache = createCache();

const metaListeners = new Set();

// Subscribes to every request outcome ({type:'ok',fromCache,stale,cachedAt} or {type:'error',error}); returns an unsubscribe function.
export function onRequestMeta(listener) {
  metaListeners.add(listener);
  return () => metaListeners.delete(listener);
}

// Tells listeners (the offline banner) about a request outcome; a faulty listener can never break a request.
function notify(event) {
  for (const fn of metaListeners) {
    try {
      fn(event);
    } catch {
      // Ignore listener errors.
    }
  }
}

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
      label: opts.label.label,
      kind: opts.label.kind,
      owners: opts.owners,
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

// Browser-side politeness: at most a few requests per host in flight, spaced apart (mirrors the Electron main process).
export const BROWSER_LIMITS = { gapMs: 120, retryDelayMs: 1500, maxInFlight: 4 };
const hostState = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits for this host's next free slot and an in-flight place; returns a function that releases the place.
async function acquire(url) {
  const host = new URL(url, globalThis.location?.href ?? 'http://localhost').host;
  const st = hostState.get(host) ?? { next: 0, active: 0, waiters: [] };
  hostState.set(host, st);
  while (st.active >= BROWSER_LIMITS.maxInFlight)
    await new Promise((resolve) => st.waiters.push(resolve));
  st.active += 1;
  const start = Math.max(Date.now(), st.next);
  st.next = start + BROWSER_LIMITS.gapMs;
  if (start > Date.now()) await sleep(start - Date.now());
  return () => {
    st.active -= 1;
    st.waiters.shift()?.();
  };
}

// One browser fetch attempt with timeout; throws HttpError for HTTP errors and a plain 'network'/'timeout' HttpError otherwise.
async function browserAttempt(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const release = await acquire(url);
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
    return data;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (opts.signal?.aborted) throw new HttpError('aborted', 'Request cancelled.');
    if (controller.signal.aborted) throw new HttpError('timeout', 'Request timed out.');
    throw new HttpError(
      'network',
      'Network request failed (offline, or the source blocks browser access).',
    );
  } finally {
    release();
    clearTimeout(timer);
  }
}

// Browser path: memory/localStorage cache, then fetch with one retry for GET (a rate-limit 429 from a CDN often shows up as a
// CORS/network error), and a stale-cache fallback when the network is down.
async function viaBrowser(url, opts) {
  if (opts.signal?.aborted) throw new HttpError('aborted', 'Request cancelled.');
  const key = requestKey(opts.method, url, opts.body);
  if (opts.ttl > 0) {
    const hit = cache.get(key);
    if (hit) return { data: hit.value, cachedAt: hit.cachedAt, fromCache: true, stale: false };
  }
  const retriable = (e) =>
    opts.method === 'GET' &&
    (e.kind === 'network' || (e.kind === 'http' && (e.status === 429 || e.status >= 500)));
  try {
    let data;
    try {
      data = await browserAttempt(url, opts);
    } catch (error) {
      if (!(error instanceof HttpError) || !retriable(error)) throw error;
      await sleep(BROWSER_LIMITS.retryDelayMs);
      if (opts.signal?.aborted) throw new HttpError('aborted', 'Request cancelled.');
      data = await browserAttempt(url, opts);
    }
    if (opts.ttl > 0) cache.set(key, data, opts.ttl, opts.label);
    return { data, cachedAt: null, fromCache: false, stale: false };
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'network') {
      const stale = opts.ttl > 0 ? cache.get(key, { allowStale: true }) : null;
      if (stale)
        return { data: stale.value, cachedAt: stale.cachedAt, fromCache: true, stale: true };
    }
    throw error;
  }
}

// Fetches a URL and returns { data, cachedAt, fromCache, stale } so the UI can show "cached 2 days ago".
export function getJsonWithMeta(
  url,
  { method = 'GET', headers = {}, body, ttl = 0, timeoutMs = 20_000, signal, owners = [] } = {},
) {
  if (method !== 'GET' && method !== 'POST')
    throw new HttpError('blocked', 'Only GET and POST are supported.');
  const opts = {
    method,
    headers,
    body,
    ttl,
    timeoutMs,
    signal,
    owners,
    label: describeRequest(method, url, body),
  };
  const pending = isElectron() ? viaElectron(url, opts) : viaBrowser(url, opts);
  return pending.then(
    (meta) => {
      notify({ type: 'ok', ...meta });
      return meta;
    },
    (error) => {
      notify({ type: 'error', error });
      throw error;
    },
  );
}

// Convenience wrapper that returns only the data (JSON object, or text for non-JSON responses such as SVG).
export async function getJson(url, options) {
  return (await getJsonWithMeta(url, options)).data;
}

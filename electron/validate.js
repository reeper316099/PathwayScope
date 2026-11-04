// Pure request validators for the IPC layer (no Electron imports, so they are unit-testable).
import { FETCH_HOSTS, LINK_HOSTS, LIMITS, POST_ALLOWED_PREFIXES } from './allowlist.js';

// Error type carrying a short machine-readable code the renderer can show nicely.
export class RequestError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Owner ids look like gene:TP53, pathway:R-HSA-69541 or analysis:<session id>.
export const OWNER_PATTERN = /^(gene|pathway|analysis):[A-Za-z0-9._:-]{1,64}$/;

const ALLOWED_HEADERS = new Set(['accept', 'content-type']);
const ALLOWED_CONTENT_TYPES = new Set(['text/plain', 'application/json']);

// Parses and checks a URL string: https only, no credentials, default port, bounded length.
function parseHttpsUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.maxUrlLength) {
    throw new RequestError('bad-url', 'URL must be a non-empty string of reasonable length.');
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new RequestError('bad-url', 'URL could not be parsed.');
  }
  if (url.protocol !== 'https:')
    throw new RequestError('not-https', 'Only https URLs are allowed.');
  if (url.username || url.password)
    throw new RequestError('bad-url', 'Credentials in URLs are not allowed.');
  if (url.port !== '') throw new RequestError('bad-url', 'Custom ports are not allowed.');
  return url;
}

// Validates a fetch request from the renderer and returns a normalized copy (never trusts the input).
export function validateFetchRequest(rawUrl, rawOptions = {}) {
  const url = parseHttpsUrl(rawUrl);
  if (!FETCH_HOSTS.has(url.hostname)) {
    throw new RequestError('host-not-allowed', `Host not allowlisted: ${url.hostname}`);
  }
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  const method = String(options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    throw new RequestError('method-not-allowed', 'Only GET and POST are allowed.');
  }

  const headers = {};
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    const key = name.toLowerCase();
    if (!ALLOWED_HEADERS.has(key))
      throw new RequestError('header-not-allowed', `Header not allowed: ${name}`);
    if (typeof value !== 'string' || value.length > 200)
      throw new RequestError('bad-header', `Bad header value: ${name}`);
    if (
      key === 'content-type' &&
      !ALLOWED_CONTENT_TYPES.has(value.split(';')[0].trim().toLowerCase())
    ) {
      throw new RequestError('header-not-allowed', 'Content-Type not allowed.');
    }
    headers[key] = value;
  }

  let body;
  if (options.body !== undefined && options.body !== null) {
    if (method !== 'POST')
      throw new RequestError('bad-body', 'Only POST requests may have a body.');
    if (typeof options.body !== 'string')
      throw new RequestError('bad-body', 'Body must be a string.');
    if (Buffer.byteLength(options.body, 'utf8') > LIMITS.maxBodyBytes) {
      throw new RequestError('body-too-large', 'Request body is too large.');
    }
    body = options.body;
  }
  if (method === 'POST' && !POST_ALLOWED_PREFIXES.some((p) => url.href.startsWith(p))) {
    throw new RequestError('post-not-allowed', 'POST is only allowed to the Analysis Service.');
  }

  const ttl = Number(options.cacheTtlSeconds ?? 0);
  if (!Number.isFinite(ttl) || ttl < 0) throw new RequestError('bad-option', 'Bad cache TTL.');
  const defaultTimeout = url.pathname.startsWith('/AnalysisService')
    ? LIMITS.analysisTimeoutMs
    : LIMITS.defaultTimeoutMs;
  const timeout = Number(options.timeoutMs ?? defaultTimeout);
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new RequestError('bad-option', 'Bad timeout.');

  // Optional human-readable description stored next to a cached response (shown in "Manage stored data").
  const label =
    typeof options.label === 'string'
      ? [...options.label]
          .filter((c) => c >= ' ')
          .join('')
          .slice(0, 160)
      : null;
  // Which library items (genes, pathways, analyses) this response belongs to; used to group stored data on the Home page.
  const owners = [
    ...new Set(
      Array.isArray(options.owners)
        ? options.owners.filter((o) => typeof o === 'string' && OWNER_PATTERN.test(o))
        : [],
    ),
  ].slice(0, 8);
  const kind = ['gene', 'pathway', 'analysis', 'shared', 'other'].includes(options.kind)
    ? options.kind
    : 'other';

  return {
    url,
    method,
    label,
    kind,
    owners,
    headers,
    body,
    cacheTtlSeconds: Math.min(Math.floor(ttl), LIMITS.maxCacheTtlSeconds),
    timeoutMs: Math.min(timeout, LIMITS.maxTimeoutMs),
  };
}

// Returns the URL string if it is an allowlisted https link-out, otherwise throws.
export function validateExternalUrl(rawUrl) {
  const url = parseHttpsUrl(rawUrl);
  if (!LINK_HOSTS.has(url.hostname)) {
    throw new RequestError('host-not-allowed', `Link host not allowlisted: ${url.hostname}`);
  }
  return url.href;
}

// Validates a "save file" request (name, content, encoding) coming from the renderer.
export function validateSaveRequest(req) {
  if (!req || typeof req !== 'object')
    throw new RequestError('bad-save', 'Save request must be an object.');
  const { defaultName, content, encoding = 'utf8' } = req;
  if (typeof defaultName !== 'string' || !/^[\w .()-]{1,100}$/.test(defaultName)) {
    throw new RequestError('bad-save', 'Invalid file name.');
  }
  if (typeof content !== 'string') throw new RequestError('bad-save', 'Content must be a string.');
  if (encoding !== 'utf8' && encoding !== 'base64')
    throw new RequestError('bad-save', 'Invalid encoding.');
  if (content.length > LIMITS.maxSaveBytes)
    throw new RequestError('bad-save', 'File is too large.');
  return { defaultName, content, encoding };
}

// Accepts a cache entry key (64 hex characters, as produced by our own cache) or the word "all"; anything else is refused.
export function validateCacheKey(key) {
  if (key === 'all' || (typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))) return key;
  throw new RequestError('bad-key', 'Invalid cache entry key.');
}

// Accepts one owner id (see OWNER_PATTERN) or throws.
export function validateOwner(owner) {
  if (typeof owner === 'string' && OWNER_PATTERN.test(owner)) return owner;
  throw new RequestError('bad-owner', 'Invalid owner id.');
}

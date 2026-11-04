// Renderer-side cache: an in-memory Map plus best-effort localStorage persistence, all with TTLs.

// Default time-to-live values (seconds). Content data changes only at quarterly releases; analyses are shorter-lived.
export const TTL = {
  contentSeconds: 7 * 24 * 3600,
  analysisSeconds: 24 * 3600,
  versionSeconds: 24 * 3600,
};

// Returns window.localStorage if usable (it can throw in private mode or when disabled), else null.
export function safeLocalStorage() {
  try {
    const s = globalThis.localStorage;
    const probe = '__ps_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

// Turns a timestamp into "just now", "3 hours ago", "2 days ago" for the cache label.
export function ageLabel(cachedAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - cachedAt) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Creates a cache. Storage and clock are injectable so tests need no browser.
export function createCache({
  storage = safeLocalStorage(),
  prefix = 'ps:cache:',
  maxPersistChars = 400_000,
  now = Date.now,
} = {}) {
  const memory = new Map();

  // Looks an entry up (memory first, then storage); expired entries are returned only if allowStale is set.
  function get(key, { allowStale = false } = {}) {
    let entry = memory.get(key);
    if (!entry && storage) {
      try {
        const raw = storage.getItem(prefix + key);
        entry = raw ? JSON.parse(raw) : undefined;
        if (entry) memory.set(key, entry);
      } catch {
        entry = undefined;
      }
    }
    if (!entry) return null;
    const expired = now() - entry.cachedAt > entry.ttlMs;
    return expired && !allowStale
      ? null
      : { value: entry.value, cachedAt: entry.cachedAt, expired };
  }

  // Stores a value; persistence is skipped (silently) for big values or a full/blocked storage.
  function set(key, value, ttlSeconds) {
    const entry = { value, cachedAt: now(), ttlMs: ttlSeconds * 1000 };
    memory.set(key, entry);
    if (!storage) return;
    try {
      const raw = JSON.stringify(entry);
      if (raw.length <= maxPersistChars) storage.setItem(prefix + key, raw);
    } catch {
      // Quota exceeded or storage blocked: the in-memory copy is still valid.
    }
  }

  // Empties memory and every persisted entry that belongs to this cache.
  function clear() {
    memory.clear();
    if (!storage) return;
    try {
      Object.keys(storage)
        .filter((k) => k.startsWith(prefix))
        .forEach((k) => storage.removeItem(k));
    } catch {
      // Storage not enumerable: nothing more we can do.
    }
  }

  return { get, set, clear };
}

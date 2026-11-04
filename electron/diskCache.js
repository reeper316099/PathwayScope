// Persistent JSON cache in the app's userData folder (one file per request, keyed by a SHA-256 hash).
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Builds the cache key from method + URL + body hash so identical POSTs share an entry.
export function cacheKey(method, url, body = '') {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHash('sha256').update(`${method}\n${url}\n${bodyHash}`).digest('hex');
}

export class DiskCache {
  // Remembers the directory where cache files live.
  constructor(dir) {
    this.dir = dir;
  }

  // Reads an entry (even if stale; the caller decides by age) or returns null when missing/corrupt.
  async read(key) {
    try {
      const entry = JSON.parse(await fs.readFile(path.join(this.dir, `${key}.json`), 'utf8'));
      return typeof entry?.cachedAt === 'number' ? entry : null;
    } catch {
      return null;
    }
  }

  // Writes an entry atomically (temp file then rename) plus a tiny description file used by "Manage stored data".
  async write(key, entry, meta = null) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${key}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    const body = JSON.stringify(entry);
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
    const description = {
      label: meta?.label ?? null,
      kind: meta?.kind ?? 'other',
      cachedAt: entry.cachedAt,
      bytes: Buffer.byteLength(body),
    };
    await fs.writeFile(path.join(this.dir, `${key}.meta`), JSON.stringify(description));
  }

  // Lists cached entries (newest first) from the small description files, without reading the large response files.
  async list() {
    let names;
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names.filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
      const key = name.slice(0, -5);
      try {
        const meta = JSON.parse(await fs.readFile(path.join(this.dir, `${key}.meta`), 'utf8'));
        entries.push({
          key,
          label: meta.label ?? 'Cached response',
          kind: meta.kind ?? 'other',
          cachedAt: meta.cachedAt,
          bytes: meta.bytes ?? 0,
        });
      } catch {
        const stat = await fs.stat(path.join(this.dir, name)).catch(() => null);
        if (stat)
          entries.push({
            key,
            label: 'Cached response (no description)',
            kind: 'other',
            cachedAt: stat.mtimeMs,
            bytes: stat.size,
          });
      }
    }
    return entries.sort((a, b) => b.cachedAt - a.cachedAt);
  }

  // Deletes one entry (response and description); returns true if something was removed.
  async delete(key) {
    let removed = false;
    for (const ext of ['json', 'meta']) {
      try {
        await fs.rm(path.join(this.dir, `${key}.${ext}`));
        removed = true;
      } catch {
        // Already gone.
      }
    }
    return removed;
  }

  // Deletes every cached file (used by the "Clear cache" menu item) and returns how many were removed.
  async clear() {
    let removed = 0;
    try {
      for (const name of await fs.readdir(this.dir)) {
        if (name.endsWith('.json') || name.endsWith('.meta') || name.endsWith('.tmp')) {
          await fs.rm(path.join(this.dir, name), { force: true });
          if (name.endsWith('.json')) removed += 1;
        }
      }
    } catch {
      // Directory does not exist yet: nothing to clear.
    }
    return removed;
  }
}

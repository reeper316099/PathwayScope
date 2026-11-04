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

  // Writes an entry atomically (temp file then rename) so a crash never leaves half a JSON file.
  async write(key, entry) {
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${key}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry));
    await fs.rename(tmp, file);
  }

  // Deletes every cached file (used by the "Clear cache" menu item) and returns how many were removed.
  async clear() {
    let removed = 0;
    try {
      for (const name of await fs.readdir(this.dir)) {
        if (name.endsWith('.json') || name.endsWith('.tmp')) {
          await fs.rm(path.join(this.dir, name), { force: true });
          removed += 1;
        }
      }
    } catch {
      // Directory does not exist yet: nothing to clear.
    }
    return removed;
  }
}

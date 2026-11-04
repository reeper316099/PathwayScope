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

  // Reads one entry's small description file (label, kind, owners, ...), or null.
  async readMeta(key) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, `${key}.meta`), 'utf8'));
    } catch {
      return null;
    }
  }

  // Loads the set of pinned owner ids ("kept" library items) from disk.
  async pins() {
    if (!this.pinned) {
      try {
        this.pinned = new Set(
          JSON.parse(await fs.readFile(path.join(this.dir, 'pins.state'), 'utf8')),
        );
      } catch {
        this.pinned = new Set();
      }
    }
    return this.pinned;
  }

  // Pins or unpins an owner: responses owned by a pinned owner are served from the cache however old they are (a frozen snapshot).
  async setPinned(owner, pinned) {
    const set = await this.pins();
    if (pinned) set.add(owner);
    else set.delete(owner);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, 'pins.state'), JSON.stringify([...set]));
  }

  // True if any of the given owners is pinned.
  async isPinned(owners = []) {
    const set = await this.pins();
    return owners.some((o) => set.has(o));
  }

  // Adds owners to an existing entry's description (used when a cached response is reused by another item).
  async addOwners(key, owners) {
    const meta = await this.readMeta(key);
    if (!meta) return;
    const merged = [...new Set([...(meta.owners ?? []), ...owners])].slice(0, 16);
    if (merged.length === (meta.owners ?? []).length) return;
    await fs.writeFile(
      path.join(this.dir, `${key}.meta`),
      JSON.stringify({ ...meta, owners: merged }),
    );
  }

  // Removes an owner from every entry. Entries left with no owner are deleted (except "shared" ones that every lookup needs).
  // Also unpins the owner. Returns { removed, freedBytes }.
  async removeOwner(owner) {
    let removed = 0;
    let freedBytes = 0;
    let names;
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return { removed, freedBytes };
    }
    for (const name of names.filter((n) => /^[a-f0-9]{64}\.meta$/.test(n))) {
      const key = name.slice(0, -5);
      const meta = await this.readMeta(key);
      if (!meta || !(meta.owners ?? []).includes(owner)) continue;
      const left = meta.owners.filter((o) => o !== owner);
      if (left.length === 0 && meta.kind !== 'shared') {
        freedBytes += meta.bytes ?? 0;
        if (await this.delete(key)) removed += 1;
      } else {
        await fs.writeFile(path.join(this.dir, name), JSON.stringify({ ...meta, owners: left }));
      }
    }
    await this.setPinned(owner, false);
    return { removed, freedBytes };
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
    const existing = await this.readMeta(key);
    const owners = [...new Set([...(existing?.owners ?? []), ...(meta?.owners ?? [])])].slice(
      0,
      16,
    );
    const description = {
      label: meta?.label ?? null,
      kind: meta?.kind ?? 'other',
      cachedAt: entry.cachedAt,
      bytes: Buffer.byteLength(body),
      owners,
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
          owners: meta.owners ?? [],
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
            owners: [],
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

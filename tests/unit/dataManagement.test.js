// Tests for stored-data management: renderer cache list/remove, store removal, cache-key validation, disk cache list/delete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache, cacheKey } from '../../electron/diskCache.js';
import { RequestError, validateCacheKey, validateFetchRequest } from '../../electron/validate.js';
import { createCache } from '../../src/core/cache.js';
import { createStore } from '../../src/core/sessionStore.js';
import { formatBytes } from '../../src/ui/dataManager.js';

// Fake Storage (enumerable like the real one).
function fakeStorage() {
  const data = {};
  return new Proxy(
    {
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => {
        data[k] = String(v);
      },
      removeItem: (k) => {
        delete data[k];
      },
    },
    {
      ownKeys: () => Reflect.ownKeys(data),
      getOwnPropertyDescriptor: (t, k) =>
        k in data
          ? { value: data[k], enumerable: true, configurable: true }
          : Reflect.getOwnPropertyDescriptor(t, k),
    },
  );
}

describe('renderer cache list/remove', () => {
  it('lists labeled entries newest first without their values, and removes one', () => {
    let t = 1000;
    const c = createCache({ storage: fakeStorage(), now: () => t });
    c.set('a', { big: 'x'.repeat(50) }, 60, { label: 'Gene search: TP53', kind: 'gene' });
    t = 2000;
    c.set('b', 1, 60, { label: 'Reactome release information', kind: 'other' });
    const list = c.list();
    expect(list.map((e) => e.key)).toEqual(['b', 'a']);
    expect(list[1]).toMatchObject({ label: 'Gene search: TP53', kind: 'gene', cachedAt: 1000 });
    expect(list[1].bytes).toBeGreaterThan(50);
    expect(list[0]).not.toHaveProperty('value');
    c.remove('a');
    expect(c.list().map((e) => e.key)).toEqual(['b']);
    expect(c.get('a')).toBeNull();
  });
  it('lists persisted entries after a "reload" (fresh memory) and labels unlabeled ones generically', () => {
    const storage = fakeStorage();
    createCache({ storage }).set('k', 'v', 60, { label: 'X', kind: 'pathway' });
    createCache({ storage }).set('old', 'v', 60);
    const fresh = createCache({ storage }).list();
    expect(fresh.find((e) => e.key === 'k')).toMatchObject({ label: 'X', kind: 'pathway' });
    expect(fresh.find((e) => e.key === 'old')).toMatchObject({
      label: 'Cached response',
      kind: 'other',
    });
    const c = createCache({ storage });
    c.clear();
    expect(c.list()).toEqual([]);
  });
});

describe('store removal', () => {
  it('removes one history entry, clears history, and deletes all sessions with their payloads', () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    store.addHistory({ type: 'gene', key: 'TP53', label: 'Gene TP53' });
    store.addHistory({ type: 'pathway', key: 'R-HSA-1', label: 'P' });
    store.removeHistory('gene', 'TP53');
    expect(store.getHistory().map((h) => h.key)).toEqual(['R-HSA-1']);
    store.removeHistory('gene', 'nothing');
    expect(store.getHistory()).toHaveLength(1);
    store.clearHistory();
    expect(store.getHistory()).toEqual([]);
    const s = (id) => ({
      id,
      createdAt: '2026-01-01T00:00:00.000Z',
      inputIdentifiers: ['A'],
      unmappedIdentifiers: [],
      parameters: {},
      reactomeToken: null,
      rows: [],
      dataVersion: '98',
    });
    store.saveSession(s('a'));
    store.saveSession(s('b'));
    store.clearSessions();
    expect(store.listSessions()).toEqual([]);
    expect(store.getSession('a')).toBeNull();
    expect(Object.keys(storage).filter((k) => k.startsWith('ps:session:'))).toEqual([]);
  });
});

describe('cache key and label validation', () => {
  it('accepts only 64-hex keys or "all"', () => {
    expect(validateCacheKey('all')).toBe('all');
    expect(validateCacheKey(cacheKey('GET', 'https://reactome.org/x'))).toHaveLength(64);
    for (const bad of [
      '',
      '../../etc/passwd',
      'abc',
      'A'.repeat(64),
      'g'.repeat(64),
      5,
      null,
      undefined,
      `${'a'.repeat(64)}/..`,
    ]) {
      expect(() => validateCacheKey(bad)).toThrow(RequestError);
    }
  });
  it('passes a sanitised label and kind through fetch validation, and ignores bad ones', () => {
    const ok = validateFetchRequest('https://reactome.org/ContentService/data/database/info', {
      label: 'Gene\u0007 search',
      kind: 'gene',
    });
    expect(ok).toMatchObject({ label: 'Gene search', kind: 'gene' });
    const bad = validateFetchRequest('https://reactome.org/ContentService/data/database/info', {
      label: 42,
      kind: 'evil',
    });
    expect(bad).toMatchObject({ label: null, kind: 'other' });
    expect(
      validateFetchRequest('https://reactome.org/ContentService/data/database/info', {
        label: 'x'.repeat(500),
      }).label,
    ).toHaveLength(160);
  });
});

describe('DiskCache list/delete (real temp folder)', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ps-disk-'));
  it('writes a description file, lists newest first, deletes one entry, and clears all', async () => {
    const dir = tmp();
    const cache = new DiskCache(dir);
    const k1 = cacheKey('GET', 'https://reactome.org/a');
    const k2 = cacheKey('GET', 'https://reactome.org/b');
    await cache.write(
      k1,
      { cachedAt: 1000, status: 200, data: { a: 1 } },
      { label: 'Gene search: TP53', kind: 'gene' },
    );
    await cache.write(
      k2,
      { cachedAt: 2000, status: 200, data: 'x'.repeat(100) },
      { label: 'Pathway hierarchy', kind: 'pathway' },
    );
    const list = await cache.list();
    expect(list.map((e) => e.label)).toEqual(['Pathway hierarchy', 'Gene search: TP53']);
    expect(list[0].bytes).toBeGreaterThan(100);
    expect(await cache.delete(k2)).toBe(true);
    expect(await cache.delete(k2)).toBe(false);
    expect((await cache.list()).map((e) => e.key)).toEqual([k1]);
    expect(fs.readdirSync(dir).sort()).toEqual([`${k1}.json`, `${k1}.meta`].sort());
    expect(await cache.clear()).toBe(1);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it('still lists older entries that have no description file, and ignores unrelated files', async () => {
    const dir = tmp();
    const cache = new DiskCache(dir);
    const key = cacheKey('GET', 'https://reactome.org/old');
    fs.writeFileSync(
      path.join(dir, `${key}.json`),
      JSON.stringify({ cachedAt: 5, status: 200, data: 1 }),
    );
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
    fs.writeFileSync(path.join(dir, 'not-a-key.json'), '{}');
    const list = await cache.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key, label: 'Cached response (no description)' });
  });
  it('returns an empty list when the folder does not exist yet', async () => {
    expect(await new DiskCache(path.join(tmp(), 'nope')).list()).toEqual([]);
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(3_900_000)).toBe('3.9 MB');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

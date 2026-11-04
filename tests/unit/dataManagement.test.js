// Tests for stored-data management: renderer cache list/remove, store removal, cache-key validation, disk cache list/delete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiskCache, cacheKey } from '../../electron/diskCache.js';
import {
  RequestError,
  validateCacheKey,
  validateFetchRequest,
  validateOwner,
} from '../../electron/validate.js';
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

describe('owners (which library item a cached response belongs to)', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ps-own-'));
  const kA = cacheKey('GET', 'https://reactome.org/a');
  const kB = cacheKey('GET', 'https://reactome.org/b');
  const kC = cacheKey('GET', 'https://reactome.org/c');
  const entry = (n) => ({ cachedAt: n, status: 200, data: 'x'.repeat(n) });

  it('validates owner ids and filters bad owners out of fetch options', () => {
    expect(validateOwner('gene:TP53')).toBe('gene:TP53');
    expect(validateOwner('analysis:3f2a-9c')).toBe('analysis:3f2a-9c');
    for (const bad of [
      '',
      'TP53',
      'folder:x',
      'gene:',
      'gene:a b',
      '../etc',
      5,
      null,
      `gene:${'x'.repeat(70)}`,
    ]) {
      expect(() => validateOwner(bad)).toThrow(RequestError);
    }
    const req = validateFetchRequest('https://reactome.org/ContentService/data/database/info', {
      owners: ['gene:TP53', 'gene:TP53', 'bad owner', 7, 'pathway:R-HSA-1'],
    });
    expect(req.owners).toEqual(['gene:TP53', 'pathway:R-HSA-1']);
    expect(
      validateFetchRequest('https://reactome.org/ContentService/data/database/info').owners,
    ).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `gene:G${i}`);
    expect(
      validateFetchRequest('https://reactome.org/ContentService/data/database/info', {
        owners: many,
      }).owners,
    ).toHaveLength(8);
  });
  it('writes owners, merges them on re-write and lists them', async () => {
    const cache = new DiskCache(tmp());
    await cache.write(kA, entry(100), { label: 'A', kind: 'gene', owners: ['gene:TP53'] });
    await cache.write(kA, entry(120), {
      label: 'A',
      kind: 'gene',
      owners: ['gene:BRCA1', 'gene:TP53'],
    });
    await cache.addOwners(kA, ['pathway:R-HSA-1']);
    await cache.addOwners(kA, ['pathway:R-HSA-1']); // no change
    await cache.addOwners(kB, ['gene:X']); // no such entry: ignored
    const [one] = await cache.list();
    expect(one.owners).toEqual(['gene:TP53', 'gene:BRCA1', 'pathway:R-HSA-1']);
    expect(await cache.list()).toHaveLength(1);
  });
  it('removeOwner deletes data only that owner needed, keeps data others use, and never deletes shared data', async () => {
    const dir = tmp();
    const cache = new DiskCache(dir);
    await cache.write(kA, entry(100), { label: 'only TP53', kind: 'gene', owners: ['gene:TP53'] });
    await cache.write(kB, entry(200), {
      label: 'TP53 + BRCA1',
      kind: 'pathway',
      owners: ['gene:TP53', 'gene:BRCA1'],
    });
    await cache.write(kC, entry(300), {
      label: 'hierarchy',
      kind: 'shared',
      owners: ['gene:TP53', 'gene:BRCA1'],
    });
    const out = await cache.removeOwner('gene:TP53');
    expect(out.removed).toBe(1);
    expect(out.freedBytes).toBeGreaterThan(100);
    const left = await cache.list();
    expect(left.map((e) => e.label).sort()).toEqual(['TP53 + BRCA1', 'hierarchy']);
    expect(left.find((e) => e.label === 'TP53 + BRCA1').owners).toEqual(['gene:BRCA1']);
    expect(left.find((e) => e.label === 'hierarchy').owners).toEqual(['gene:BRCA1']);
    // removing the last owner deletes the pathway entry but the shared one stays (with no owners)
    expect((await cache.removeOwner('gene:BRCA1')).removed).toBe(1);
    expect((await cache.list()).map((e) => e.label)).toEqual(['hierarchy']);
    expect(
      fs.readdirSync(dir).filter((f) => f.endsWith('.json') || f.endsWith('.meta')).length,
    ).toBe(2);
    expect(await cache.removeOwner('gene:NOBODY')).toEqual({ removed: 0, freedBytes: 0 });
  });
  it('pins persist on disk, survive a new instance, are unset by removeOwner, and are not wiped by clear()', async () => {
    const dir = tmp();
    const a = new DiskCache(dir);
    expect(await a.isPinned(['gene:TP53'])).toBe(false);
    await a.setPinned('gene:TP53', true);
    await a.setPinned('gene:BRCA1', true);
    const b = new DiskCache(dir);
    expect(await b.isPinned(['gene:EGFR', 'gene:TP53'])).toBe(true);
    expect([...(await b.pins())].sort()).toEqual(['gene:BRCA1', 'gene:TP53']);
    await b.write(kA, entry(10), { kind: 'gene', owners: ['gene:TP53'] });
    await b.clear();
    expect(await new DiskCache(dir).isPinned(['gene:TP53'])).toBe(true);
    await b.removeOwner('gene:TP53');
    expect(await new DiskCache(dir).isPinned(['gene:TP53'])).toBe(false);
    await b.setPinned('gene:BRCA1', false);
    expect([...(await new DiskCache(dir).pins())]).toEqual([]);
  });
  it('tolerates a corrupt pins file', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'pins.state'), '{nope');
    expect(await new DiskCache(dir).isPinned(['gene:TP53'])).toBe(false);
  });
});

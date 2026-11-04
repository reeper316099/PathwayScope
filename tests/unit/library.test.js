// Tests for the Library model: items, aliases, nested folders, multi-folder filing, pinning, ownership/size accounting, persistence.
import { describe, expect, it } from 'vitest';
import {
  LibraryError,
  MAX_FOLDER_DEPTH,
  addToFolder,
  childFolders,
  computeUsage,
  createFolder,
  createLibraryStore,
  deleteFolder,
  emptyLibrary,
  findItemByOwner,
  folderAndDescendants,
  folderPath,
  folderUsage,
  importHistory,
  itemIdsInFolderTree,
  listContents,
  moveFolder,
  ownerId,
  ownersOf,
  parseLibrary,
  removeFromFolder,
  removeItem,
  renameFolder,
  setPinned,
  storageBreakdown,
  syncSessions,
  upsertItem,
} from '../../src/core/library.js';

const at = (n) => new Date(2026, 10, 4, 12, 0, n);
const err = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof LibraryError ? e.message : `other:${e.message}`;
  }
  return 'no-error';
};
const gene = (lib, key, extra = {}) =>
  upsertItem(lib, { type: 'gene', key, label: `Gene ${key}`, ...extra }, at(1));

describe('ownerId / items', () => {
  it('builds owner ids (gene symbols upper-cased) and upserts without duplicating', () => {
    expect(ownerId('gene', 'tp53')).toBe('gene:TP53');
    expect(ownerId('pathway', 'R-HSA-69541')).toBe('pathway:R-HSA-69541');
    const lib = emptyLibrary();
    const a = gene(lib, 'tp53');
    const b = upsertItem(lib, { type: 'gene', key: 'TP53', label: 'Gene TP53 (again)' }, at(9));
    expect(b).toBe(a);
    expect(Object.keys(lib.items)).toEqual(['gene:TP53']);
    expect(a).toMatchObject({
      label: 'Gene TP53 (again)',
      pinned: false,
      folderIds: [],
      createdAt: at(1).toISOString(),
      lastOpenedAt: at(9).toISOString(),
    });
  });
  it('resolves gene aliases to the canonical item and ignores junk aliases', () => {
    const lib = emptyLibrary();
    const item = gene(lib, 'ERBB2', { aliases: ['her2', 'HER2', 'ERBB2', 'bad alias!'] });
    expect(item.aliases).toEqual(['HER2']);
    expect(findItemByOwner(lib, 'gene:HER2')).toBe(item);
    expect(findItemByOwner(lib, 'gene:ERBB2')).toBe(item);
    expect(findItemByOwner(lib, 'gene:NOPE')).toBeUndefined();
    expect(ownersOf(item)).toEqual(['gene:ERBB2', 'gene:HER2']);
  });
  it('rejects unknown types and invalid keys', () => {
    expect(err(() => upsertItem(emptyLibrary(), { type: 'folder', key: 'x', label: 'x' }))).toBe(
      'Unknown item type.',
    );
    expect(err(() => upsertItem(emptyLibrary(), { type: 'gene', key: 'a b', label: 'x' }))).toBe(
      'Invalid item key.',
    );
  });
  it('pins, unpins and removes items', () => {
    const lib = emptyLibrary();
    const item = gene(lib, 'TP53');
    setPinned(lib, item.id, true);
    expect(lib.items[item.id].pinned).toBe(true);
    setPinned(lib, item.id, false);
    expect(lib.items[item.id].pinned).toBe(false);
    expect(err(() => setPinned(lib, 'gene:NOPE', true))).toBe('Unknown item.');
    expect(removeItem(lib, item.id)).toBe(item);
    expect(lib.items).toEqual({});
  });
});

describe('folders', () => {
  it('creates nested folders, lists children sorted, and builds paths and descendants', () => {
    const lib = emptyLibrary();
    const b = createFolder(lib, 'Beta', null, at(1));
    const a = createFolder(lib, '  Alpha  ', null, at(2));
    const c = createFolder(lib, 'Child', a.id, at(3));
    const g = createFolder(lib, 'Grandchild', c.id, at(4));
    expect(a.name).toBe('Alpha');
    expect(childFolders(lib).map((f) => f.name)).toEqual(['Alpha', 'Beta']);
    expect(childFolders(lib, a.id).map((f) => f.name)).toEqual(['Child']);
    expect(folderPath(lib, g.id).map((f) => f.name)).toEqual(['Alpha', 'Child', 'Grandchild']);
    expect(folderPath(lib, null)).toEqual([]);
    expect(new Set(folderAndDescendants(lib, a.id))).toEqual(new Set([a.id, c.id, g.id]));
    expect(folderAndDescendants(lib, b.id)).toEqual([b.id]);
  });
  it('validates names, parents, duplicates (case-insensitive) and depth', () => {
    const lib = emptyLibrary();
    const a = createFolder(lib, 'Alpha');
    expect(err(() => createFolder(lib, '   '))).toBe('Please enter a folder name.');
    expect(err(() => createFolder(lib, 'x'.repeat(61)))).toMatch(/at most 60/);
    expect(err(() => createFolder(lib, 'bad\u0007name'))).toBe(
      'That folder name has invalid characters.',
    );
    expect(err(() => createFolder(lib, 'ALPHA'))).toBe(
      'A folder with that name already exists here.',
    );
    expect(err(() => createFolder(lib, 'X', 'f-missing'))).toBe(
      'The parent folder does not exist.',
    );
    expect(createFolder(lib, 'Alpha', a.id).parentId).toBe(a.id); // same name is fine under another parent
    let parent = null;
    for (let i = 0; i < MAX_FOLDER_DEPTH; i += 1)
      parent = createFolder(lib, `level ${i}`, parent).id;
    expect(err(() => createFolder(lib, 'too deep', parent))).toMatch(/nested at most/);
  });
  it('renames folders (no sibling clashes)', () => {
    const lib = emptyLibrary();
    const a = createFolder(lib, 'Alpha');
    createFolder(lib, 'Beta');
    renameFolder(lib, a.id, 'Gamma');
    expect(lib.folders[a.id].name).toBe('Gamma');
    expect(err(() => renameFolder(lib, a.id, 'beta'))).toBe(
      'A folder with that name already exists here.',
    );
    renameFolder(lib, a.id, 'GAMMA'); // renaming to itself (different case) is allowed
    expect(err(() => renameFolder(lib, 'f-missing', 'x'))).toBe('Unknown folder.');
  });
  it('moves folders but refuses loops, clashes and exceeding the depth limit', () => {
    const lib = emptyLibrary();
    const a = createFolder(lib, 'A');
    const b = createFolder(lib, 'B', a.id);
    const c = createFolder(lib, 'C');
    moveFolder(lib, c.id, b.id);
    expect(folderPath(lib, c.id).map((f) => f.name)).toEqual(['A', 'B', 'C']);
    expect(err(() => moveFolder(lib, a.id, c.id))).toBe('A folder cannot be moved into itself.');
    expect(err(() => moveFolder(lib, a.id, a.id))).toBe('A folder cannot be moved into itself.');
    moveFolder(lib, c.id, null);
    expect(lib.folders[c.id].parentId).toBeNull();
    createFolder(lib, 'C', a.id);
    expect(err(() => moveFolder(lib, c.id, a.id))).toBe(
      'A folder with that name already exists there.',
    );
    let chain = null;
    for (let i = 0; i < MAX_FOLDER_DEPTH - 1; i += 1)
      chain = createFolder(lib, `d${i}`, chain?.id ?? null);
    const sub = createFolder(lib, 'Sub');
    createFolder(lib, 'Sub child', sub.id);
    expect(err(() => moveFolder(lib, sub.id, chain.id))).toMatch(/nested at most/);
  });
  it('deleting a folder removes it and its sub-folders but never deletes items', () => {
    const lib = emptyLibrary();
    const a = createFolder(lib, 'A');
    const b = createFolder(lib, 'B', a.id);
    const keep = createFolder(lib, 'Keep');
    const x = gene(lib, 'TP53');
    const y = gene(lib, 'BRCA1');
    addToFolder(lib, x.id, b.id);
    addToFolder(lib, x.id, keep.id);
    addToFolder(lib, y.id, a.id);
    expect(deleteFolder(lib, a.id)).toEqual({ foldersRemoved: 2, itemsAffected: 2 });
    expect(Object.keys(lib.folders)).toEqual([keep.id]);
    expect(lib.items[x.id].folderIds).toEqual([keep.id]);
    expect(lib.items[y.id].folderIds).toEqual([]);
    expect(Object.keys(lib.items)).toHaveLength(2);
  });
});

describe('filing items (several folders per item)', () => {
  it('shows unfiled items at the top level, and an item in every folder it is filed in', () => {
    const lib = emptyLibrary();
    const f1 = createFolder(lib, 'One');
    const f2 = createFolder(lib, 'Two');
    const inner = createFolder(lib, 'Inner', f1.id);
    const a = gene(lib, 'TP53');
    const b = gene(lib, 'BRCA1');
    const c = gene(lib, 'EGFR');
    addToFolder(lib, a.id, f1.id);
    addToFolder(lib, a.id, f2.id);
    addToFolder(lib, a.id, f2.id); // idempotent
    addToFolder(lib, b.id, inner.id);
    expect(lib.items[a.id].folderIds).toEqual([f1.id, f2.id]);
    expect(listContents(lib, null).items.map((i) => i.key)).toEqual(['EGFR']);
    expect(listContents(lib, null).folders.map((f) => f.name)).toEqual(['One', 'Two']);
    expect(listContents(lib, f1.id).items.map((i) => i.key)).toEqual(['TP53']);
    expect(listContents(lib, f1.id).folders.map((f) => f.name)).toEqual(['Inner']);
    expect(listContents(lib, f2.id).items.map((i) => i.key)).toEqual(['TP53']);
    expect(itemIdsInFolderTree(lib, f1.id)).toEqual(new Set([a.id, b.id]));
    removeFromFolder(lib, a.id, f1.id);
    expect(lib.items[a.id].folderIds).toEqual([f2.id]);
    expect(c.folderIds).toEqual([]);
    expect(err(() => addToFolder(lib, 'gene:NOPE', f1.id))).toBe('Unknown item.');
    expect(err(() => addToFolder(lib, a.id, 'f-missing'))).toBe('Unknown folder.');
  });
});

describe('computeUsage / folderUsage', () => {
  const setup = () => {
    const lib = emptyLibrary();
    const tp53 = gene(lib, 'TP53');
    const brca1 = gene(lib, 'BRCA1');
    const entries = [
      { key: 'k1', bytes: 100, kind: 'gene', owners: ['gene:TP53'] },
      { key: 'k2', bytes: 50, kind: 'gene', owners: ['gene:TP53'] },
      { key: 'k3', bytes: 30, kind: 'pathway', owners: ['gene:TP53', 'gene:BRCA1'] }, // used by both
      { key: 'k4', bytes: 20, kind: 'gene', owners: ['gene:BRCA1'] },
      { key: 'k5', bytes: 4000, kind: 'shared', owners: ['gene:TP53', 'gene:BRCA1'] }, // hierarchy
      { key: 'k6', bytes: 7, kind: 'gene', owners: [] }, // nobody owns it
      { key: 'k7', bytes: 9, kind: 'gene', owners: ['gene:GONE'] }, // owner no longer in the library
    ];
    return { lib, tp53, brca1, entries, usage: computeUsage(lib, entries, {}) };
  };
  it('separates own, shared-with-others, shared-by-everything and unsorted data', () => {
    const { tp53, brca1, usage } = setup();
    expect(usage.items[tp53.id]).toMatchObject({ own: 150, shared: 30, session: 0 });
    expect(usage.items[brca1.id]).toMatchObject({ own: 20, shared: 30 });
    expect(usage.shared).toMatchObject({ bytes: 4000, count: 1 });
    expect(usage.unsorted).toMatchObject({ bytes: 16, count: 2 });
    expect(usage.totalBytes).toBe(4216);
    expect(usage.itemTotal(tp53.id)).toBe(180);
  });
  it('counts a saved session in an analysis item and in totals', () => {
    const lib = emptyLibrary();
    const a = upsertItem(lib, { type: 'analysis', key: 'abc-1', label: 'Analysis' }, at(1));
    const usage = computeUsage(
      lib,
      [{ key: 'k', bytes: 10, kind: 'analysis', owners: ['analysis:abc-1'] }],
      { [a.id]: 500 },
    );
    expect(usage.items[a.id]).toMatchObject({ own: 10, session: 500 });
    expect(usage.itemTotal(a.id)).toBe(510);
    expect(usage.totalBytes).toBe(510);
  });
  it('resolves alias owners to the canonical item', () => {
    const lib = emptyLibrary();
    const erbb2 = gene(lib, 'ERBB2', { aliases: ['HER2'] });
    const usage = computeUsage(lib, [
      { key: 'k', bytes: 5, kind: 'gene', owners: ['gene:HER2', 'gene:ERBB2'] },
    ]);
    expect(usage.items[erbb2.id].own).toBe(5); // both owners are the same item: not "shared"
  });
  it('folder size counts each distinct cached response once, even when two items in it share it', () => {
    const { lib, tp53, brca1, usage } = setup();
    const f = createFolder(lib, 'Project');
    addToFolder(lib, tp53.id, f.id);
    addToFolder(lib, brca1.id, f.id);
    expect(folderUsage(lib, usage, f.id)).toEqual({ items: 2, bytes: 100 + 50 + 30 + 20 });
    const other = createFolder(lib, 'Other');
    addToFolder(lib, brca1.id, other.id);
    expect(folderUsage(lib, usage, other.id)).toEqual({ items: 1, bytes: 20 + 30 });
    expect(folderUsage(lib, usage, createFolder(lib, 'Empty').id)).toEqual({ items: 0, bytes: 0 });
  });
});

describe('storageBreakdown', () => {
  it('counts every byte once: pinned items, other items, shared data and unsorted data', () => {
    const lib = emptyLibrary();
    const tp53 = gene(lib, 'TP53');
    gene(lib, 'BRCA1');
    const a = upsertItem(lib, { type: 'analysis', key: 's1', label: 'A' }, at(1));
    setPinned(lib, tp53.id, true);
    const entries = [
      { key: 'a', bytes: 10, kind: 'gene', owners: ['gene:TP53'] },
      { key: 'b', bytes: 20, kind: 'gene', owners: ['gene:BRCA1'] },
      { key: 'c', bytes: 40, kind: 'pathway', owners: ['gene:TP53', 'gene:BRCA1'] }, // used by a pinned and an unpinned item: protected
      { key: 'd', bytes: 800, kind: 'shared', owners: ['gene:TP53'] },
      { key: 'e', bytes: 5, kind: 'gene', owners: [] },
    ];
    const out = storageBreakdown(lib, entries, { [a.id]: 1000 });
    expect(out).toEqual({
      pinned: 50,
      items: 20 + 1000,
      shared: 800,
      unsorted: 5,
      total: 10 + 20 + 40 + 800 + 5 + 1000,
    });
    expect(out.pinned + out.items + out.shared + out.unsorted).toBe(out.total);
  });
});

describe('syncSessions / importHistory', () => {
  it('creates analysis items for saved sessions and drops items whose session was deleted', () => {
    const lib = emptyLibrary();
    syncSessions(
      lib,
      [
        { id: 's1', label: '5 identifiers', createdAt: '2026-11-01T10:00:00.000Z' },
        { id: 's2', label: '9 identifiers', createdAt: '2026-11-02T10:00:00.000Z' },
      ],
      at(1),
    );
    expect(Object.keys(lib.items).sort()).toEqual(['analysis:s1', 'analysis:s2']);
    const f = createFolder(lib, 'F');
    addToFolder(lib, 'analysis:s1', f.id);
    syncSessions(
      lib,
      [{ id: 's2', label: '9 identifiers', createdAt: '2026-11-02T10:00:00.000Z' }],
      at(2),
    );
    expect(Object.keys(lib.items)).toEqual(['analysis:s2']);
    expect(lib.items['analysis:s2'].createdAt).toBe('2026-11-02T10:00:00.000Z');
    expect(lib.items['analysis:s2'].label).toBe('Analysis of 9 identifiers');
    // an existing item is never overwritten (its label, pin and last-opened time survive a sync)
    lib.items['analysis:s2'].label = 'My renamed analysis';
    lib.items['analysis:s2'].lastOpenedAt = '2026-11-03T00:00:00.000Z';
    syncSessions(lib, [
      { id: 's2', label: '9 identifiers', createdAt: '2026-11-02T10:00:00.000Z' },
    ]);
    expect(lib.items['analysis:s2']).toMatchObject({
      label: 'My renamed analysis',
      lastOpenedAt: '2026-11-03T00:00:00.000Z',
    });
  });
  it('imports genes and pathways from the old history once, without overwriting', () => {
    const lib = emptyLibrary();
    gene(lib, 'TP53');
    lib.items['gene:TP53'].pinned = true;
    importHistory(lib, [
      { type: 'gene', key: 'TP53', label: 'Gene TP53', at: '2026-11-03T00:00:00.000Z' },
      {
        type: 'pathway',
        key: 'R-HSA-69541',
        label: 'Stabilization of p53',
        at: '2026-11-02T00:00:00.000Z',
      },
      { type: 'analysis', key: 'x', label: 'Analysis', at: '2026-11-01T00:00:00.000Z' },
      { type: 'gene', key: 'bad key', label: 'x', at: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(Object.keys(lib.items).sort()).toEqual(['gene:TP53', 'pathway:R-HSA-69541']);
    expect(lib.items['gene:TP53'].pinned).toBe(true);
    const fresh = emptyLibrary();
    importHistory(fresh, [
      { type: 'gene', key: 'brca1', label: 'Gene BRCA1', at: '2026-11-03T00:00:00.000Z' },
    ]);
    expect(fresh.items['gene:BRCA1'].label).toBe('BRCA1'); // the badge already says "Gene"
  });
});

describe('persistence', () => {
  const fakeStorage = () => {
    const d = {};
    return {
      getItem: (k) => d[k] ?? null,
      setItem: (k, v) => {
        d[k] = v;
      },
      removeItem: (k) => {
        delete d[k];
      },
      d,
    };
  };
  it('round-trips folders, items, pins and filing', () => {
    const storage = fakeStorage();
    const a = createLibraryStore(storage);
    const f = createFolder(a.lib, 'Project');
    const sub = createFolder(a.lib, 'Sub', f.id);
    const item = gene(a.lib, 'TP53', { aliases: ['P53'] });
    addToFolder(a.lib, item.id, sub.id);
    setPinned(a.lib, item.id, true);
    expect(a.save()).toBe(true);
    const b = createLibraryStore(storage);
    expect(b.lib).toEqual(a.lib);
    b.clear();
    expect(b.lib).toEqual(emptyLibrary());
    expect(createLibraryStore(storage).lib).toEqual(emptyLibrary());
  });
  it('survives corrupt, wrong-version, hostile and blocked storage', () => {
    expect(parseLibrary('{nope')).toEqual(emptyLibrary());
    expect(parseLibrary(JSON.stringify({ version: 99, items: {}, folders: {} }))).toEqual(
      emptyLibrary(),
    );
    expect(parseLibrary(null)).toEqual(emptyLibrary());
    const messy = parseLibrary({
      version: 1,
      folders: {
        a: { id: 'a', name: 'A', parentId: 'missing' },
        b: { id: 'WRONG', name: 'B', parentId: null },
      },
      items: {
        'gene:TP53': {
          id: 'gene:TP53',
          type: 'gene',
          key: 'TP53',
          label: 'Gene TP53',
          folderIds: ['a', 'ghost'],
        },
        'evil:x': { id: 'evil:x', type: 'evil', label: 'x' },
        'gene:BAD KEY': { id: 'gene:BAD KEY', type: 'gene', label: 'x' },
      },
    });
    expect(Object.keys(messy.folders)).toEqual(['a']);
    expect(messy.folders.a.parentId).toBeNull(); // orphan repaired
    expect(Object.keys(messy.items)).toEqual(['gene:TP53']);
    expect(messy.items['gene:TP53'].folderIds).toEqual(['a']);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createLibraryStore(blocked);
    expect(store.lib).toEqual(emptyLibrary());
    expect(store.save()).toBe(false);
    expect(() => store.clear()).not.toThrow();
  });
});

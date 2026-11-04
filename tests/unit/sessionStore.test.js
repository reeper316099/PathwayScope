// Tests for the history/session store: caps, de-duplication, eviction on a full storage, and blocked storage.
import { describe, expect, it } from 'vitest';
import { createStore, LIMITS } from '../../src/core/sessionStore.js';

// Fake Storage with an optional total character quota.
function fakeStorage(quota = Infinity) {
  const data = new Map();
  const used = () => [...data.values()].reduce((n, v) => n + v.length, 0);
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (used() - (data.get(k)?.length ?? 0) + v.length > quota) throw new Error('quota');
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
    keys: () => [...data.keys()],
  };
}
const session = (id, extra = 0) => ({
  id,
  createdAt: '2026-11-03T10:00:00.000Z',
  inputIdentifiers: ['TP53'],
  unmappedIdentifiers: [],
  parameters: {},
  reactomeToken: null,
  rows: [],
  dataVersion: '98',
  pad: 'x'.repeat(extra),
});

describe('history', () => {
  it('lists newest first and de-duplicates by type and key', () => {
    const store = createStore(fakeStorage());
    store.addHistory({ type: 'gene', key: 'TP53', label: 'TP53' });
    store.addHistory({ type: 'gene', key: 'BRCA1', label: 'BRCA1' });
    store.addHistory({ type: 'gene', key: 'TP53', label: 'TP53' });
    expect(store.getHistory().map((h) => h.key)).toEqual(['TP53', 'BRCA1']);
  });
  it('caps the list length and can be cleared', () => {
    const store = createStore(fakeStorage());
    for (let i = 0; i < LIMITS.history + 10; i += 1)
      store.addHistory({ type: 'gene', key: `G${i}`, label: `G${i}` });
    expect(store.getHistory()).toHaveLength(LIMITS.history);
    store.clearHistory();
    expect(store.getHistory()).toEqual([]);
  });
});

describe('sessions', () => {
  it('saves, lists, loads and deletes', () => {
    const store = createStore(fakeStorage());
    expect(store.saveSession(session('a'))).toBe(true);
    store.saveSession(session('b'));
    expect(store.listSessions().map((s) => s.id)).toEqual(['b', 'a']);
    expect(store.getSession('a').id).toBe('a');
    store.deleteSession('a');
    expect(store.getSession('a')).toBeNull();
    expect(store.listSessions().map((s) => s.id)).toEqual(['b']);
  });
  it('updates an existing session in place (no duplicates)', () => {
    const store = createStore(fakeStorage());
    store.saveSession(session('a'));
    store.saveSession({ ...session('a'), dataVersion: '99' });
    expect(store.listSessions()).toHaveLength(1);
    expect(store.getSession('a').dataVersion).toBe('99');
  });
  it('keeps only the newest sessions up to the cap and removes evicted payloads', () => {
    const storage = fakeStorage();
    const store = createStore(storage);
    for (let i = 0; i < LIMITS.sessions + 3; i += 1) store.saveSession(session(`s${i}`));
    expect(store.listSessions()).toHaveLength(LIMITS.sessions);
    expect(store.getSession('s0')).toBeNull();
    expect(storage.keys().filter((k) => k.startsWith('ps:session:'))).toHaveLength(LIMITS.sessions);
  });
  it('evicts the oldest sessions when storage is full, but keeps the new one', () => {
    const store = createStore(fakeStorage(2500));
    store.saveSession(session('old1', 600));
    store.saveSession(session('old2', 600));
    expect(store.saveSession(session('new', 1200))).toBe(true);
    expect(store.getSession('new')).not.toBeNull();
    expect(store.getSession('old1')).toBeNull();
  });
  it('reports failure (no crash) when one session cannot fit at all', () => {
    expect(createStore(fakeStorage(50)).saveSession(session('big', 500))).toBe(false);
  });
  it('works (returns nothing) when storage is blocked entirely', () => {
    const store = createStore(null);
    expect(store.getHistory()).toEqual([]);
    expect(store.listSessions()).toEqual([]);
    expect(store.saveSession(session('a'))).toBe(false);
    expect(() => store.addHistory({ type: 'gene', key: 'A', label: 'A' })).not.toThrow();
  });
  it('survives corrupt JSON in storage', () => {
    const storage = fakeStorage();
    storage.setItem('ps:history', '{nope');
    storage.setItem('ps:sessions:index', 'also bad');
    const store = createStore(storage);
    expect(store.getHistory()).toEqual([]);
    expect(store.listSessions()).toEqual([]);
  });
});

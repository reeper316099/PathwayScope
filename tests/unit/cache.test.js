// Tests for the renderer cache (TTL, stale reads, persistence, failing storage) and the age label.
import { describe, expect, it } from 'vitest';
import { ageLabel, createCache } from '../../src/core/cache.js';
import { hashString, requestKey } from '../../src/core/http.js';

// Fake Storage backed by a plain object.
function fakeStorage(limit = Infinity) {
  const data = {};
  return new Proxy(
    {
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => {
        if (v.length > limit) throw new Error('quota');
        data[k] = v;
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

describe('createCache', () => {
  it('returns fresh values and hides expired ones unless allowStale', () => {
    let t = 0;
    const c = createCache({ storage: null, now: () => t });
    c.set('k', { a: 1 }, 10);
    expect(c.get('k').value).toEqual({ a: 1 });
    t = 11_000;
    expect(c.get('k')).toBeNull();
    expect(c.get('k', { allowStale: true })).toMatchObject({ value: { a: 1 }, expired: true });
  });
  it('persists to storage and reads back with a fresh in-memory layer', () => {
    const storage = fakeStorage();
    createCache({ storage }).set('k', 'v', 100);
    expect(createCache({ storage }).get('k').value).toBe('v');
  });
  it('survives a full or blocked storage', () => {
    const c = createCache({ storage: fakeStorage(5) });
    expect(() => c.set('k', 'a-long-value', 100)).not.toThrow();
    expect(c.get('k').value).toBe('a-long-value');
  });
  it('clear() empties memory and storage', () => {
    const storage = fakeStorage();
    const c = createCache({ storage });
    c.set('k', 1, 100);
    c.clear();
    expect(createCache({ storage }).get('k')).toBeNull();
  });
});

describe('ageLabel', () => {
  it('formats minutes, hours and days', () => {
    const now = 10 * 24 * 3600 * 1000;
    expect(ageLabel(now - 10_000, now)).toBe('just now');
    expect(ageLabel(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(ageLabel(now - 3 * 3600_000, now)).toBe('3 hours ago');
    expect(ageLabel(now - 3 * 24 * 3600_000, now)).toBe('3 days ago');
  });
});

describe('requestKey', () => {
  it('differs by method, URL and body', () => {
    expect(requestKey('POST', 'u', 'a')).not.toBe(requestKey('POST', 'u', 'b'));
    expect(requestKey('GET', 'u')).not.toBe(requestKey('POST', 'u'));
    expect(hashString('x')).toBe(hashString('x'));
  });
});

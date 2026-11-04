// Test helpers: load labeled real-API fixtures and stub fetch() with a URL router.
import fs from 'node:fs';
import { vi } from 'vitest';

// Loads tests/fixtures/<name>.json and returns its `data` (the real API response).
export const fixture = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')).data;

// Loads the full fixture file including its _fixture metadata label.
export const fixtureFile = (name) =>
  JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

// Builds a fetch Response-like object with JSON content.
export function jsonResponse(data, status = 200) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    ok: status < 400,
    status,
    headers: { get: () => 'application/json' },
    text: async () => text,
  };
}

// Stubs global fetch: routes is an array of [predicate(url, init), responder(url, init)]; unmatched calls fail the test.
export function stubFetch(routes) {
  const calls = [];
  const impl = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, respond] of routes) {
      if (match(String(url), init)) return respond(String(url), init);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

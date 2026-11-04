// Tests for the Analysis Service client against REAL saved responses: POST body, paging, unmapped, found genes, expiry, re-run.
import { afterEach, describe, expect, it } from 'vitest';
import { cache } from '../../src/core/http.js';
import {
  deriveBackgroundSize,
  fetchAllResults,
  fetchFoundIdentifiers,
  fetchUnmapped,
  refreshSessionIfExpired,
  runAnalysis,
  submitAnalysis,
  summarizeMapping,
  TokenExpiredError,
  toEnrichmentRow,
  DEFAULT_PARAMETERS,
  isWellFormedToken,
} from '../../src/core/reactomeAnalysis.js';
import { fixture, fixtureFile, jsonResponse, stubFetch } from '../helpers/fixtures.js';

afterEach(() => cache.clear());
const has = (text) => (url) => url.includes(text);
const result = () => fixture('analysis-result');
const TOKEN = decodeURIComponent(result().summary.token);
const routes = () => [
  [
    (u, i) => i.method === 'POST' && u.includes('/identifiers/projection'),
    () => jsonResponse(result()),
  ],
  [(u) => u.includes('/found/entities/'), () => jsonResponse(fixture('analysis-found-entities'))],
  [(u) => u.includes('/notFound'), () => jsonResponse(fixture('analysis-notfound'))],
  [(u) => u.includes('/token/'), () => jsonResponse({ ...result(), pathways: result().pathways })],
  [has('/data/database/info'), () => jsonResponse(fixture('database-info'))],
];

describe('toEnrichmentRow', () => {
  it('maps a real pathway result and computes found/total ratio ourselves', () => {
    const p = result().pathways[0];
    const row = toEnrichmentRow(p);
    expect(row).toEqual({
      stId: p.stId,
      name: p.name,
      entitiesFound: p.entities.found,
      entitiesTotal: p.entities.total,
      ratio: p.entities.found / p.entities.total,
      pValue: p.entities.pValue,
      fdr: p.entities.fdr,
      significance: 'strong',
      foundIdentifiers: null,
    });
    expect(row.ratio).not.toBe(p.entities.ratio); // Reactome's ratio is relative to the whole background, not the pathway
  });
});

describe('submitAnalysis', () => {
  it('POSTs a plain-text body with a "#" header line, one identifier per line, to the projection endpoint', async () => {
    const calls = stubFetch(routes());
    const data = await submitAnalysis(['TP53', 'BRCA1'], DEFAULT_PARAMETERS);
    expect(data.summary.token).toBeTruthy();
    const call = calls[0];
    expect(call.init.method).toBe('POST');
    expect(call.init.body).toBe('#PathwayScope\nTP53\nBRCA1');
    expect(call.init.headers['Content-Type']).toBe('text/plain');
    expect(call.url).toContain('/AnalysisService/identifiers/projection?');
    expect(call.url).toContain('interactors=false');
  });
  it('uses the non-projection endpoint and interactors flag when asked', async () => {
    const calls = stubFetch([[(u, i) => i.method === 'POST', () => jsonResponse(result())]]);
    await submitAnalysis(['TP53'], {
      ...DEFAULT_PARAMETERS,
      projectToHuman: false,
      includeInteractors: true,
    });
    expect(calls[0].url).toContain('/AnalysisService/identifiers/?');
    expect(calls[0].url).toContain('interactors=true');
  });
  it('throws if Reactome returns no token', async () => {
    stubFetch([[() => true, () => jsonResponse({ summary: {} })]]);
    await expect(submitAnalysis(['TP53'], DEFAULT_PARAMETERS)).rejects.toThrow(/token/);
  });
});

describe('fetchAllResults', () => {
  it('passes disease and size filters and maps every row', async () => {
    const calls = stubFetch(routes());
    const out = await fetchAllResults(TOKEN, {
      ...DEFAULT_PARAMETERS,
      includeDisease: false,
      minSize: 10,
      maxSize: 500,
    });
    expect(out.rows).toHaveLength(25);
    expect(calls[0].url).toContain('includeDisease=false');
    expect(calls[0].url).toContain('min=10');
    expect(calls[0].url).toContain('max=500');
    expect(calls[0].url).toContain(`/token/${encodeURIComponent(TOKEN)}?`);
  });
  it('pages until every pathway has been collected', async () => {
    const page = (n) =>
      Array.from({ length: n }, (_, i) => ({ ...result().pathways[0], stId: `R-HSA-${i + 1}` }));
    let call = 0;
    stubFetch([
      [
        () => true,
        () => jsonResponse({ pathwaysFound: 750, pathways: call++ === 0 ? page(500) : page(250) }),
      ],
    ]);
    expect((await fetchAllResults(TOKEN, DEFAULT_PARAMETERS)).rows).toHaveLength(750);
    expect(call).toBe(2);
  });
  it('turns a 404 into TokenExpiredError', async () => {
    stubFetch([[() => true, () => jsonResponse({ code: 404 }, 404)]]);
    await expect(fetchAllResults(TOKEN, DEFAULT_PARAMETERS)).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });
});

describe('unmapped and found identifiers', () => {
  it('returns the unmapped ids exactly as submitted', async () => {
    stubFetch(routes());
    expect(await fetchUnmapped(TOKEN)).toEqual(['NOTAGENE']);
  });
  it('pages through a long unmapped list', async () => {
    const make = (a, b) => Array.from({ length: b - a }, (_, i) => ({ id: `X${a + i}`, exp: [] }));
    let call = 0;
    stubFetch([[() => true, () => jsonResponse(call++ === 0 ? make(0, 500) : make(500, 620))]]);
    expect(await fetchUnmapped(TOKEN)).toHaveLength(620);
  });
  it("lists the genes found in a pathway (the user's own spelling) and maps 404 to expiry", async () => {
    stubFetch(routes());
    expect(await fetchFoundIdentifiers(TOKEN, 'R-HSA-212436')).toContain('her2');
    cache.clear();
    stubFetch([[() => true, () => jsonResponse({}, 404)]]);
    await expect(fetchFoundIdentifiers(TOKEN, 'R-HSA-212436')).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });
});

describe('runAnalysis / summarizeMapping', () => {
  it('builds a full AnalysisSession from real responses', async () => {
    stubFetch(routes());
    const ids = ['TP53', 'BRCA1', 'EGFR', 'MTOR', 'ATM', 'CHEK2', 'KRAS', 'NOTAGENE', 'her2'];
    const s = await runAnalysis(ids);
    expect(s).toMatchObject({
      inputIdentifiers: ids,
      unmappedIdentifiers: ['NOTAGENE'],
      reactomeToken: TOKEN,
      dataVersion: String(fixture('database-info').releaseNumber),
      pathwaysTested: 383,
    });
    expect(s.rows).toHaveLength(25);
    expect(s.parameters).toEqual(DEFAULT_PARAMETERS);
    expect(s.id).toBeTruthy();
    expect(Date.parse(s.createdAt)).not.toBeNaN();
    expect(summarizeMapping(s)).toEqual({
      submitted: 9,
      unmapped: 1,
      mapped: 8,
      unmappedFraction: 1 / 9,
    });
  });
  it('still works if the release info cannot be fetched (dataVersion null, never invented)', async () => {
    stubFetch([...routes().slice(0, 4), [has('/data/database/info'), () => jsonResponse({}, 500)]]);
    expect((await runAnalysis(['TP53'])).dataVersion).toBeNull();
  });
  it('derives the background size from total / Reactome ratio and returns null without data', () => {
    expect(deriveBackgroundSize({ total: 100, ratio: 0.01 })).toBe(10000);
    expect(deriveBackgroundSize({ total: 0, ratio: 0.01 })).toBeNull();
    expect(deriveBackgroundSize(null)).toBeNull();
    const sample = result().pathways[0].entities;
    expect(deriveBackgroundSize(sample)).toBeGreaterThan(10000);
  });
  it('handles a 100% unmapped list', () => {
    const s = { inputIdentifiers: ['A', 'B'], unmappedIdentifiers: ['A', 'B'] };
    expect(summarizeMapping(s)).toMatchObject({ mapped: 0, unmappedFraction: 1 });
    expect(
      summarizeMapping({ inputIdentifiers: [], unmappedIdentifiers: [] }).unmappedFraction,
    ).toBe(0);
  });
});

describe('token format', () => {
  it('recognises well-formed tokens and never sends malformed ones to Reactome', async () => {
    expect(isWellFormedToken(TOKEN)).toBe(true);
    for (const bad of ['EXPIRED-TOKEN', 'x', '', null, 'a b c d e f g h'])
      expect(isWellFormedToken(bad)).toBe(false);
    const calls = stubFetch([]);
    await expect(fetchFoundIdentifiers('EXPIRED-TOKEN', 'R-HSA-1')).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
    await expect(fetchAllResults('x', DEFAULT_PARAMETERS)).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
    expect(calls).toHaveLength(0);
  });
  it('stores rows in canonical order (FDR, then more found, then name)', async () => {
    const mk = (stId, name, fdr, found) => ({
      ...result().pathways[0],
      stId,
      name,
      entities: { ...result().pathways[0].entities, fdr, found },
    });
    stubFetch([
      [(u, i) => i.method === 'POST', () => jsonResponse({ ...result(), pathways: [] })],
      [
        (u) => u.includes('/token/'),
        () =>
          jsonResponse({
            pathwaysFound: 3,
            pathways: [
              mk('R-HSA-1', 'B', 1e-10, 5),
              mk('R-HSA-2', 'A', 1e-10, 9),
              mk('R-HSA-3', 'C', 1e-20, 1),
            ],
          }),
      ],
      [(u) => u.includes('/notFound'), () => jsonResponse([])],
      [has('/data/database/info'), () => jsonResponse(fixture('database-info'))],
    ]);
    expect((await runAnalysis(['TP53'])).rows.map((r) => r.stId)).toEqual([
      'R-HSA-3',
      'R-HSA-2',
      'R-HSA-1',
    ]);
  });
});

describe('refreshSessionIfExpired', () => {
  const stored = () => ({
    id: 'keep-me',
    createdAt: '2026-01-01T00:00:00.000Z',
    inputIdentifiers: ['TP53', 'ATM'],
    unmappedIdentifiers: [],
    parameters: DEFAULT_PARAMETERS,
    reactomeToken: 'b2xkLXRva2Vu',
    rows: [],
    dataVersion: '90',
    backgroundEntities: null,
    pathwaysTested: null,
  });
  it('keeps the session when the token is still valid', async () => {
    stubFetch([[() => true, () => jsonResponse(result())]]);
    const out = await refreshSessionIfExpired(stored());
    expect(out).toMatchObject({ rerun: false, offline: false });
  });
  it('re-runs from the stored list when the token has expired, keeping id/createdAt and flagging a release change', async () => {
    stubFetch([
      [(u) => u.includes('/token/b2xkLXRva2Vu'), () => jsonResponse({}, 404)],
      ...routes(),
    ]);
    const out = await refreshSessionIfExpired(stored());
    expect(out.rerun).toBe(true);
    expect(out.session).toMatchObject({
      id: 'keep-me',
      createdAt: '2026-01-01T00:00:00.000Z',
      reactomeToken: TOKEN,
    });
    expect(out.session.rows.length).toBeGreaterThan(0);
    expect(out.versionChanged).toBe(true); // stored 90 vs live release
  });
  it('re-runs when there is no token at all', async () => {
    stubFetch(routes());
    expect((await refreshSessionIfExpired({ ...stored(), reactomeToken: null })).rerun).toBe(true);
  });
  it('keeps the stored rows when offline instead of failing', async () => {
    stubFetch([
      [
        () => true,
        () => {
          throw new TypeError('Failed to fetch');
        },
      ],
    ]);
    const s = stored();
    expect(await refreshSessionIfExpired(s)).toEqual({
      session: s,
      rerun: false,
      offline: true,
      versionChanged: false,
    });
  });
  it('carries a data-version label on the fixtures themselves', () => {
    expect(fixtureFile('analysis-result')._fixture.reactomeRelease).toBe(98);
  });
});

// Tests for the Content Service client, run against REAL saved responses through the real HTTP adapter (fetch stubbed).
import { afterEach, describe, expect, it } from 'vitest';
import { cache } from '../../src/core/http.js';
import {
  getHierarchy,
  getInteractors,
  getLowestPathwaysForGene,
  getParticipants,
  getPathwayDetails,
  isValidSymbolInput,
  proteinNameFromDescription,
  searchGene,
  stripHtml,
} from '../../src/core/reactomeContent.js';
import { fixture, jsonResponse, stubFetch } from '../helpers/fixtures.js';

afterEach(() => cache.clear());
const has = (text) => (url) => url.includes(text);

describe('stripHtml', () => {
  it('removes tags, decodes entities and keeps line breaks', () => {
    expect(stripHtml('<span class="highlighting" >TP53</span>')).toBe('TP53');
    expect(stripHtml('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
    expect(stripHtml('one<br>two</p>three')).toBe('one\ntwo\nthree');
    expect(stripHtml('<script>alert(1)</script>x')).toBe('alert(1)x');
    expect(stripHtml(null)).toBe('');
  });
});

describe('searchGene', () => {
  it('finds TP53 from the real search response (exact match, UniProt accession, highlight HTML removed)', async () => {
    stubFetch([[has('/search/query'), () => jsonResponse(fixture('search-TP53'))]]);
    const gene = await searchGene('tp53');
    expect(gene).toMatchObject({ symbol: 'TP53', uniprotAccession: 'P04637', isAlias: false });
    expect(gene.entityStIds.length).toBeGreaterThan(0);
  });
  it('accepts an unambiguous alias (HER2 -> one accession) and marks it as an alias', async () => {
    stubFetch([[has('/search/query'), () => jsonResponse(fixture('search-HER2-alias'))]]);
    expect(await searchGene('HER2')).toMatchObject({
      symbol: 'ERBB2',
      uniprotAccession: 'P04626',
      isAlias: true,
    });
  });
  it('refuses an ambiguous alias (p53 matches many proteins, none exactly)', async () => {
    stubFetch([[has('/search/query'), () => jsonResponse(fixture('search-p53-ambiguous'))]]);
    expect(await searchGene('p53')).toBeNull();
  });
  it('returns null on HTTP 404 (Reactome says nothing matched) and for invalid input without any request', async () => {
    const calls = stubFetch([[has('/search/query'), () => jsonResponse({ code: 404 }, 404)]]);
    expect(await searchGene('NOTAGENE')).toBeNull();
    expect(await searchGene('bad input!')).toBeNull();
    expect(await searchGene('')).toBeNull();
    expect(calls).toHaveLength(1);
  });
  it('propagates real failures (not 404)', async () => {
    stubFetch([[has('/search/query'), () => jsonResponse({}, 500)]]);
    await expect(searchGene('TP53')).rejects.toMatchObject({ kind: 'http', status: 500 });
  });
  it('validates symbol input', () => {
    expect(isValidSymbolInput('HLA-A')).toBe(true);
    expect(isValidSymbolInput('a b')).toBe(false);
    expect(isValidSymbolInput('x'.repeat(31))).toBe(false);
  });
});

describe('getLowestPathwaysForGene', () => {
  it('maps the real TP53 pathway list to the Pathway shape', async () => {
    const calls = stubFetch([
      [
        has('/data/mapping/UniProt/P04637/pathways'),
        () => jsonResponse(fixture('mapping-P04637-pathways')),
      ],
    ]);
    const list = await getLowestPathwaysForGene('P04637');
    expect(list).toHaveLength(fixture('mapping-P04637-pathways').length);
    expect(list[0]).toEqual(
      expect.objectContaining({
        stId: expect.stringMatching(/^R-HSA-\d+$/),
        isLowestLevel: true,
        summary: null,
        parentStIds: [],
        childStIds: [],
      }),
    );
    expect(calls[0].url).toContain('species=9606');
  });
  it('returns [] for 404 and rejects malformed accessions', async () => {
    stubFetch([[has('/data/mapping'), () => jsonResponse({}, 404)]]);
    expect(await getLowestPathwaysForGene('P99999')).toEqual([]);
    await expect(getLowestPathwaysForGene('../x')).rejects.toThrow(RangeError);
  });
});

describe('getPathwayDetails', () => {
  it('extracts summary, sub-events and PubMed links from the real response', async () => {
    stubFetch([
      [has('/data/query/R-HSA-69541'), () => jsonResponse(fixture('pathway-R-HSA-69541'))],
    ]);
    const d = await getPathwayDetails('R-HSA-69541');
    expect(d.pathway.name).toBe('Stabilization of p53');
    expect(d.pathway.summary).toMatch(/Ser-15/);
    expect(d.pathway.summary).not.toMatch(/<[a-z]/i);
    expect(d.subEvents).toHaveLength(11);
    expect(d.references).toHaveLength(4);
    expect(d.references[0].url).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/);
    expect(d.species).toBe('Homo sapiens');
  });
  it('rejects malformed stable IDs before any request', async () => {
    const calls = stubFetch([]);
    await expect(getPathwayDetails('R-HSA-1/../../x')).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});

describe('getParticipants', () => {
  it('returns gene symbols for proteins, names for chemicals, de-duplicated', async () => {
    stubFetch([
      [
        has('/participants/R-HSA-69541/referenceEntities'),
        () => jsonResponse(fixture('participants-R-HSA-69541')),
      ],
    ]);
    const rows = await getParticipants('R-HSA-69541');
    const atm = rows.find((r) => r.symbol === 'ATM');
    expect(atm).toMatchObject({
      identifier: 'Q13315',
      type: 'Protein',
      source: 'UniProt',
      name: 'Serine-protein kinase ATM',
    });
    const chem = rows.find((r) => r.source === 'ChEBI');
    expect(chem.symbol).toBeNull();
    expect(new Set(rows.map((r) => `${r.source}:${r.identifier}`)).size).toBe(rows.length);
  });
  it('extracts protein names from UniProt description text, or null', () => {
    expect(
      proteinNameFromDescription([
        'recommendedName: Serine-protein kinase ATM ecNumber evidence="1"2.7.11.1 alternativeName: x',
      ]),
    ).toBe('Serine-protein kinase ATM');
    expect(proteinNameFromDescription(['something else'])).toBeNull();
    expect(proteinNameFromDescription(undefined)).toBeNull();
  });
});

describe('getInteractors', () => {
  it('maps the real interactors response', async () => {
    stubFetch([
      [has('/molecule/P38398/summary'), () => jsonResponse(fixture('interactors-summary-P38398'))],
      [has('/molecule/P38398/details'), () => jsonResponse(fixture('interactors-P38398'))],
    ]);
    const r = await getInteractors('P38398', { pageSize: 5 });
    expect(r.total).toBe(49); // from the summary endpoint, not the page size
    expect(r.interactors).toHaveLength(5);
    expect(r.interactors[0]).toEqual({
      accession: expect.any(String),
      symbol: expect.any(String),
      score: expect.any(Number),
      evidences: expect.any(Number),
    });
  });
  it('treats 404 as "no interactors"', async () => {
    stubFetch([[has('/interactors/'), () => jsonResponse({}, 404)]]);
    expect(await getInteractors('Q00000')).toEqual({
      accession: 'Q00000',
      total: 0,
      interactors: [],
    });
  });
});

describe('getHierarchy', () => {
  it('downloads and builds the graph from the (pruned, real) hierarchy', async () => {
    stubFetch([
      [has('/data/eventsHierarchy/9606'), () => jsonResponse(fixture('hierarchy-subset'))],
    ]);
    const h = await getHierarchy();
    expect(h.topLevelStIds).toEqual(['R-HSA-1643685']);
    expect(h.nodes.size).toBeGreaterThan(5);
  });
});

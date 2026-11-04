// Tests for the human-readable cache labels shown in "Manage stored data".
import { describe, expect, it } from 'vitest';
import { describeRequest } from '../../src/core/describe.js';

const R = 'https://reactome.org';
describe('describeRequest', () => {
  it.each([
    [
      'GET',
      `${R}/ContentService/search/query?query=TP53&species=Homo%20sapiens`,
      '',
      'Gene search: TP53',
      'gene',
    ],
    [
      'GET',
      `${R}/ContentService/data/mapping/UniProt/P04637/pathways?species=9606`,
      '',
      'Pathways of protein P04637',
      'gene',
    ],
    [
      'GET',
      `${R}/ContentService/interactors/static/molecule/P38398/summary`,
      '',
      'Interactors of protein P38398 (summary)',
      'gene',
    ],
    [
      'GET',
      `${R}/ContentService/data/query/R-HSA-69541`,
      '',
      'Pathway details: R-HSA-69541',
      'pathway',
    ],
    [
      'GET',
      `${R}/ContentService/data/participants/R-HSA-69541/referenceEntities`,
      '',
      'Pathway participants: R-HSA-69541',
      'pathway',
    ],
    [
      'GET',
      `${R}/ContentService/data/eventsHierarchy/9606`,
      '',
      'Pathway hierarchy (all human pathways)',
      'pathway',
    ],
    [
      'GET',
      `${R}/ContentService/exporter/diagram/R-HSA-69620.svg`,
      '',
      'Pathway diagram: R-HSA-69620',
      'pathway',
    ],
    [
      'GET',
      `${R}/ContentService/exporter/diagram/R-HSA-69620.svg?token=abc&resource=TOTAL`,
      '',
      'Pathway diagram: R-HSA-69620 (with analysis highlighting)',
      'pathway',
    ],
    ['GET', `${R}/ContentService/data/database/info`, '', 'Reactome release information', 'other'],
    [
      'GET',
      `${R}/AnalysisService/token/abc/found/entities/R-HSA-69620`,
      '',
      'Your genes found in pathway R-HSA-69620',
      'analysis',
    ],
    [
      'GET',
      `${R}/AnalysisService/token/abc/notFound?pageSize=500&page=1`,
      '',
      'Unmapped identifiers of an analysis',
      'analysis',
    ],
    [
      'GET',
      `${R}/AnalysisService/token/abc?pageSize=500`,
      '',
      'Enrichment analysis results',
      'analysis',
    ],
    [
      'GET',
      'https://rest.uniprot.org/uniprotkb/P04637?fields=accession',
      '',
      'Protein name: P04637',
      'gene',
    ],
    [
      'GET',
      'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=TP53%5Bgene%5D%20AND%20%22clinsig%20pathogenic%22%5BProperties%5D',
      '',
      'ClinVar record count: TP53',
      'gene',
    ],
  ])('%s %s', (method, url, body, label, kind) => {
    expect(describeRequest(method, url, body)).toEqual({ label, kind });
  });
  it('counts identifiers (not the # header line) for an analysis POST', () => {
    const body = '#PathwayScope\nTP53\nBRCA1\n\nATM';
    expect(
      describeRequest('POST', `${R}/AnalysisService/identifiers/projection?x=1`, body),
    ).toEqual({ label: 'Enrichment analysis (3 identifiers)', kind: 'analysis' });
    expect(describeRequest('POST', `${R}/AnalysisService/identifiers/`, '#h\nTP53').label).toBe(
      'Enrichment analysis (1 identifier)',
    );
  });
  it('never returns an empty label, even for unknown or invalid URLs', () => {
    expect(describeRequest('GET', 'https://reactome.org/other/thing')).toEqual({
      label: 'Cached GET response from reactome.org',
      kind: 'other',
    });
    expect(describeRequest('GET', 'not a url')).toEqual({
      label: 'Cached response',
      kind: 'other',
    });
  });
  it('strips control characters and limits the length of a label', () => {
    const { label } = describeRequest(
      'GET',
      `${R}/ContentService/search/query?query=${encodeURIComponent(`A\u0007${'x'.repeat(300)}`)}`,
    );
    expect(label).not.toContain('\u0007');
    expect(label.length).toBeLessThanOrEqual(120);
  });
});

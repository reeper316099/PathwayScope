// Tests for gene list parsing: delimiters, Excel pastes, headers, quotes, duplicates, types, limits, junk.
import { describe, expect, it } from 'vitest';
import { detectIdentifierType, MAX_IDENTIFIERS, parseGeneList } from '../../src/core/geneList.js';

const ids = (text, opts) => parseGeneList(text, opts).identifiers;

describe('delimiters', () => {
  it.each([
    ['newline', 'TP53\nBRCA1\nEGFR'],
    ['CRLF', 'TP53\r\nBRCA1\r\nEGFR'],
    ['comma', 'TP53,BRCA1,EGFR'],
    ['comma+space', 'TP53, BRCA1, EGFR'],
    ['semicolon', 'TP53;BRCA1;EGFR'],
    ['tab', 'TP53\tBRCA1\tEGFR'],
    ['space', 'TP53 BRCA1 EGFR'],
    ['mixed', 'TP53, BRCA1;\nEGFR\t'],
    ['blank lines', '\n\nTP53\n\nBRCA1\n\nEGFR\n\n'],
  ])('splits on %s', (_name, text) => {
    expect(ids(text)).toEqual(['TP53', 'BRCA1', 'EGFR']);
  });
});

describe('headers and Excel pastes', () => {
  it('removes a header row from a single column', () => {
    const r = parseGeneList('Gene\nTP53\nBRCA1');
    expect(r.identifiers).toEqual(['TP53', 'BRCA1']);
    expect(r.headerRemoved).toBe(true);
  });
  it('takes the first column of a table with a header and warns', () => {
    const r = parseGeneList('gene\tlog2FC\tpvalue\nTP53\t2.1\t0.001\nBRCA1\t-1.3\t0.02');
    expect(r.identifiers).toEqual(['TP53', 'BRCA1']);
    expect(r.warnings.join(' ')).toMatch(/Multiple columns/);
  });
  it('takes the first column of a header-less table with numeric columns', () => {
    expect(ids('TP53\t2.1\nBRCA1\t-1.3\nEGFR\t1e-3')).toEqual(['TP53', 'BRCA1', 'EGFR']);
  });
  it('does NOT treat a multi-line comma list of genes as a table', () => {
    expect(ids('TP53,BRCA1\nEGFR,MTOR')).toEqual(['TP53', 'BRCA1', 'EGFR', 'MTOR']);
  });
  it('treats "#" lines as comments/headers (Reactome header convention)', () => {
    const r = parseGeneList('#my genes\nTP53\nBRCA1');
    expect(r.identifiers).toEqual(['TP53', 'BRCA1']);
    expect(r.headerRemoved).toBe(true);
  });
  it('handles a CSV exported with header "Gene Symbol"', () => {
    expect(ids('Gene Symbol,Fold\nTP53,2\nBRCA1,3')).toEqual(['TP53', 'BRCA1']);
  });
});

describe('cleaning', () => {
  it('strips straight and curly quotes and whitespace', () => {
    expect(ids('"TP53", \'BRCA1\', “EGFR”,  `MTOR` ')).toEqual(['TP53', 'BRCA1', 'EGFR', 'MTOR']);
  });
  it('strips a leading byte-order mark', () => {
    expect(ids('﻿TP53\nBRCA1')).toEqual(['TP53', 'BRCA1']);
  });
  it('removes duplicates case-insensitively, keeps first spelling and order, and counts them', () => {
    const r = parseGeneList('TP53\nbrca1\ntp53\nEGFR\nBRCA1');
    expect(r.identifiers).toEqual(['TP53', 'brca1', 'EGFR']);
    expect(r.duplicatesRemoved).toBe(2);
  });
  it('keeps lowercase symbols as typed (Reactome maps them)', () => {
    expect(ids('tp53\nbrca1')).toEqual(['tp53', 'brca1']);
  });
  it('lists junk instead of hiding it', () => {
    const r = parseGeneList('TP53\n$$$\nBRCA1\n<script>\n!!');
    expect(r.identifiers).toEqual(['TP53', 'BRCA1']);
    expect(r.ignored).toEqual(['$$$', '<script>', '!!']);
    expect(r.warnings.join(' ')).toMatch(/Ignored 3 entries/);
  });
  it('accepts real-world symbols with dashes, dots and digits', () => {
    expect(ids('HLA-A\nMT-CO1\nC1orf112\nH3-4\nAC008080.1')).toHaveLength(5);
  });
});

describe('empty and degenerate input', () => {
  it.each([[''], ['   \n\t '], [null], [undefined], [42]])(
    'returns no identifiers for %j',
    (input) => {
      const r = parseGeneList(input);
      expect(r.identifiers).toEqual([]);
      expect(r.warnings).toContain('No identifiers found.');
    },
  );
  it('returns only-junk input as empty with a warning', () => {
    const r = parseGeneList('### \n!!!');
    expect(r.identifiers).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('identifier types', () => {
  it.each([
    ['TP53', 'symbol'],
    ['tp53', 'symbol'],
    ['HLA-A', 'symbol'],
    ['P04637', 'uniprot'],
    ['Q13315', 'uniprot'],
    ['P04637-2', 'uniprot'],
    ['A0A024R161', 'uniprot'],
    ['ENSG00000141510', 'ensembl'],
    ['ENSG00000141510.12', 'ensembl'],
    ['H2BC21', 'symbol'],
    ['H2AC6', 'symbol'],
    ['H4C3', 'symbol'],
    ['7157', 'entrez'],
    ['7SK', 'unknown'],
  ])('%s is %s', (id, type) => {
    expect(detectIdentifierType(id)).toBe(type);
  });
  it('counts types and warns on mixed lists', () => {
    const r = parseGeneList('TP53\nP38398\nENSG00000146648');
    expect(r.detectedTypes).toEqual({ symbol: 1, uniprot: 1, ensembl: 1 });
    expect(r.warnings.join(' ')).toMatch(/Mixed identifier types/);
  });
  it('does not call a pure symbol list with histone genes "mixed"', () => {
    const r = parseGeneList('TP53\nH2BC21\nH2AC6\nBRCA1');
    expect(r.detectedTypes).toEqual({ symbol: 4 });
    expect(r.warnings).toEqual([]);
  });
  it('does not warn about mixing for a pure list', () => {
    expect(parseGeneList('TP53\nBRCA1').warnings).toEqual([]);
  });
  it('warns that Entrez IDs map unreliably', () => {
    expect(parseGeneList('7157\n672').warnings.join(' ')).toMatch(/Entrez/);
  });
});

describe('size limits', () => {
  it('flags a list over the cap with a clear message', () => {
    const text = Array.from({ length: 11 }, (_, i) => `GENE${i}`).join('\n');
    const r = parseGeneList(text, { maxIdentifiers: 10 });
    expect(r.tooLarge).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/over the limit of 10/);
  });
  it('accepts exactly the cap', () => {
    const text = Array.from({ length: 10 }, (_, i) => `GENE${i}`).join('\n');
    expect(parseGeneList(text, { maxIdentifiers: 10 }).tooLarge).toBe(false);
  });
  it('handles a huge list quickly and refuses absurd input', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => `GENE${i}`).join('\n');
    const t0 = performance.now();
    const r = parseGeneList(big);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.tooLarge).toBe(true);
    expect(MAX_IDENTIFIERS).toBe(5000);
    expect(parseGeneList('A'.repeat(2_000_001)).tooLarge).toBe(true);
  });
});

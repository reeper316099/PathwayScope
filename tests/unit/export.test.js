// Tests for CSV escaping and for session save/load (round trip and rejection of malformed files).
import { describe, expect, it } from 'vitest';
import {
  csvCell,
  enrichmentToCsv,
  parseSession,
  serializeSession,
  SessionError,
  toCsv,
} from '../../src/core/export.js';

const row = (over = {}) => ({
  stId: 'R-HSA-69541',
  name: 'Stabilization of p53',
  entitiesFound: 5,
  entitiesTotal: 60,
  ratio: 5 / 60,
  pValue: 1e-6,
  fdr: 0.0005,
  significance: 'strong',
  foundIdentifiers: ['TP53', 'ATM'],
  ...over,
});
const session = (over = {}) => ({
  id: 'abc',
  createdAt: '2026-11-03T10:00:00.000Z',
  inputIdentifiers: ['TP53', 'ATM', 'NOTAGENE'],
  unmappedIdentifiers: ['NOTAGENE'],
  parameters: {
    projectToHuman: true,
    includeInteractors: false,
    includeDisease: true,
    minSize: null,
    maxSize: 500,
  },
  reactomeToken: 'TOKEN1234abc==',
  rows: [row()],
  dataVersion: '98',
  backgroundEntities: 16275,
  pathwaysTested: 383,
  ...over,
});

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line1\nline2', '"line1\nline2"'],
    ['cr\rhere', '"cr\rhere"'],
    [null, ''],
    [undefined, ''],
    [12, '12'],
    [0, '0'],
    ['', ''],
  ])('escapes %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
  it('defuses spreadsheet formulas in text but not in numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell(-2.5)).toBe('-2.5');
  });
});

describe('toCsv / enrichmentToCsv', () => {
  it('writes header + rows with CRLF line endings', () => {
    const csv = toCsv(
      [
        { header: 'a', value: (r) => r.a },
        { header: 'b', value: (r) => r.b },
      ],
      [{ a: 1, b: 'x,y' }],
    );
    expect(csv).toBe('a,b\r\n1,"x,y"\r\n');
  });
  it('exports enrichment rows with identifiers joined, and "not available" when not loaded', () => {
    const lines = enrichmentToCsv([
      row(),
      row({ stId: 'R-HSA-1', name: 'Name, with comma', foundIdentifiers: null }),
    ])
      .trim()
      .split('\r\n');
    expect(lines[0]).toContain('FDR (Benjamini-Hochberg)');
    expect(lines[1].endsWith('TP53;ATM')).toBe(true);
    expect(lines[2]).toContain('"Name, with comma"');
    expect(lines[2].endsWith('not available')).toBe(true);
  });
  it('exports a header only for no rows', () => {
    expect(enrichmentToCsv([]).trim().split('\r\n')).toHaveLength(1);
  });
});

describe('session save/load', () => {
  it('round-trips a session exactly', () => {
    const s = session();
    expect(parseSession(serializeSession(s))).toEqual(s);
  });
  it('round-trips unicode and unmapped lists', () => {
    const s = session({ inputIdentifiers: ['TP53', 'ünï'], unmappedIdentifiers: ['ünï'] });
    expect(parseSession(serializeSession(s))).toEqual(s);
  });
  it('recomputes significance from FDR rather than trusting the file', () => {
    const s = session({ rows: [row({ fdr: 0.5, significance: 'strong' })] });
    expect(parseSession(serializeSession(s)).rows[0].significance).toBe('none');
  });
  it('accepts older files without background fields (defaults to null)', () => {
    const s = session();
    delete s.backgroundEntities;
    delete s.pathwaysTested;
    const back = parseSession(serializeSession(s));
    expect(back.backgroundEntities).toBeNull();
    expect(back.pathwaysTested).toBeNull();
  });
  it.each([
    ['not json', 'hello'],
    ['empty', ''],
    ['array', '[]'],
    ['wrong format', JSON.stringify({ format: 'other', version: 1, session: {} })],
    ['wrong version', JSON.stringify({ format: 'pathwayscope-session', version: 99, session: {} })],
    ['missing session', JSON.stringify({ format: 'pathwayscope-session', version: 1 })],
  ])('rejects %s', (_n, text) => {
    expect(() => parseSession(text)).toThrow(SessionError);
  });
  it('rejects bad fields inside an otherwise valid session', () => {
    const bad = [
      session({ id: '' }),
      session({ createdAt: 'yesterday' }),
      session({ inputIdentifiers: [1, 2] }),
      session({ parameters: { projectToHuman: 'yes' } }),
      session({ reactomeToken: 5 }),
      session({ reactomeToken: 'bad-token!' }),
      session({ rows: 'x' }),
      session({ rows: [row({ stId: 'nope' })] }),
      session({ rows: [row({ fdr: NaN })] }),
      session({ rows: [row({ significance: 'huge' })] }),
      session({ rows: [row({ entitiesFound: -1 })] }),
      session({ rows: [row({ foundIdentifiers: [1] })] }),
    ];
    for (const s of bad) expect(() => parseSession(serializeSession(s))).toThrow(SessionError);
  });
  it('rejects a session with too many rows', () => {
    const rows = Array.from({ length: 20_001 }, () => row());
    expect(() => parseSession(serializeSession(session({ rows })))).toThrow(SessionError);
  });
});

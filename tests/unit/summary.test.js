// Tests for the "What this means" sentences: they must come only from the session numbers and thresholds.
import { describe, expect, it } from 'vitest';
import { buildInterpretation } from '../../src/core/summary.js';

const row = (name, fdr, found = 5, total = 50, pValue = fdr / 2) => ({
  stId: 'R-HSA-1',
  name,
  entitiesFound: found,
  entitiesTotal: total,
  ratio: found / total,
  pValue,
  fdr,
  significance: fdr < 0.001 ? 'strong' : fdr < 0.01 ? 'moderate' : fdr < 0.05 ? 'weak' : 'none',
  foundIdentifiers: null,
});
const session = (over = {}) => ({
  inputIdentifiers: ['A', 'B', 'C', 'D', 'E'],
  unmappedIdentifiers: ['E'],
  rows: [
    row('Path one', 1e-5),
    row('Path two', 0.004),
    row('Path three', 0.03),
    row('Path four', 0.4),
  ],
  pathwaysTested: 300,
  ...over,
});

describe('buildInterpretation', () => {
  it('reports mapping counts, the cutoff counts and the top pathway from the numbers', () => {
    const text = buildInterpretation(session()).join('\n');
    expect(text).toContain('4 of 5 submitted identifiers (80.0%) were mapped');
    expect(text).toContain('tested 300 pathways');
    expect(text).toContain('3 pass the FDR < 0.05 cutoff');
    expect(text).toContain('strong 1, moderate 1, weak 1');
    expect(text).toContain(
      'first pathway in the results (best FDR, ties broken by more entities found) is "Path one": 5 of its 50 entities',
    );
  });
  it('honours a different cutoff', () => {
    expect(buildInterpretation(session(), { fdrCutoff: 0.01 }).join('\n')).toContain(
      '2 pass the FDR < 0.01 cutoff',
    );
  });
  it('warns when more than 20% is unmapped', () => {
    const s = session({ unmappedIdentifiers: ['D', 'E'] });
    expect(buildInterpretation(s).join('\n')).toMatch(
      /More than 20% of the list could not be mapped/,
    );
    expect(buildInterpretation(session()).join('\n')).not.toMatch(/More than 20%/);
  });
  it('mentions the precision floor only when pathways sit at it', () => {
    expect(buildInterpretation(session()).join('\n')).not.toMatch(/precision floor/);
    expect(
      buildInterpretation(session({ rows: [row('Floor', 1e-16, 5, 50, 1e-16)] })).join('\n'),
    ).toMatch(/1 pathways sit at .* precision floor/);
  });
  it('handles no rows and 100% unmapped without inventing results', () => {
    const text = buildInterpretation({
      inputIdentifiers: ['A'],
      unmappedIdentifiers: ['A'],
      rows: [],
      pathwaysTested: 0,
    }).join('\n');
    expect(text).toContain('0 of 1 submitted identifiers (0.0%)');
    expect(text).toContain('no pathways with at least one matching entity');
    expect(text).not.toContain('first pathway');
  });
  it('always ends with the thresholds and the hypothesis-generating reminder', () => {
    const lines = buildInterpretation(session());
    expect(lines.at(-2)).toContain('strong FDR < 0.001, moderate FDR < 0.01, weak FDR < 0.05');
    expect(lines.at(-1)).toContain('hypothesis-generating, not proof');
  });
  it('says nothing about biology (no function/disease claims)', () => {
    expect(buildInterpretation(session()).join(' ')).not.toMatch(
      /cancer|disease|causes|drives|function/i,
    );
  });
});

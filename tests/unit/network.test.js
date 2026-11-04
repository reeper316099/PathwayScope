// Tests for the gene<->pathway graph: top-N limiting, node/edge counts, de-duplication, shared genes, missing gene lists.
import { describe, expect, it } from 'vitest';
import { buildNetwork } from '../../src/core/network.js';
import { toEnrichmentRow } from '../../src/core/reactomeAnalysis.js';
import { fixture } from '../helpers/fixtures.js';

// Builds a row; `genes` null means "found list not loaded yet".
const row = (stId, name, fdr, genes, found = genes?.length ?? 1) => ({
  stId,
  name,
  entitiesFound: found,
  entitiesTotal: 100,
  ratio: found / 100,
  pValue: fdr / 2,
  fdr,
  significance: 'strong',
  foundIdentifiers: genes,
});
// SYNTHETIC rows (test-only) so exact counts are easy to reason about.
const rows = () => [
  row('R-HSA-1', 'Path A', 1e-8, ['TP53', 'ATM', 'BRCA1']),
  row('R-HSA-2', 'Path B', 1e-6, ['TP53', 'CHEK2']),
  row('R-HSA-3', 'Path C', 1e-4, ['EGFR']),
  row('R-HSA-4', 'Path D', 1e-2, ['MTOR']),
];

describe('buildNetwork', () => {
  it('limits to the top N pathways by FDR and counts nodes/edges', () => {
    const net = buildNetwork(rows(), { topN: 2 });
    expect(net.stats).toEqual({ pathwayNodes: 2, geneNodes: 4, edges: 5, sharedGenes: 1 });
    expect(
      net.elements.nodes.filter((n) => n.data.type === 'pathway').map((n) => n.data.stId),
    ).toEqual(['R-HSA-1', 'R-HSA-2']);
  });
  it('flags genes shared by several pathways and records their degree', () => {
    const tp53 = buildNetwork(rows(), { topN: 2 }).elements.nodes.find(
      (n) => n.data.label === 'TP53',
    );
    expect(tp53.data).toMatchObject({ degree: 2, shared: true });
  });
  it('is independent of input order and tie-breaks deterministically', () => {
    const shuffled = [...rows()].reverse();
    expect(buildNetwork(shuffled, { topN: 3 }).elements.nodes.map((n) => n.data.id)).toEqual(
      buildNetwork(rows(), { topN: 3 }).elements.nodes.map((n) => n.data.id),
    );
    const ties = [row('R-HSA-5', 'Zeta', 0.001, ['A1']), row('R-HSA-6', 'Alpha', 0.001, ['B1'])];
    expect(buildNetwork(ties, { topN: 1 }).elements.nodes[0].data.label).toBe('Alpha');
  });
  it('de-duplicates repeated genes (case-insensitively) and repeated edges', () => {
    const net = buildNetwork([row('R-HSA-1', 'P', 1e-5, ['TP53', 'tp53', 'TP53', 'ATM'])]);
    expect(net.stats).toMatchObject({ geneNodes: 2, edges: 2 });
    expect(new Set(net.elements.edges.map((e) => e.data.id)).size).toBe(2);
  });
  it('reports pathways whose found genes are not loaded instead of guessing', () => {
    const net = buildNetwork([row('R-HSA-1', 'P', 1e-5, null), row('R-HSA-2', 'Q', 1e-4, ['ATM'])]);
    expect(net.pathwaysWithoutGenes).toEqual(['R-HSA-1']);
    expect(net.stats.pathwayNodes).toBe(2);
    expect(net.stats.geneNodes).toBe(1);
  });
  it('every edge connects existing nodes', () => {
    const net = buildNetwork(rows());
    const ids = new Set(net.elements.nodes.map((n) => n.data.id));
    for (const e of net.elements.edges) {
      expect(ids.has(e.data.source)).toBe(true);
      expect(ids.has(e.data.target)).toBe(true);
    }
  });
  it('builds a text-table fallback sorted by pathway count', () => {
    const table = buildNetwork(rows(), { topN: 2 }).table;
    expect(table[0]).toEqual({ gene: 'TP53', pathwayCount: 2, pathways: ['Path A', 'Path B'] });
    expect(table).toHaveLength(4);
  });
  it('handles empty input and topN 0', () => {
    expect(buildNetwork([]).stats).toEqual({
      pathwayNodes: 0,
      geneNodes: 0,
      edges: 0,
      sharedGenes: 0,
    });
    expect(buildNetwork(rows(), { topN: 0 }).elements.nodes).toEqual([]);
  });
  it('works on a real Reactome result with real found genes', () => {
    const data = fixture('analysis-result');
    const found = fixture('analysis-found-entities').identifiers.map((i) => i.id);
    const real = data.pathways.map(toEnrichmentRow);
    real[0].foundIdentifiers = found;
    const net = buildNetwork(real, { topN: 5 });
    expect(net.stats.pathwayNodes).toBe(5);
    expect(net.stats.geneNodes).toBe(found.length);
    expect(net.pathwaysWithoutGenes).toHaveLength(4);
  });
});

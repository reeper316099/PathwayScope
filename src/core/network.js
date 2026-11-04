// Builds the gene <-> pathway bipartite graph (Cytoscape element format) plus a text-table fallback.
import { compareRows, negLog10 } from './stats.js';

export const DEFAULT_TOP_N = 10;

// Builds graph data from the top N pathways. Rows whose found-gene list is not loaded yet are reported, never guessed.
export function buildNetwork(rows, { topN = DEFAULT_TOP_N } = {}) {
  const top = [...rows].sort(compareRows).slice(0, Math.max(0, topN));
  const pathwayNodes = [];
  const geneMap = new Map(); // upper-cased id -> { id, label, pathways:Set }
  const edgeKeys = new Set();
  const edges = [];
  const pathwaysWithoutGenes = [];

  for (const row of top) {
    pathwayNodes.push({
      data: {
        id: `pw:${row.stId}`,
        stId: row.stId,
        label: row.name,
        type: 'pathway',
        significance: row.significance,
        weight: negLog10(row.fdr) ?? 0,
      },
    });
    if (!row.foundIdentifiers) {
      pathwaysWithoutGenes.push(row.stId);
      continue;
    }
    for (const gene of row.foundIdentifiers) {
      const key = gene.toUpperCase();
      if (!geneMap.has(key)) geneMap.set(key, { id: gene, pathways: new Set() });
      geneMap.get(key).pathways.add(row.stId);
      const edgeKey = `${key}|${row.stId}`;
      if (edgeKeys.has(edgeKey)) continue; // de-duplicate repeated genes within one pathway
      edgeKeys.add(edgeKey);
      edges.push({ data: { id: `e:${edgeKey}`, source: `gene:${key}`, target: `pw:${row.stId}` } });
    }
  }

  const geneNodes = [...geneMap.entries()].map(([key, g]) => ({
    data: {
      id: `gene:${key}`,
      label: g.id,
      type: 'gene',
      degree: g.pathways.size,
      shared: g.pathways.size > 1,
    },
  }));
  const nameById = new Map(top.map((r) => [r.stId, r.name]));
  const table = [...geneMap.values()]
    .map((g) => ({
      gene: g.id,
      pathwayCount: g.pathways.size,
      pathways: [...g.pathways].map((id) => nameById.get(id)),
    }))
    .sort((a, b) => b.pathwayCount - a.pathwayCount || a.gene.localeCompare(b.gene));

  return {
    elements: { nodes: [...pathwayNodes, ...geneNodes], edges },
    table,
    pathwaysWithoutGenes,
    stats: {
      pathwayNodes: pathwayNodes.length,
      geneNodes: geneNodes.length,
      edges: edges.length,
      sharedGenes: geneNodes.filter((g) => g.data.shared).length,
    },
  };
}

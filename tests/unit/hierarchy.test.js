// Tests for the pathway hierarchy: real (pruned) Reactome subset for multi-parent behaviour, tiny synthetic trees for edge cases.
import { describe, expect, it } from 'vitest';
import {
  buildHierarchy,
  expandToMatches,
  flattenVisible,
  getAncestors,
  getDescendants,
  getPathsToTop,
  getTopLevelAncestors,
  searchByName,
} from '../../src/core/hierarchy.js';
import { fixture, fixtureFile } from '../helpers/fixtures.js';

const MULTI = fixtureFile('hierarchy-subset')._fixture.multiParentStId;
const real = () => buildHierarchy(fixture('hierarchy-subset'));

// SYNTHETIC tree (test-only): T -> A -> C, T -> B -> C (C has two parents), A has one reaction child.
const n = (stId, name, type = 'Pathway', children) => ({
  stId,
  name,
  type,
  diagram: false,
  ...(children ? { children } : {}),
});
const synthetic = () =>
  buildHierarchy([
    n('R-HSA-1', 'Top', 'TopLevelPathway', [
      n('R-HSA-2', 'Alpha signaling', 'Pathway', [
        n('R-HSA-4', 'Shared child', 'Pathway', [n('R-HSA-9', 'Rxn', 'Reaction')]),
        n('R-HSA-8', 'A reaction', 'Reaction'),
      ]),
      n('R-HSA-3', 'Beta signaling', 'Pathway', [
        n('R-HSA-4', 'Shared child', 'Pathway', [n('R-HSA-9', 'Rxn', 'Reaction')]),
      ]),
    ]),
  ]);

describe('buildHierarchy (real Reactome subset)', () => {
  it('merges a multi-parent pathway into ONE node with two parents', () => {
    const h = real();
    const node = h.nodes.get(MULTI);
    expect(node.name).toBe('Defective ABCD4 causes MAHCJ');
    expect(node.parentStIds).toHaveLength(2);
    expect(h.topLevelStIds).toEqual(['R-HSA-1643685']);
  });
  it('excludes reactions from the pathway graph', () => {
    const h = real();
    expect(
      [...h.nodes.values()].every((x) =>
        ['TopLevelPathway', 'Pathway', 'CellLineagePath'].includes(x.type),
      ),
    ).toBe(true);
    expect(h.nodes.has('R-HSA-5683325')).toBe(false);
  });
  it('finds both ancestor chains up to the single top-level pathway', () => {
    const h = real();
    const names = [...getAncestors(h, MULTI)].map((id) => h.nodes.get(id).name).sort();
    expect(names).toEqual(
      [
        'ABC transporter disorders',
        'Defects in cobalamin (B12) metabolism',
        'Defects in vitamin and cofactor metabolism',
        'Disease',
        'Disorders of transmembrane transporters',
        'Diseases of metabolism',
      ].sort(),
    );
    expect(getPathsToTop(h, MULTI)).toHaveLength(2);
    expect(getTopLevelAncestors(h, MULTI)).toEqual(['R-HSA-1643685']);
  });
});

describe('buildHierarchy (synthetic edge cases)', () => {
  it('keeps top-level pathways and children in the order Reactome gives them', () => {
    const h = buildHierarchy([
      n('R-HSA-1', 'First', 'TopLevelPathway', [n('R-HSA-4', 'c1'), n('R-HSA-5', 'c2')]),
      n('R-HSA-2', 'Second', 'TopLevelPathway'),
      n('R-HSA-3', 'Third', 'TopLevelPathway'),
    ]);
    expect(h.topLevelStIds).toEqual(['R-HSA-1', 'R-HSA-2', 'R-HSA-3']);
    expect(h.nodes.get('R-HSA-1').childStIds).toEqual(['R-HSA-4', 'R-HSA-5']);
  });
  it('links parents and children and marks leaves as lowest-level (structural: no sub-pathways)', () => {
    const h = synthetic();
    expect(h.nodes.get('R-HSA-4').parentStIds.sort()).toEqual(['R-HSA-2', 'R-HSA-3']);
    expect(h.nodes.get('R-HSA-2').childStIds).toEqual(['R-HSA-4']);
    expect(h.nodes.get('R-HSA-4').isLowestLevel).toBe(true);
    expect(h.nodes.get('R-HSA-2').isLowestLevel).toBe(false);
  });
  it('does not duplicate edges when a node is seen twice', () => {
    const h = synthetic();
    expect(h.nodes.get('R-HSA-4').parentStIds).toHaveLength(2);
    expect(h.nodes.size).toBe(4);
  });
  it('survives a pathological cycle without hanging', () => {
    const h = buildHierarchy([
      n('R-HSA-1', 'A', 'TopLevelPathway', [
        n('R-HSA-2', 'B', 'Pathway', [n('R-HSA-1', 'A', 'Pathway')]),
      ]),
    ]);
    expect(getAncestors(h, 'R-HSA-1').has('R-HSA-2')).toBe(true);
    expect(getPathsToTop(h, 'R-HSA-2').length).toBeLessThanOrEqual(20);
    expect(flattenVisible(h, new Set(['R-HSA-1', 'R-HSA-2'])).length).toBeLessThan(10);
  });
  it('handles empty input', () => {
    const h = buildHierarchy([]);
    expect(h.nodes.size).toBe(0);
    expect(searchByName(h, 'x')).toEqual([]);
  });
  it('survives a very deep chain (no recursion overflow)', () => {
    let node = n('R-HSA-100000', 'leaf');
    for (let i = 99999; i >= 1; i -= 1)
      node = n(`R-HSA-${i}`, `p${i}`, i === 1 ? 'TopLevelPathway' : 'Pathway', [node]);
    expect(buildHierarchy([node]).nodes.size).toBe(100000);
  });
});

describe('ancestors / descendants', () => {
  it('returns all ancestors and descendants, excluding the node itself', () => {
    const h = synthetic();
    expect([...getAncestors(h, 'R-HSA-4')].sort()).toEqual(['R-HSA-1', 'R-HSA-2', 'R-HSA-3']);
    expect([...getDescendants(h, 'R-HSA-1')].sort()).toEqual(['R-HSA-2', 'R-HSA-3', 'R-HSA-4']);
    expect(getAncestors(h, 'R-HSA-1').size).toBe(0);
    expect(getDescendants(h, 'R-HSA-4').size).toBe(0);
  });
  it('gives breadcrumb paths for a multi-parent pathway', () => {
    const paths = getPathsToTop(synthetic(), 'R-HSA-4');
    expect(paths).toHaveLength(2);
    expect(paths).toContainEqual(['R-HSA-1', 'R-HSA-2', 'R-HSA-4']);
    expect(paths).toContainEqual(['R-HSA-1', 'R-HSA-3', 'R-HSA-4']);
  });
  it('returns [] for unknown ids', () => {
    const h = synthetic();
    expect(getPathsToTop(h, 'R-HSA-999')).toEqual([]);
    expect(getTopLevelAncestors(h, 'R-HSA-999')).toEqual([]);
    expect(getTopLevelAncestors(h, 'R-HSA-1')).toEqual(['R-HSA-1']);
  });
});

describe('searchByName', () => {
  it('matches case-insensitively, requires every word, and ranks prefix matches first', () => {
    const h = synthetic();
    expect(searchByName(h, 'SIGNALING').map((x) => x.name)).toEqual([
      'Alpha signaling',
      'Beta signaling',
    ]);
    expect(searchByName(h, 'beta sig').map((x) => x.name)).toEqual(['Beta signaling']);
    expect(searchByName(h, 'zzz')).toEqual([]);
    expect(searchByName(h, '   ')).toEqual([]);
    expect(searchByName(h, 'a', { limit: 1 })).toHaveLength(1);
  });
  it('searches the real subset', () => {
    expect(searchByName(real(), 'cobalamin').map((x) => x.name)).toContain(
      'Defects in cobalamin (B12) metabolism',
    );
  });
});

describe('expandToMatches / flattenVisible', () => {
  it('expands all ancestors of every match', () => {
    const h = synthetic();
    expect([...expandToMatches(h, ['R-HSA-4'])].sort()).toEqual(['R-HSA-1', 'R-HSA-2', 'R-HSA-3']);
  });
  it('shows only top-level rows when collapsed', () => {
    expect(flattenVisible(synthetic(), new Set()).map((r) => r.stId)).toEqual(['R-HSA-1']);
  });
  it('lists a multi-parent pathway under each expanded parent with unique row keys', () => {
    const rows = flattenVisible(synthetic(), new Set(['R-HSA-1', 'R-HSA-2', 'R-HSA-3']));
    expect(rows.filter((r) => r.stId === 'R-HSA-4')).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.find((r) => r.stId === 'R-HSA-2')).toMatchObject({
      depth: 1,
      hasChildren: true,
      expanded: true,
    });
  });
  it('filters to an allowed set (show only enriched) while keeping the path to it', () => {
    const rows = flattenVisible(synthetic(), new Set(['R-HSA-1', 'R-HSA-2', 'R-HSA-3']), {
      onlyStIds: new Set(['R-HSA-3']),
    });
    expect(rows.map((r) => r.stId)).toEqual(['R-HSA-1', 'R-HSA-3']);
  });
});

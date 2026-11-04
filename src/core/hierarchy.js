// Pathway hierarchy: builds a graph from Reactome's nested eventsHierarchy, then ancestors, descendants, search, tree rows.

// Event types that are pathways (everything else, such as Reaction, is not shown in the pathway tree).
const PATHWAY_TYPES = new Set(['TopLevelPathway', 'Pathway', 'CellLineagePath']);
const MAX_PATHS = 20; // Safety cap on the number of root-to-node paths returned for one pathway.

// Builds the hierarchy. Pathways with several parents become ONE node with several parents (a DAG, not a tree).
export function buildHierarchy(rawTopLevel) {
  const nodes = new Map();
  const topLevelStIds = [];

  // Creates (or returns) the node for a stId; isLowestLevel here means "no sub-pathways" (structural definition).
  const ensure = (raw) => {
    if (!nodes.has(raw.stId)) {
      nodes.set(raw.stId, {
        stId: raw.stId,
        name: raw.name,
        summary: null,
        isLowestLevel: true,
        hasDiagram: raw.diagram === true,
        size: Number.isFinite(raw.totalEntity) ? raw.totalEntity : null,
        parentStIds: [],
        childStIds: [],
        type: raw.type,
      });
    }
    return nodes.get(raw.stId);
  };
  // Walks the nested JSON, linking each pathway to its pathway children (iterative to survive very deep trees).
  const stack = rawTopLevel
    .filter((n) => PATHWAY_TYPES.has(n.type))
    .map((raw) => ({ raw, parent: null }))
    .reverse(); // the stack pops from the end, so reverse to keep Reactome's top-level order
  const expanded = new Set();
  while (stack.length) {
    const { raw, parent } = stack.pop();
    const node = ensure(raw);
    if (parent) {
      if (!node.parentStIds.includes(parent.stId)) node.parentStIds.push(parent.stId);
      if (!parent.childStIds.includes(node.stId)) parent.childStIds.push(node.stId);
      parent.isLowestLevel = false;
    } else if (!topLevelStIds.includes(node.stId)) {
      topLevelStIds.push(node.stId);
    }
    if (expanded.has(raw.stId)) continue; // The same pathway reappears under other parents with identical children.
    expanded.add(raw.stId);
    const kids = (raw.children ?? []).filter((c) => PATHWAY_TYPES.has(c.type));
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ raw: kids[i], parent: node });
  }
  return { nodes, topLevelStIds };
}

// Looks up a pathway by stId (or undefined).
export const getNode = (h, stId) => h.nodes.get(stId);

// Collects everything reachable from a start node by following `key` ('parentStIds' or 'childStIds'), cycle-safe.
function reach(h, stId, key) {
  const seen = new Set();
  const queue = [...(h.nodes.get(stId)?.[key] ?? [])];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || id === stId) continue;
    seen.add(id);
    queue.push(...(h.nodes.get(id)?.[key] ?? []));
  }
  return seen;
}

// All ancestors of a pathway (every parent, grandparent, ... up to the top level).
export const getAncestors = (h, stId) => reach(h, stId, 'parentStIds');

// All descendant pathways of a pathway.
export const getDescendants = (h, stId) => reach(h, stId, 'childStIds');

// Every path from a top-level pathway down to this one (a multi-parent pathway has several), for breadcrumbs.
export function getPathsToTop(h, stId, maxPaths = MAX_PATHS) {
  const paths = [];
  const walk = (id, trail, visiting) => {
    if (paths.length >= maxPaths) return;
    const node = h.nodes.get(id);
    if (!node) return;
    const here = [id, ...trail];
    if (node.parentStIds.length === 0) {
      paths.push(here);
      return;
    }
    for (const parent of node.parentStIds) {
      if (!visiting.has(parent)) walk(parent, here, new Set([...visiting, parent]));
    }
  };
  walk(stId, [], new Set([stId]));
  return paths;
}

// The top-level pathways a pathway belongs to (more than one if it has several parents; itself if it is top-level).
export function getTopLevelAncestors(h, stId) {
  if (!h.nodes.has(stId)) return [];
  if (h.topLevelStIds.includes(stId) && getAncestors(h, stId).size === 0) return [stId];
  return [...getAncestors(h, stId)].filter((id) => h.topLevelStIds.includes(id));
}

// Searches pathway names (case-insensitive; every word must match); best matches first, then alphabetical.
export function searchByName(h, query, { limit = 50 } = {}) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored = [];
  for (const node of h.nodes.values()) {
    const name = node.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;
    const rank =
      name === words.join(' ')
        ? 0
        : name.startsWith(words[0])
          ? 1
          : name.split(/\W+/).includes(words[0])
            ? 2
            : 3;
    scored.push({ node, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.node.name.localeCompare(b.node.name));
  return scored.slice(0, limit).map((s) => s.node);
}

// Ids to expand so that every match is visible in the tree (all ancestors of every match).
export function expandToMatches(h, matchStIds) {
  const open = new Set();
  for (const id of matchStIds) getAncestors(h, id).forEach((a) => open.add(a));
  return open;
}

// Flattens the tree into display rows honoring the expanded set; a multi-parent pathway appears under each parent.
export function flattenVisible(
  h,
  expanded,
  { rootStIds = h.topLevelStIds, onlyStIds = null } = {},
) {
  const rows = [];
  // Whether a node (or any descendant) is in the allowed set, used by the "show only enriched" filter.
  const keepMemo = new Map();
  const keeps = (id) => {
    if (!onlyStIds) return true;
    if (keepMemo.has(id)) return keepMemo.get(id);
    keepMemo.set(id, false);
    const ok = onlyStIds.has(id) || h.nodes.get(id).childStIds.some(keeps);
    keepMemo.set(id, ok);
    return ok;
  };
  const visit = (id, depth, pathKey, trail) => {
    const node = h.nodes.get(id);
    if (!node || trail.has(id) || !keeps(id)) return;
    const visibleKids = node.childStIds.filter(keeps);
    const key = `${pathKey}/${id}`;
    const isOpen = expanded.has(id);
    rows.push({
      key,
      stId: id,
      name: node.name,
      depth,
      hasChildren: visibleKids.length > 0,
      expanded: isOpen && visibleKids.length > 0,
    });
    if (isOpen)
      visibleKids.forEach((child) => visit(child, depth + 1, key, new Set([...trail, id])));
  };
  rootStIds.forEach((id) => visit(id, 0, '', new Set()));
  return rows;
}

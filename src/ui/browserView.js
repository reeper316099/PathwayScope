// Mode C: Pathway Browser = hierarchy tree on the left, pathway detail (summary, participants, references, diagram) on the right.
import { emptyState, errorState, skeleton } from './cards.js';
import { h, setChildren } from './dom.js';
import { createPathwayDetail } from './pathwayDetail.js';
import { createPathwayTree } from './pathwayTree.js';
import { onSelection } from './selection.js';
import { getHierarchyOnce, on, state } from './state.js';

// Creates the browser view inside `root`. ctx: { openPathway(stId) }.
export function createBrowserView(root, ctx) {
  const treeBox = h('div', { class: 'card tree-card' }, skeleton(8));
  const detailBox = h(
    'div',
    { class: 'card detail-card' },
    emptyState('Select a pathway in the tree to see its details.'),
  );
  root.append(
    h('h1', {}, 'Pathway Browser'),
    h('div', { class: 'browser-grid' }, treeBox, detailBox),
  );
  let tree = null;
  let detail = null;
  let loaded = false;

  // Loads the hierarchy and builds the tree (retryable).
  async function load() {
    setChildren(treeBox, skeleton(8));
    try {
      const hierarchy = await getHierarchyOnce();
      setChildren(treeBox);
      tree = createPathwayTree(treeBox, { onSelect: ctx.openPathway });
      tree.setHierarchy(hierarchy);
      tree.setSession(state.session);
      loaded = true;
    } catch (error) {
      setChildren(treeBox, errorState(error, load));
    }
  }

  on('session', (session) => tree?.setSession(session));

  // Shows a pathway in the tree and the detail panel.
  function openInView(stId) {
    tree?.setSelected(stId);
    if (!detail) {
      setChildren(detailBox);
      detail = createPathwayDetail(detailBox, {
        onOpenPathway: ctx.openPathway,
        getOwners: ctx.contextOwners,
      });
    }
    detail.show(stId);
  }
  onSelection((sel) => {
    if (sel?.type === 'pathway' && !root.hidden) openInView(sel.id);
  });

  return {
    // Called whenever the view is shown; `stId` (optional) opens a pathway.
    show(stId) {
      const open = (id) => (ctx.currentPathway() === id ? openInView(id) : ctx.openPathway(id));
      if (!loaded)
        load().then(() => (stId || ctx.currentPathway()) && open(stId || ctx.currentPathway()));
      else if (stId) open(stId);
    },
  };
}

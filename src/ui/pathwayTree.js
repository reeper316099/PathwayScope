// Pathway tree (WAI-ARIA tree pattern): expand/collapse, search-as-you-type, keyboard navigation, enrichment dots.
import { expandToMatches, flattenVisible, getPathsToTop, searchByName } from '../core/hierarchy.js';
import { formatPValue } from '../core/stats.js';
import { SIG_GLYPH } from './badges.js';
import { debounce, h, setChildren } from './dom.js';

const MAX_ROWS = 2500; // Render cap so a fully expanded tree cannot freeze the page.

// Creates the tree inside `root`. callbacks: { onSelect(stId) }. Returns { setHierarchy, setSession, setSelected }.
export function createPathwayTree(root, { onSelect }) {
  const state = {
    hierarchy: null,
    expanded: new Set(),
    query: '',
    onlyEnriched: false,
    enrichedRows: new Map(),
    selected: null,
    focusKey: null,
  };
  const search = h('input', {
    type: 'search',
    placeholder: 'Search pathways…',
    'aria-label': 'Search the pathway tree',
  });
  const onlyBox = h('input', { type: 'checkbox', id: 'only-enriched' });
  const onlyLabel = h(
    'label',
    { for: 'only-enriched', hidden: true },
    onlyBox,
    ' Show only enriched pathways',
  );
  const info = h('p', { class: 'muted small', role: 'status' });
  const tree = h('div', {
    class: 'tree',
    role: 'tree',
    'aria-label': 'Reactome human pathway hierarchy',
  });
  root.append(h('div', { class: 'toolbar' }, search, onlyLabel), info, tree);

  // Ids that match the search text (empty set means no search).
  const matchIds = () =>
    state.query.trim().length >= 2
      ? new Set(searchByName(state.hierarchy, state.query, { limit: 300 }).map((n) => n.stId))
      : null;

  // Redraws the visible rows.
  function render() {
    if (!state.hierarchy) return;
    const matches = matchIds();
    let only = null;
    let expanded = state.expanded;
    if (matches) {
      only = matches;
      expanded = new Set([...expanded, ...expandToMatches(state.hierarchy, matches)]);
    }
    if (state.onlyEnriched) {
      const enriched = new Set(
        [...state.enrichedRows.keys()].filter((id) => state.hierarchy.nodes.has(id)),
      );
      only = only ? new Set([...only].filter((id) => enriched.has(id))) : enriched;
      expanded = new Set([...expanded, ...expandToMatches(state.hierarchy, only)]);
    }
    const rows = flattenVisible(state.hierarchy, expanded, { onlyStIds: only });
    const capped = rows.slice(0, MAX_ROWS);
    if (!capped.some((r) => r.key === state.focusKey)) state.focusKey = capped[0]?.key ?? null;
    info.textContent = matches
      ? `${matches.size} pathway${matches.size === 1 ? '' : 's'} match${matches.size === 1 ? 'es' : ''} "${state.query}".${rows.length > MAX_ROWS ? ` Showing the first ${MAX_ROWS} rows.` : ''}`
      : state.onlyEnriched
        ? `${only.size} enriched pathways.`
        : `${state.hierarchy.nodes.size.toLocaleString('en-US')} pathways. Use the arrow keys to move, → to expand, ← to collapse.`;
    setChildren(
      tree,
      capped.length === 0
        ? h('p', { class: 'muted' }, 'No pathways to show.')
        : capped.map((r) => {
            const enriched = state.enrichedRows.get(r.stId);
            const selected = state.selected === r.stId;
            return h(
              'div',
              {
                class: `tree-row${selected ? ' selected' : ''}`,
                role: 'treeitem',
                'aria-level': String(r.depth + 1),
                'aria-selected': String(selected),
                'aria-expanded': r.hasChildren ? String(r.expanded) : false,
                tabindex: r.key === state.focusKey ? '0' : '-1',
                dataset: { key: r.key, stid: r.stId },
                style: { paddingLeft: `${r.depth * 18 + 6}px` },
                onclick: () => {
                  state.focusKey = r.key;
                  onSelect(r.stId);
                },
              },
              r.hasChildren
                ? h(
                    'button',
                    {
                      class: 'twisty',
                      type: 'button',
                      tabindex: '-1',
                      'aria-label': r.expanded ? 'Collapse' : 'Expand',
                      onclick: (e) => {
                        e.stopPropagation();
                        toggle(r.stId);
                      },
                    },
                    r.expanded ? '▾' : '▸',
                  )
                : h('span', { class: 'twisty spacer' }),
              h('span', { class: 'tree-name' }, r.name),
              enriched &&
                h(
                  'span',
                  {
                    class: `dot sig-${enriched.significance}`,
                    title: `Enriched in your analysis: FDR ${formatPValue(enriched.fdr)} (${enriched.significance})`,
                    'aria-label': `enriched, ${enriched.significance}`,
                  },
                  SIG_GLYPH[enriched.significance],
                ),
            );
          }),
    );
  }

  // Expands or collapses one pathway.
  function toggle(stId, open) {
    const want = open ?? !state.expanded.has(stId);
    if (want) state.expanded.add(stId);
    else state.expanded.delete(stId);
    render();
    focusRow(state.focusKey);
  }

  // Moves keyboard focus to a row by key.
  function focusRow(key) {
    state.focusKey = key;
    tree
      .querySelectorAll('.tree-row')
      .forEach((el) => el.setAttribute('tabindex', el.dataset.key === key ? '0' : '-1'));
    tree.querySelector(`.tree-row[data-key="${CSS.escape(key ?? '')}"]`)?.focus();
  }

  // Keyboard navigation per the WAI-ARIA tree pattern.
  tree.addEventListener('keydown', (event) => {
    const rows = [...tree.querySelectorAll('.tree-row')];
    const i = rows.findIndex((el) => el.dataset.key === state.focusKey);
    if (i < 0) return;
    const el = rows[i];
    const stId = el.dataset.stid;
    const expandable = el.hasAttribute('aria-expanded');
    const open = el.getAttribute('aria-expanded') === 'true';
    const move = (j) => {
      event.preventDefault();
      if (rows[j]) focusRow(rows[j].dataset.key);
    };
    if (event.key === 'ArrowDown') move(i + 1);
    else if (event.key === 'ArrowUp') move(i - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(rows.length - 1);
    else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (expandable && !open) toggle(stId, true);
      else if (open) move(i + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (expandable && open) toggle(stId, false);
      else {
        const level = Number(el.getAttribute('aria-level'));
        for (let j = i - 1; j >= 0; j -= 1)
          if (Number(rows[j].getAttribute('aria-level')) < level) return move(j);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(stId);
    }
    return undefined;
  });

  search.addEventListener(
    'input',
    debounce(() => {
      state.query = search.value;
      render();
    }, 150),
  );
  onlyBox.addEventListener('change', () => {
    state.onlyEnriched = onlyBox.checked;
    render();
  });

  return {
    // Provides the hierarchy and draws the (collapsed) tree.
    setHierarchy(hierarchy) {
      state.hierarchy = hierarchy;
      render();
    },
    // Supplies the active analysis rows (or null) so enriched pathways get dots and the "only enriched" toggle appears.
    setSession(session) {
      state.enrichedRows = new Map(
        (session?.rows ?? []).filter((r) => r.fdr < 0.05).map((r) => [r.stId, r]),
      );
      onlyLabel.hidden = !session;
      if (!session) {
        state.onlyEnriched = false;
        onlyBox.checked = false;
      }
      render();
    },
    // Selects a pathway: expands its first path, redraws and scrolls it into view.
    setSelected(stId) {
      state.selected = stId;
      if (state.hierarchy?.nodes.has(stId)) {
        const path = getPathsToTop(state.hierarchy, stId)[0] ?? [];
        path.slice(0, -1).forEach((id) => state.expanded.add(id));
        state.focusKey = null;
      }
      render();
      const el = tree.querySelector(`.tree-row[data-stid="${CSS.escape(stId ?? '')}"]`);
      if (el) {
        state.focusKey = el.dataset.key;
        el.setAttribute('tabindex', '0');
        el.scrollIntoView({ block: 'nearest' });
      }
    },
  };
}

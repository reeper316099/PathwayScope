// Results table: sortable, filterable, paginated; selection-synced; shows BOTH raw p-value and FDR with clear labels.
import {
  FDR_LABEL,
  PVALUE_LABEL,
  compareRows,
  formatFoundTotal,
  formatPValue,
} from '../core/stats.js';
import { sigBadge, sigLegend } from './badges.js';
import { debounce, externalLink, h, setChildren } from './dom.js';
import { links } from '../core/links.js';

const PAGE_SIZE = 25;
const COLUMNS = [
  { key: 'name', label: 'Pathway', sortBy: (r) => r.name.toLowerCase() },
  { key: 'found', label: 'Entities found / total', sortBy: (r) => r.entitiesFound },
  { key: 'ratio', label: 'Ratio (found ÷ total)', sortBy: (r) => r.ratio },
  { key: 'pValue', label: PVALUE_LABEL, sortBy: (r) => r.pValue },
  { key: 'fdr', label: FDR_LABEL, sortBy: (r) => r.fdr },
  { key: 'significance', label: 'Significance', sortBy: (r) => r.fdr },
];

// Creates the table inside `root`. callbacks: { onSelect(stId) }. Returns { setRows, setSelected, setGene, rowsShown }.
export function createEnrichmentTable(root, { onSelect }) {
  const state = {
    rows: [],
    cutoff: 0.05,
    filter: '',
    sort: { key: 'fdr', dir: 'asc' },
    page: 0,
    selected: null,
    gene: null,
  };
  const filterInput = h('input', {
    type: 'search',
    placeholder: 'Filter by pathway name…',
    'aria-label': 'Filter results by pathway name',
    oninput: debounce((e) => {
      state.filter = e.target.value;
      state.page = 0;
      render();
    }, 120),
  });
  const info = h('p', { class: 'muted', role: 'status' });
  const head = h('thead');
  const body = h('tbody');
  const pager = h('div', { class: 'pager' });
  root.append(
    h('div', { class: 'toolbar' }, filterInput),
    sigLegend(),
    info,
    h(
      'div',
      { class: 'table-wrap' },
      h('table', { class: 'data', 'aria-label': 'Enrichment results' }, head, body),
    ),
    pager,
  );

  // Rows after the FDR cutoff and name filter, sorted.
  const visibleRows = () => {
    const needle = state.filter.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === state.sort.key);
    const list = state.rows.filter(
      (r) => r.fdr < state.cutoff && (!needle || r.name.toLowerCase().includes(needle)),
    );
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      // FDR order uses the shared canonical comparison so the table, chart and network agree on ties.
      if (col.key === 'fdr' || col.key === 'significance') return dir * compareRows(a, b);
      const x = col.sortBy(a);
      const y = col.sortBy(b);
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return dir * c || a.name.localeCompare(b.name);
    });
    return list;
  };

  // Redraws header, rows and pager.
  function render() {
    const list = visibleRows();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages - 1);
    const slice = list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
    setChildren(
      info,
      `Showing ${slice.length} of ${list.length} pathways (${state.rows.length - list.length} of ${state.rows.length} hidden by the FDR < ${state.cutoff} cutoff or the name filter). Both columns below are shown: the raw p-value is NOT corrected for testing many pathways; the FDR is.`,
    );
    setChildren(
      head,
      h(
        'tr',
        {},
        COLUMNS.map((c) =>
          h(
            'th',
            {
              scope: 'col',
              'aria-sort':
                state.sort.key === c.key
                  ? state.sort.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none',
            },
            h(
              'button',
              {
                class: 'sort-btn',
                type: 'button',
                onclick: () => {
                  state.sort = {
                    key: c.key,
                    dir: state.sort.key === c.key && state.sort.dir === 'asc' ? 'desc' : 'asc',
                  };
                  render();
                },
              },
              c.label,
              ' ',
              h(
                'span',
                { 'aria-hidden': 'true' },
                state.sort.key === c.key ? (state.sort.dir === 'asc' ? '▲' : '▼') : '',
              ),
            ),
          ),
        ),
      ),
    );
    setChildren(
      body,
      slice.length === 0
        ? h(
            'tr',
            {},
            h(
              'td',
              { colspan: String(COLUMNS.length), class: 'muted' },
              'No pathways pass the current filters.',
            ),
          )
        : slice.map((r) => {
            const hasGene =
              state.gene &&
              r.foundIdentifiers?.some((g) => g.toUpperCase() === state.gene.toUpperCase());
            return h(
              'tr',
              {
                tabindex: '0',
                'aria-selected': String(state.selected === r.stId),
                class: `${state.selected === r.stId ? 'selected' : ''}${hasGene ? ' has-gene' : ''}`,
                dataset: { stid: r.stId },
                onclick: () => onSelect(r.stId),
                onkeydown: (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(r.stId);
                  }
                },
              },
              h(
                'td',
                {},
                r.name,
                ' ',
                externalLink(links.reactomePathway(r.stId), r.stId, {
                  class: 'muted small',
                  onclick: (e) => e.stopPropagation(),
                }),
                hasGene && h('div', { class: 'gene-flag' }, `★ contains ${state.gene}`),
              ),
              h('td', { class: 'num' }, formatFoundTotal(r.entitiesFound, r.entitiesTotal)),
              h('td', { class: 'num' }, r.ratio.toFixed(3)),
              h('td', { class: 'num', title: String(r.pValue) }, formatPValue(r.pValue)),
              h('td', { class: 'num', title: String(r.fdr) }, formatPValue(r.fdr)),
              h('td', {}, sigBadge(r.significance)),
            );
          }),
    );
    setChildren(
      pager,
      h(
        'button',
        {
          class: 'btn secondary',
          type: 'button',
          disabled: state.page === 0,
          onclick: () => {
            state.page -= 1;
            render();
          },
        },
        '‹ Previous',
      ),
      h('span', { class: 'muted' }, ` Page ${state.page + 1} of ${pages} `),
      h(
        'button',
        {
          class: 'btn secondary',
          type: 'button',
          disabled: state.page >= pages - 1,
          onclick: () => {
            state.page += 1;
            render();
          },
        },
        'Next ›',
      ),
    );
  }

  return {
    // Replaces the rows and the FDR display cutoff.
    setRows(rows, cutoff) {
      state.rows = rows;
      state.cutoff = cutoff;
      state.page = 0;
      render();
    },
    // Changes only the cutoff.
    setCutoff(cutoff) {
      state.cutoff = cutoff;
      render();
    },
    // Highlights a pathway row and jumps to its page.
    setSelected(stId) {
      state.selected = stId;
      const index = visibleRows().findIndex((r) => r.stId === stId);
      if (index >= 0) state.page = Math.floor(index / PAGE_SIZE);
      render();
      body.querySelector('tr.selected')?.scrollIntoView({ block: 'nearest' });
    },
    // Marks rows whose found genes include the selected gene.
    setGene(gene) {
      state.gene = gene;
      render();
    },
    visibleRows,
  };
}

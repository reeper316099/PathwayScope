// Mode A: Gene Explorer. Search a human gene, see its Reactome pathways grouped by top-level category, with hierarchy context.
import { getPathsToTop, getTopLevelAncestors } from '../core/hierarchy.js';
import {
  getLowestPathwaysForGene,
  isValidSymbolInput,
  searchGene,
} from '../core/reactomeContent.js';
import { HttpError } from '../core/http.js';
import { emptyState, errorState, skeleton, warningNote } from './cards.js';
import { debounce, h, setChildren } from './dom.js';
import { createGeneCard } from './geneCard.js';
import { ownerId } from '../core/library.js';
import { onSelection, select } from './selection.js';
import { getHierarchyOnce, emit, store, touchLibrary } from './state.js';

const EXAMPLES = ['TP53', 'BRCA1', 'EGFR', 'MTOR'];

// Creates the Gene Explorer view inside `root`. ctx: { openPathway(stId), navigateGene(symbol) }.
export function createGeneExplorer(root, ctx) {
  const input = h('input', {
    id: 'gene-input',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: 'Human gene symbol, e.g. TP53',
    'aria-describedby': 'gene-hint',
    maxlength: '30',
  });
  const form = h(
    'form',
    {
      class: 'inline-form',
      onsubmit: (e) => {
        e.preventDefault();
        ctx.navigateGene(input.value.trim());
      },
    },
    h('label', { class: 'visually-hidden', for: 'gene-input' }, 'Gene symbol'),
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Explore'),
  );
  const chips = h(
    'ul',
    { class: 'chips', 'aria-label': 'Example genes' },
    EXAMPLES.map((g) =>
      h(
        'li',
        {},
        h('button', { class: 'chip', type: 'button', onclick: () => ctx.navigateGene(g) }, g),
      ),
    ),
  );
  const result = h('div', { class: 'explorer-result' });
  root.append(
    h('h1', {}, 'Gene Explorer'),
    h(
      'div',
      { class: 'card' },
      form,
      h(
        'p',
        { id: 'gene-hint', class: 'muted' },
        'Human genes only. Aliases such as HER2 are resolved by Reactome when unambiguous. Examples:',
      ),
      chips,
    ),
    result,
  );

  let controller = null;
  let currentOwners = []; // owner ids of the gene being shown (pathway lookups opened from it are tagged with them too)
  let current = null; // { gene, pathways, hierarchy, filter, sort, selected }

  // Builds the list of pathway groups for the current filter/sort settings.
  const groupPathways = () => {
    const { pathways, hierarchy, filter, sort } = current;
    const needle = filter.trim().toLowerCase();
    const shown = pathways.filter((p) => !needle || p.name.toLowerCase().includes(needle));
    const groups = new Map();
    for (const p of shown) {
      const tops = hierarchy ? getTopLevelAncestors(hierarchy, p.stId) : [];
      const names = tops.length
        ? tops.map((id) => hierarchy.nodes.get(id).name)
        : ['Uncategorized'];
      for (const name of names) groups.set(name, [...(groups.get(name) ?? []), p]);
    }
    const size = (p) => hierarchy?.nodes.get(p.stId)?.size ?? -1;
    const cmp =
      sort === 'size'
        ? (a, b) => size(b) - size(a) || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name);
    return {
      shown,
      groups: [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, list]) => [name, [...list].sort(cmp)]),
    };
  };

  const listBox = h('div', { class: 'pathway-groups' });
  const crumbBox = h('div', {
    class: 'crumbs card',
    hidden: true,
    'aria-label': 'Where this pathway sits in the hierarchy',
  });
  const countEl = h('p', { class: 'muted', role: 'status' });

  // Redraws the grouped pathway list.
  const renderList = () => {
    const { shown, groups } = groupPathways();
    const { hierarchy, pathways } = current;
    setChildren(
      countEl,
      `${shown.length} of ${pathways.length} pathways${groups.length ? ` in ${groups.length} categor${groups.length === 1 ? 'y' : 'ies'}` : ''}. ● marks Reactome "lowest-level" pathways (the most specific ones).`,
    );
    if (shown.length === 0)
      return setChildren(listBox, emptyState('No pathway matches that filter.'));
    setChildren(
      listBox,
      groups.map(([name, list]) =>
        h(
          'details',
          {
            class: 'group',
            // categories the user opened stay open when the list redraws (for example after clicking a pathway)
            open: groups.length <= 3 || current.openGroups.has(name) || undefined,
            ontoggle: (e) => {
              if (e.target.open) current.openGroups.add(name);
              else current.openGroups.delete(name);
            },
          },
          h('summary', {}, `${name} (${list.length})`),
          h(
            'ul',
            { class: 'pathway-list' },
            list.map((p) => {
              const node = hierarchy?.nodes.get(p.stId);
              return h(
                'li',
                {},
                h(
                  'button',
                  {
                    class: `pathway-item${current.selected === p.stId ? ' selected' : ''}`,
                    type: 'button',
                    'aria-pressed': String(current.selected === p.stId),
                    dataset: { stid: p.stId },
                    onclick: () => ctx.openPathway(p.stId),
                  },
                  p.isLowestLevel &&
                    h(
                      'span',
                      {
                        class: 'dot',
                        title: 'Lowest-level pathway (Reactome definition)',
                        'aria-label': 'lowest-level',
                      },
                      '●',
                    ),
                  ' ',
                  p.name,
                  ' ',
                  h(
                    'span',
                    { class: 'muted' },
                    `${p.stId}${node?.size != null ? ` · ${node.size} entities` : ''}${p.hasDiagram ? ' · diagram' : ''}`,
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  };

  // Shows the breadcrumb(s) from the top-level category down to the selected pathway.
  const renderCrumbs = () => {
    const { hierarchy, selected } = current;
    if (!selected || !hierarchy) return void (crumbBox.hidden = true);
    const paths = getPathsToTop(hierarchy, selected);
    crumbBox.hidden = paths.length === 0;
    setChildren(
      crumbBox,
      h(
        'h3',
        {},
        paths.length > 1 ? `Hierarchy context (${paths.length} paths)` : 'Hierarchy context',
      ),
      paths.slice(0, 4).map((path) =>
        h(
          'ol',
          { class: 'breadcrumb' },
          path.map((id) =>
            h(
              'li',
              {},
              h(
                'button',
                { class: 'link-btn', type: 'button', onclick: () => ctx.openPathway(id) },
                hierarchy.nodes.get(id).name,
              ),
            ),
          ),
        ),
      ),
    );
  };

  // Loads everything for a gene symbol (cancels any earlier load).
  async function load(symbol) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    current = null;
    input.value = symbol;
    if (!isValidSymbolInput(symbol))
      return setChildren(
        result,
        emptyState('Please enter a gene symbol (letters, digits, . _ - only).'),
      );
    setChildren(result, skeleton(5));
    try {
      let owners = [ownerId('gene', symbol)]; // tags every cached response of this lookup so Home can group them
      const gene = await searchGene(symbol, { signal, owners });
      if (signal.aborted) return;
      if (!gene)
        return setChildren(
          result,
          emptyState(
            `No human gene named "${symbol}" was found in Reactome. Reactome only knows genes whose proteins appear in a pathway.`,
          ),
        );
      owners = [...new Set([ownerId('gene', gene.symbol), ...owners])];
      touchLibrary({
        type: 'gene',
        key: gene.symbol,
        label: gene.symbol,
        aliases: gene.symbol.toUpperCase() === symbol.toUpperCase() ? [] : [symbol],
      });
      currentOwners = [ownerId('gene', gene.symbol)];
      store.addHistory({ type: 'gene', key: gene.symbol, label: `Gene ${gene.symbol}` });
      emit('history-changed');
      const [pathways, hierarchy] = await Promise.all([
        getLowestPathwaysForGene(gene.uniprotAccession, { signal, owners }),
        getHierarchyOnce().catch(() => null),
      ]);
      if (signal.aborted) return;
      current = {
        gene,
        pathways,
        hierarchy,
        filter: '',
        sort: 'name',
        selected: null,
        openGroups: new Set(),
      };
      const filterInput = h('input', {
        type: 'search',
        placeholder: 'Filter pathways…',
        'aria-label': 'Filter pathways by name',
        oninput: debounce((e) => {
          current.filter = e.target.value;
          renderList();
        }, 120),
      });
      const sortSel = h(
        'select',
        {
          'aria-label': 'Sort pathways',
          onchange: (e) => {
            current.sort = e.target.value;
            renderList();
          },
        },
        h('option', { value: 'name' }, 'Sort: name'),
        h('option', { value: 'size' }, 'Sort: pathway size'),
      );
      setChildren(
        result,
        createGeneCard(gene, { signal, owners, onOpenGene: ctx.navigateGene }),
        h(
          'section',
          { class: 'card', 'aria-label': 'Pathways' },
          h('h2', {}, `Pathways containing ${gene.symbol}`),
          !hierarchy &&
            warningNote(
              'The pathway hierarchy could not be loaded, so pathways are not grouped into categories.',
            ),
          pathways.length === 0
            ? emptyState(`Reactome lists no pathways for ${gene.symbol}.`)
            : [h('div', { class: 'toolbar' }, filterInput, sortSel), countEl, crumbBox, listBox],
        ),
      );
      if (pathways.length) renderList();
    } catch (error) {
      if (signal.aborted || (error instanceof HttpError && error.kind === 'aborted')) return;
      setChildren(
        result,
        errorState(error, () => load(symbol)),
      );
    }
  }

  onSelection((sel) => {
    if (!current || sel?.type !== 'pathway') return;
    current.selected = sel.id;
    renderList();
    renderCrumbs();
  });

  return {
    owners: () => currentOwners,
    show: (symbol) => (symbol && symbol !== current?.gene.symbol ? load(symbol) : undefined),
    focus: () => input.focus(),
    select,
  };
}

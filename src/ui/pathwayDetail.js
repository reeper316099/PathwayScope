// Pathway detail panel: name, link out, hierarchy breadcrumbs, summary, sub-pathways, participants (your genes highlighted), references, diagram.
import { getPathsToTop } from '../core/hierarchy.js';
import { links } from '../core/links.js';
import { getParticipants, getPathwayDetails } from '../core/reactomeContent.js';
import { formatFoundTotal, formatPValue } from '../core/stats.js';
import { sigBadge } from './badges.js';
import { emptyState, errorState, friendlyError, skeleton, warningNote } from './cards.js';
import { createDiagramView } from './diagramView.js';
import { debounce, externalLink, h, setChildren } from './dom.js';
import { ownerId } from '../core/library.js';
import {
  emit,
  getHierarchyOnce,
  loadFound,
  state,
  store,
  touchLibrary,
  userIdentifierSet,
} from './state.js';

const PARTICIPANT_PAGE = 100;

// Creates a detail panel inside `root`. callbacks: { onOpenPathway(stId) }. Returns { show(stId), clear() }.
export function createPathwayDetail(root, { onOpenPathway, getOwners = () => [] }) {
  let controller = null;
  let currentId = null;
  let diagramRef = null;

  // Draws the participants table; rows whose protein matched your analysis get a star and a highlight.
  function participantsTable(rows, highlightUniprot, highlightSymbols, hasSession) {
    const filter = h('input', {
      type: 'search',
      placeholder: 'Filter participants…',
      'aria-label': 'Filter participants',
    });
    const out = h('div', { class: 'table-wrap' });
    let limit = PARTICIPANT_PAGE;
    const matched = (r) =>
      hasSession &&
      ((r.identifier && highlightUniprot.has(r.identifier)) ||
        (r.symbol && highlightSymbols.has(r.symbol.toUpperCase())));
    const draw = () => {
      const needle = filter.value.trim().toLowerCase();
      const list = rows.filter(
        (r) =>
          !needle ||
          [r.symbol, r.identifier, r.name].some((v) => v?.toLowerCase().includes(needle)),
      );
      const shown = list.slice(0, limit);
      setChildren(
        out,
        h(
          'table',
          { class: 'data', 'aria-label': 'Pathway participants' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ['Gene symbol', 'Identifier', 'Name', 'Type', hasSession ? 'In your list' : null]
                .filter(Boolean)
                .map((t) => h('th', { scope: 'col' }, t)),
            ),
          ),
          h(
            'tbody',
            {},
            shown.map((r) =>
              h(
                'tr',
                { class: matched(r) ? 'has-gene' : '' },
                h('td', {}, r.symbol ?? '—'),
                h('td', {}, r.identifier ?? 'not available'),
                h('td', {}, r.name ?? 'not available'),
                h('td', {}, r.type),
                hasSession && h('td', {}, matched(r) ? '★ yes' : ''),
              ),
            ),
          ),
        ),
        list.length > shown.length &&
          h(
            'button',
            {
              class: 'btn secondary',
              type: 'button',
              onclick: () => {
                limit += PARTICIPANT_PAGE;
                draw();
              },
            },
            `Show more (${list.length - shown.length} hidden)`,
          ),
        h(
          'p',
          { class: 'muted small' },
          `${list.length} of ${rows.length} participants. Proteins are listed by gene symbol; small molecules by name.`,
        ),
      );
    };
    filter.addEventListener(
      'input',
      debounce(() => {
        limit = PARTICIPANT_PAGE;
        draw();
      }, 120),
    );
    draw();
    return h('div', {}, filter, out);
  }

  // Loads and shows everything for a pathway; each section loads and fails independently.
  async function show(stId) {
    controller?.abort();
    diagramRef?.clear();
    controller = new AbortController();
    const { signal } = controller;
    currentId = stId;
    // Everything fetched for this pathway belongs to the pathway item and to whatever the user was working in (a gene or an analysis).
    const owners = [...new Set([ownerId('pathway', stId), ...getOwners()])];
    const header = h('div', { class: 'detail-head' });
    const summaryBox = h('div', { class: 'section' }, skeleton(3));
    const subBox = h('div', { class: 'section' });
    const partBox = h('div', { class: 'section' }, h('h3', {}, 'Participants'), skeleton(4));
    const refBox = h('div', { class: 'section' });
    const diagramBox = h('div', { class: 'section' }, h('h3', {}, 'Diagram'));
    const diagramBody = h('div', {});
    diagramBox.append(diagramBody);
    setChildren(root, header, summaryBox, diagramBox, partBox, subBox, refBox);
    const diagram = createDiagramView(diagramBody, { onOpenPathway });
    diagramRef = diagram;

    try {
      const details = await getPathwayDetails(stId, { signal, owners });
      if (signal.aborted) return;
      const { pathway } = details;
      touchLibrary({ type: 'pathway', key: stId, label: pathway.name });
      store.addHistory({ type: 'pathway', key: stId, label: pathway.name });
      emit('history-changed');
      const row = state.session?.rows.find((r) => r.stId === stId);
      setChildren(
        header,
        h('h2', {}, pathway.name),
        h(
          'p',
          { class: 'muted' },
          externalLink(links.reactomePathway(stId), stId),
          details.species ? ` · ${details.species}` : '',
          details.releaseDate ? ` · first released ${details.releaseDate}` : '',
          pathway.hasDiagram ? ' · has diagram' : ' · no diagram of its own',
        ),
        row &&
          h(
            'p',
            { class: 'note' },
            'In your analysis: ',
            formatFoundTotal(row.entitiesFound, row.entitiesTotal),
            ' found · FDR ',
            formatPValue(row.fdr),
            ' (corrected) · uncorrected p ',
            formatPValue(row.pValue),
            ' ',
            sigBadge(row.significance),
          ),
        h('div', { class: 'crumbs' }),
      );
      getHierarchyOnce().then(
        (hierarchy) => {
          if (signal.aborted) return;
          const paths = getPathsToTop(hierarchy, stId).slice(0, 3);
          setChildren(
            header.querySelector('.crumbs'),
            paths.map((p) =>
              h(
                'ol',
                { class: 'breadcrumb' },
                p.map((id) =>
                  h(
                    'li',
                    {},
                    id === stId
                      ? hierarchy.nodes.get(id).name
                      : h(
                          'button',
                          { class: 'link-btn', type: 'button', onclick: () => onOpenPathway(id) },
                          hierarchy.nodes.get(id).name,
                        ),
                  ),
                ),
              ),
            ),
          );
        },
        () => {},
      );
      setChildren(
        summaryBox,
        h('h3', {}, 'Summary'),
        pathway.summary
          ? pathway.summary.split(/\n{2,}/).map((p) => h('p', {}, p))
          : h('p', { class: 'muted' }, 'Summary: not available.'),
      );
      const subs = details.subEvents.filter((e) => e.isPathway);
      const reactions = details.subEvents.length - subs.length;
      setChildren(
        subBox,
        h('h3', {}, `Sub-pathways (${subs.length})`),
        subs.length
          ? h(
              'ul',
              { class: 'pathway-list' },
              subs.map((s) =>
                h(
                  'li',
                  {},
                  h(
                    'button',
                    { class: 'link-btn', type: 'button', onclick: () => onOpenPathway(s.stId) },
                    s.name,
                  ),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'No sub-pathways.'),
        reactions > 0 &&
          h(
            'p',
            { class: 'muted small' },
            `${reactions} reaction step${reactions === 1 ? '' : 's'} directly inside this pathway.`,
          ),
      );
      setChildren(
        refBox,
        h('h3', {}, `Literature references (${details.references.length})`),
        details.references.length
          ? h(
              'ol',
              { class: 'refs' },
              details.references.map((r) =>
                h(
                  'li',
                  {},
                  r.title ?? 'Title not available',
                  ' ',
                  h('span', { class: 'muted' }, [r.journal, r.year].filter(Boolean).join(', ')),
                  ' ',
                  r.url && externalLink(r.url, `PubMed ${r.pubMedId}`),
                ),
              ),
            )
          : h('p', { class: 'muted' }, 'No references listed.'),
      );
      diagram.show(stId, { hasDiagram: pathway.hasDiagram, name: pathway.name, owners });
    } catch (error) {
      if (signal.aborted) return;
      setChildren(
        root,
        errorState(error, () => show(stId)),
      );
      return;
    }

    // Participants and the "which of my genes" lookup run in parallel; the lookup is optional.
    try {
      const hasSession = Boolean(state.session);
      const [rows, found] = await Promise.all([
        getParticipants(stId, { signal, owners }),
        hasSession ? loadFound(stId, { signal }).catch((e) => e) : Promise.resolve(null),
      ]);
      if (signal.aborted || currentId !== stId) return;
      const foundFailed = found instanceof Error;
      const uniprot = new Set(!foundFailed && found ? found.flatMap((f) => f.uniprot) : []);
      const symbols = userIdentifierSet();
      setChildren(
        partBox,
        h('h3', {}, 'Participants'),
        foundFailed &&
          warningNote(
            `Your genes could not be highlighted (${friendlyError(found)}). The table is complete without highlighting.`,
          ),
        hasSession &&
          !foundFailed &&
          h(
            'p',
            { class: 'note' },
            `★ marks proteins matching your analysis (${found?.length ?? 0} of your identifiers matched this pathway). Matching uses the identifiers Reactome mapped, so aliases are included.`,
          ),
        rows.length
          ? participantsTable(rows, uniprot, symbols, hasSession && !foundFailed)
          : emptyState('Reactome lists no participants for this pathway.'),
      );
    } catch (error) {
      if (signal.aborted) return;
      setChildren(
        partBox,
        h('h3', {}, 'Participants'),
        errorState(error, () => show(stId)),
      );
    }
  }

  return {
    show,
    clear: () => {
      controller?.abort();
      currentId = null;
      setChildren(root);
    },
  };
}

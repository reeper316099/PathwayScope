// Mode B: Enrichment Analysis. Input -> run -> honest results header, "what this means", chart, network, table, sessions, export.
import { ageLabel } from '../core/cache.js';
import { enrichmentToCsv, parseSession, serializeSession, SessionError } from '../core/export.js';
import {
  refreshSessionIfExpired,
  runAnalysis,
  summarizeMapping,
} from '../core/reactomeAnalysis.js';
import { FDR_LABEL, PVALUE_LABEL, formatShare } from '../core/stats.js';
import { buildInterpretation } from '../core/summary.js';
import { HttpError } from '../core/http.js';
import { emptyState, errorState, skeleton, toast, warningNote } from './cards.js';
import { h, setChildren } from './dom.js';
import { saveOrDownload } from './files.js';
import { createEnrichmentChart } from './enrichmentChart.js';
import { createEnrichmentTable } from './enrichmentTable.js';
import { createListInput } from './listInput.js';
import { createNetworkView } from './networkView.js';
import { getSelection, onSelection, select } from './selection.js';
import { emit, on, setSession, state, store } from './state.js';

// Creates the enrichment view inside `root`. ctx: { openPathway(stId) }.
export function createEnrichmentView(root, ctx) {
  const inputCard = h('section', { class: 'card', 'aria-label': 'Gene list input' });
  const results = h(
    'div',
    { class: 'results' },
    emptyState(
      'Run an analysis to see which pathways contain more of your genes than chance would predict.',
    ),
  );
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    'aria-label': 'Open a saved session file',
  });
  root.append(h('h1', {}, 'Enrichment Analysis'), inputCard, results, fileInput);

  let controller = null;
  let view = null; // chart/network/table instances for the current results
  let cutoff = 0.05;
  const input = createListInput(inputCard, {
    onRun: (ids, params) => run(ids, params),
    onCancel: () => controller?.abort(),
    onCutoff: (value) => {
      cutoff = value;
      if (view) refreshViews();
    },
  });

  // Rows that pass the display cutoff, best first (rows are stored in canonical order).
  const shownRows = () => (state.session ? state.session.rows.filter((r) => r.fdr < cutoff) : []);

  // Updates chart, network, table and the interpretation for the current cutoff.
  function refreshViews() {
    const rows = shownRows();
    view.table.setRows(state.session.rows, cutoff);
    view.chart.update(rows);
    view.network.update(rows);
    setChildren(
      view.interpretation,
      h('h2', {}, 'What this means'),
      h(
        'ul',
        {},
        buildInterpretation(state.session, { fdrCutoff: cutoff }).map((line) => h('li', {}, line)),
      ),
    );
  }

  // Draws the honest results header: counts, release, background, correction method, which p-values are shown.
  function header(session) {
    const m = summarizeMapping(session);
    const unmappedList = h(
      'div',
      { class: 'unmapped', hidden: true },
      m.unmapped
        ? h('p', { class: 'mono' }, session.unmappedIdentifiers.join('  '))
        : h('p', { class: 'muted' }, 'Every identifier was mapped.'),
    );
    const toggle = h(
      'button',
      {
        class: 'link-btn',
        type: 'button',
        'aria-expanded': 'false',
        onclick: () => {
          unmappedList.hidden = !unmappedList.hidden;
          toggle.setAttribute('aria-expanded', String(!unmappedList.hidden));
        },
      },
      `Show unmapped identifiers (${m.unmapped})`,
    );
    const p = session.parameters;
    return h(
      'section',
      { class: 'card', 'aria-label': 'Analysis summary' },
      h('h2', {}, 'Results'),
      h(
        'dl',
        { class: 'facts' },
        h('dt', {}, 'Identifiers'),
        h(
          'dd',
          {},
          `${m.submitted} submitted · ${formatShare(m.mapped, m.submitted)} mapped · ${formatShare(m.unmapped, m.submitted)} unmapped `,
          toggle,
        ),
        h('dt', {}, 'Reactome release'),
        h(
          'dd',
          {},
          session.dataVersion ?? 'not available',
          ` · analysed ${ageLabel(Date.parse(session.createdAt))}`,
        ),
        h('dt', {}, 'Background (universe)'),
        h(
          'dd',
          {},
          session.backgroundEntities
            ? `All human Reactome entities in this release (about ${session.backgroundEntities.toLocaleString('en-US')}; derived from Reactome's own ratios, not stated by Reactome)`
            : 'not available',
          p.projectToHuman ? '; non-human identifiers projected to human' : '',
        ),
        h('dt', {}, 'Statistical test'),
        h(
          'dd',
          {},
          `Hypergeometric over-representation test per pathway; FDR correction: Benjamini-Hochberg, computed over ${session.pathwaysTested ?? 'all'} pathways that contain at least one of your entities, before any filter below is applied.`,
        ),
        h('dt', {}, 'Columns shown'),
        h(
          'dd',
          {},
          `${PVALUE_LABEL} and ${FDR_LABEL}. The significance labels use the FDR, not the raw p-value.`,
        ),
        h('dt', {}, 'Options used'),
        h(
          'dd',
          {},
          `disease pathways ${p.includeDisease ? 'included' : 'excluded'} · interactors ${p.includeInteractors ? 'included' : 'excluded'} · pathway size ${p.minSize ?? 'any'} to ${p.maxSize ?? 'any'}`,
        ),
      ),
      unmappedList,
      m.submitted > 0 &&
        m.unmapped / m.submitted > 0.2 &&
        warningNote(
          `${(m.unmappedFraction * 100).toFixed(0)}% of your list could not be mapped. The results describe only the mapped part.`,
        ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: exportCsv }, 'Export CSV'),
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: saveSession },
          'Save session',
        ),
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: () => fileInput.click() },
          'Open session',
        ),
      ),
    );
  }

  // Builds all result panels for the active session.
  function renderResults() {
    const session = state.session;
    if (!session)
      return setChildren(
        results,
        emptyState(
          'Run an analysis to see which pathways contain more of your genes than chance would predict.',
        ),
      );
    const interpretation = h('section', { class: 'card', 'aria-label': 'What this means' });
    const chartBox = h(
      'section',
      { class: 'card', 'aria-label': 'Chart' },
      h('h2', {}, 'Top pathways'),
    );
    const netBox = h(
      'section',
      { class: 'card', 'aria-label': 'Network' },
      h('h2', {}, 'Gene–pathway network'),
    );
    const tableBox = h(
      'section',
      { class: 'card', 'aria-label': 'Results table' },
      h('h2', {}, 'All results'),
    );
    setChildren(
      results,
      header(session),
      session.rows.length === 0
        ? emptyState('Reactome found no pathway containing any of your mapped entities.')
        : [interpretation, h('div', { class: 'viz-grid' }, chartBox, netBox), tableBox],
    );
    if (session.rows.length === 0) return void (view = null);
    view = {
      interpretation,
      table: createEnrichmentTable(tableBox, { onSelect: ctx.openPathway }),
      chart: createEnrichmentChart(chartBox, { onSelect: ctx.openPathway }),
      network: createNetworkView(netBox, {
        onSelectPathway: ctx.openPathway,
        onSelectGene: (g) => select({ type: 'gene', id: g }),
      }),
    };
    refreshViews();
    const sel = getSelection();
    if (sel) syncSelection(sel);
  }

  // Runs an analysis (cancelable) and shows progress text.
  async function run(identifiers, params) {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    input.setRunning(true, 'Starting…');
    setChildren(results, skeleton(6));
    try {
      const session = await runAnalysis(identifiers, params, {
        signal,
        onProgress: (text) => input.setProgress(text),
      });
      if (signal.aborted) throw new HttpError('aborted', 'Cancelled.');
      setSession(session);
      renderResults();
      input.setProgress('');
    } catch (error) {
      if (error instanceof HttpError && error.kind === 'aborted') {
        setChildren(results, emptyState('Analysis cancelled.'));
      } else {
        setChildren(
          results,
          errorState(error, () => run(identifiers, params)),
        );
      }
    } finally {
      input.setRunning(false);
    }
  }

  // Loads a stored/opened session; re-runs it if Reactome forgot the token (rows are shown from the file if offline).
  async function openSession(session) {
    input.setText(session.inputIdentifiers.join('\n'), 'Loaded from a saved session.');
    setChildren(results, skeleton(4));
    input.setRunning(true, 'Checking that the Reactome result is still available…');
    try {
      const out = await refreshSessionIfExpired(session);
      setSession(out.session);
      renderResults();
      if (out.rerun)
        toast(
          `The Reactome result had expired, so the saved gene list was re-run${out.versionChanged ? ` (Reactome release changed from ${session.dataVersion} to ${out.session.dataVersion}; numbers may differ)` : ''}.`,
        );
      if (out.offline)
        toast(
          'Offline: showing the saved results. Pathway details that were not saved need a connection.',
        );
    } catch (error) {
      setChildren(
        results,
        errorState(error, () => openSession(session)),
      );
    } finally {
      input.setRunning(false);
    }
  }

  // Parses session file text (from a file picker or the native Open dialog) and opens it.
  function openSessionText(text) {
    try {
      openSession(parseSession(text));
    } catch (error) {
      toast(
        error instanceof SessionError
          ? `Could not open that file: ${error.message}`
          : 'Could not open that file.',
      );
    }
  }

  // Exports the visible results table as CSV.
  async function exportCsv() {
    if (!state.session?.rows.length) return toast('There are no results to export yet.');
    await saveOrDownload({
      defaultName: 'pathwayscope-results.csv',
      content: enrichmentToCsv(state.session.rows),
      mime: 'text/csv',
    });
  }

  // Saves the active session as a JSON file.
  async function saveSession() {
    if (!state.session) return toast('There is no analysis to save yet.');
    await saveOrDownload({
      defaultName: 'pathwayscope-session.json',
      content: serializeSession(state.session),
      mime: 'application/json',
    });
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) openSessionText(await file.text());
  });

  // Mirrors a selection into the table, chart and network.
  function syncSelection(sel) {
    if (!view) return;
    if (sel?.type === 'pathway') {
      view.table.setSelected(sel.id);
      view.chart.setSelected(sel.id);
    }
    view.table.setGene(sel?.type === 'gene' ? sel.id : null);
    view.network.setSelection(sel);
  }
  onSelection(syncSelection);
  on('session', () => {});

  return {
    // Called whenever the view is shown; re-renders if the active session changed elsewhere.
    show() {
      if (state.session && !view) renderResults();
    },
    openSession,
    openSessionById(id) {
      const s = store.getSession(id);
      if (s) openSession(s);
      else toast('That saved session is no longer available.');
    },
    openSessionText,
    exportCsv,
    saveSession,
    focus: () => document.getElementById('gene-list')?.focus(),
    emit,
  };
}

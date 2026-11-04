// Cytoscape network: gene circles <-> pathway rounded rectangles for the top N pathways, with a text-table fallback.
import cytoscape from 'cytoscape';
import { buildNetwork, DEFAULT_TOP_N } from '../core/network.js';
import { compareRows } from '../core/stats.js';
import { friendlyError, toast } from './cards.js';
import { dataUrlToBase64, saveOrDownload } from './files.js';
import { h, setChildren } from './dom.js';
import { loadFound } from './state.js';

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const CONCURRENCY = 3;

// Creates the network card contents inside `root`. callbacks: { onSelectPathway(stId), onSelectGene(symbol) }.
export function createNetworkView(root, { onSelectPathway, onSelectGene }) {
  const state = { rows: [], topN: DEFAULT_TOP_N, run: 0 };
  const box = h('div', {
    class: 'network-box',
    role: 'img',
    'aria-label':
      'Network linking your genes to the top enriched pathways. A text table with the same information follows.',
  });
  const status = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  const tableBox = h('details', { class: 'fallback' });
  const topRange = h('input', {
    type: 'range',
    min: '3',
    max: '25',
    value: String(DEFAULT_TOP_N),
    'aria-label': 'Number of pathways in the network',
  });
  const topLabel = h('output', {}, `Top ${DEFAULT_TOP_N}`);
  topRange.addEventListener('input', () => {
    state.topN = Number(topRange.value);
    topLabel.textContent = `Top ${state.topN}`;
  });
  topRange.addEventListener('change', () => refresh());
  const resetBtn = h(
    'button',
    { class: 'btn secondary', type: 'button', onclick: () => layout() },
    'Reset layout',
  );
  const exportBtn = h(
    'button',
    {
      class: 'btn secondary',
      type: 'button',
      onclick: async () => {
        if (!cy || cy.elements().length === 0) return toast('There is no network to export yet.');
        await saveOrDownload({
          defaultName: 'pathwayscope-network.png',
          content: dataUrlToBase64(cy.png({ full: true, scale: 2, bg: cssVar('--surface') })),
          encoding: 'base64',
          mime: 'image/png',
        });
      },
    },
    'Export PNG',
  );
  root.append(
    h(
      'div',
      { class: 'toolbar' },
      h('label', {}, 'Pathways: ', topRange, ' ', topLabel),
      resetBtn,
      exportBtn,
    ),
    h(
      'p',
      { class: 'muted small' },
      'Circles are your genes; rounded rectangles are pathways (larger = smaller FDR). Genes shared by several pathways have a thick amber outline and a larger circle.',
    ),
    box,
    status,
    tableBox,
  );
  let cy = null;

  // Cytoscape stylesheet built from the current theme tokens.
  const styleSheet = () => {
    const text = cssVar('--text');
    const accent = cssVar('--accent');
    const sig = {
      strong: cssVar('--strong'),
      moderate: cssVar('--moderate'),
      weak: cssVar('--weak'),
      none: cssVar('--none'),
    };
    return [
      {
        selector: 'node[type="gene"]',
        style: {
          shape: 'ellipse',
          'background-color': cssVar('--secondary'),
          label: 'data(label)',
          color: text,
          'font-size': 10,
          width: 'mapData(degree, 1, 10, 12, 26)',
          height: 'mapData(degree, 1, 10, 12, 26)',
          'text-valign': 'bottom',
          'text-margin-y': 3,
        },
      },
      {
        selector: 'node[type="gene"][?shared]',
        style: { 'border-width': 3, 'border-color': accent, 'font-weight': 'bold' },
      },
      {
        selector: 'node[type="pathway"]',
        style: {
          shape: 'round-rectangle',
          label: 'data(label)',
          'text-wrap': 'wrap',
          'text-max-width': 130,
          'font-size': 10,
          color: '#fff',
          'text-valign': 'center',
          'text-halign': 'center',
          width: 'mapData(weight, 0, 15, 90, 150)',
          height: 'mapData(weight, 0, 15, 36, 64)',
          'background-color': cssVar('--none'),
        },
      },
      ...Object.entries(sig).map(([k, color]) => ({
        selector: `node[significance="${k}"]`,
        style: {
          'background-color': color,
          color: k === 'weak' || k === 'none' ? '#0f172a' : '#fff',
        },
      })),
      {
        selector: 'edge',
        style: {
          width: 1,
          'line-color': cssVar('--border'),
          opacity: 0.8,
          'curve-style': 'haystack',
        },
      },
      { selector: '.sel', style: { 'border-width': 4, 'border-color': accent, 'z-index': 99 } },
      { selector: 'edge.sel', style: { 'line-color': accent, width: 2 } },
    ];
  };

  // Runs the force-directed layout (also used by "Reset layout").
  function layout() {
    cy?.layout({
      name: 'cose',
      animate: false,
      fit: true,
      padding: 24,
      nodeRepulsion: () => 60000,
      idealEdgeLength: () => 170,
      nodeOverlap: 30,
      gravity: 0.4,
      numIter: 1500,
    }).run();
  }

  // Draws the text-table fallback.
  function drawTable(net) {
    setChildren(
      tableBox,
      h('summary', {}, 'Text version of this network (genes and the pathways they link to)'),
      net.table.length === 0
        ? h('p', { class: 'muted' }, 'No genes loaded.')
        : h(
            'table',
            { class: 'data' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', { scope: 'col' }, 'Gene'),
                h('th', { scope: 'col' }, 'Pathways'),
                h('th', { scope: 'col' }, 'Names'),
              ),
            ),
            h(
              'tbody',
              {},
              net.table.map((r) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    {},
                    h(
                      'button',
                      {
                        class: 'link-btn',
                        type: 'button',
                        'aria-label': `Select gene ${r.gene}`,
                        onclick: () => onSelectGene(r.gene),
                      },
                      r.gene,
                    ),
                  ),
                  h('td', { class: 'num' }, r.pathwayCount),
                  h('td', {}, r.pathways.join('; ')),
                ),
              ),
            ),
          ),
    );
  }

  // Loads the found genes for the top N pathways (a few at a time), then builds and draws the graph.
  async function refresh() {
    const run = ++state.run;
    const top = [...state.rows].sort(compareRows).slice(0, state.topN);
    if (top.length === 0) {
      cy?.elements().remove();
      setChildren(tableBox);
      return void (status.textContent = 'No pathways to show at the current FDR cutoff.');
    }
    const pending = top.filter((r) => r.foundIdentifiers === null);
    let done = 0;
    let failed = null;
    const queue = [...pending];
    const worker = async () => {
      while (queue.length && run === state.run) {
        const row = queue.shift();
        try {
          await loadFound(row.stId);
        } catch (error) {
          failed = error;
        }
        done += 1;
        status.textContent = `Loading the genes of pathway ${done} of ${pending.length}…`;
      }
    };
    if (pending.length)
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
    if (run !== state.run) return;
    const net = buildNetwork(state.rows, { topN: state.topN });
    status.textContent = `${net.stats.pathwayNodes} pathways, ${net.stats.geneNodes} genes, ${net.stats.edges} links; ${net.stats.sharedGenes} genes are shared by more than one pathway.${failed ? ` ⚠ Some pathways' genes could not be loaded (${friendlyError(failed)}); they are shown without links.` : ''}`;
    drawTable(net);
    if (!cy) {
      cy = cytoscape({
        container: box,
        elements: [],
        style: styleSheet(),
        minZoom: 0.2,
        maxZoom: 3,
      });
      cy.on('tap', 'node', (event) => {
        const data = event.target.data();
        if (data.type === 'pathway') onSelectPathway(data.stId);
        else onSelectGene(data.label);
      });
      document.addEventListener('themechange', () => cy.style(styleSheet()));
    }
    cy.elements().remove();
    cy.add([...net.elements.nodes, ...net.elements.edges]);
    layout();
  }

  return {
    // Gives the network new rows (already filtered by the FDR cutoff).
    update(rows) {
      state.rows = rows;
      return refresh();
    },
    // Highlights the selected pathway node and the selected gene node (either may be null).
    setSelection(pathwayId, geneId) {
      if (!cy) return;
      cy.elements().removeClass('sel');
      for (const id of [
        pathwayId && `pw:${pathwayId}`,
        geneId && `gene:${geneId.toUpperCase()}`,
      ].filter(Boolean)) {
        const node = cy.getElementById(id);
        if (node.nonempty()) {
          node.addClass('sel');
          node.connectedEdges().addClass('sel');
        }
      }
    },
  };
}

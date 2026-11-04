// Chart.js charts: horizontal bars of -log10(FDR) for the top N pathways, or a bubble plot (bubble size = entities found).
import {
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  Chart,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { NEG_LOG10_CAP, formatFoundTotal, formatPValue, negLog10 } from '../core/stats.js';
import { dataUrlToBase64, saveOrDownload } from './files.js';
import { SIG_GLYPH, sigLegend } from './badges.js';
import { h } from './dom.js';
import { toast } from './cards.js';

Chart.register(
  BarController,
  BarElement,
  BubbleController,
  CategoryScale,
  LinearScale,
  PointElement,
  Tooltip,
);

const TOP_N_CHOICES = [10, 15, 20, 30];

// Reads a CSS custom property (so the chart follows light/dark theme tokens).
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Shortens long pathway names for axis labels (full name stays in the tooltip).
const shorten = (text, max = 46) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Creates the chart card contents inside `root`. callbacks: { onSelect(stId) }. Returns { update, setSelected }.
export function createEnrichmentChart(root, { onSelect }) {
  const state = { rows: [], mode: 'bar', topN: 10, selected: null };
  const canvas = h('canvas', {
    role: 'img',
    'aria-label': 'Chart of the top enriched pathways. The same numbers are in the results table.',
  });
  const barBtn = h(
    'button',
    {
      class: 'btn secondary',
      type: 'button',
      'aria-pressed': 'true',
      onclick: () => setMode('bar'),
    },
    'Bar chart',
  );
  const bubbleBtn = h(
    'button',
    {
      class: 'btn secondary',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => setMode('bubble'),
    },
    'Bubble chart',
  );
  const topSel = h(
    'select',
    {
      'aria-label': 'Number of pathways in the chart',
      onchange: (e) => {
        state.topN = Number(e.target.value);
        draw();
      },
    },
    TOP_N_CHOICES.map((n) => h('option', { value: String(n) }, `Top ${n}`)),
  );
  const note = h('p', { class: 'muted small' });
  const exportBtn = h(
    'button',
    {
      class: 'btn secondary',
      type: 'button',
      onclick: async () => {
        if (chart)
          await saveOrDownload({
            defaultName: 'pathwayscope-chart.png',
            content: dataUrlToBase64(chart.toBase64Image('image/png', 1)),
            encoding: 'base64',
            mime: 'image/png',
          });
        else toast('There is no chart to export yet.');
      },
    },
    'Export PNG',
  );
  root.append(
    h('div', { class: 'toolbar' }, barBtn, bubbleBtn, topSel, exportBtn),
    sigLegend(),
    h('div', { class: 'chart-box' }, canvas),
    note,
  );
  let chart = null;

  // Switches between bar and bubble charts.
  function setMode(mode) {
    state.mode = mode;
    barBtn.setAttribute('aria-pressed', String(mode === 'bar'));
    bubbleBtn.setAttribute('aria-pressed', String(mode === 'bubble'));
    draw();
  }

  // Colors for the four significance buckets from the theme tokens.
  const colors = () => ({
    strong: cssVar('--strong'),
    moderate: cssVar('--moderate'),
    weak: cssVar('--weak'),
    none: cssVar('--none'),
  });

  // (Re)draws the chart from the current rows.
  function draw() {
    chart?.destroy();
    chart = null;
    const rows = state.rows.slice(0, state.topN);
    note.textContent = rows.length
      ? `Axis: −log10 of the FDR (Benjamini-Hochberg), capped at ${NEG_LOG10_CAP} (Reactome's numerical precision floor). Click a ${state.mode === 'bar' ? 'bar' : 'bubble'} to select that pathway.`
      : 'No pathways to chart at the current FDR cutoff.';
    if (rows.length === 0) return;
    const c = colors();
    const text = cssVar('--text');
    const grid = cssVar('--border');
    const accent = cssVar('--accent');
    canvas.setAttribute(
      'aria-label',
      `${state.mode === 'bar' ? 'Bar' : 'Bubble'} chart of the top ${rows.length} pathways by FDR. The same numbers are in the results table.`,
    );
    const tooltip = {
      callbacks: {
        title: (items) => rows[items[0].dataIndex ?? 0]?.name,
        label: (item) => {
          const r = rows[item.dataIndex];
          return [
            `${formatFoundTotal(r.entitiesFound, r.entitiesTotal)} found`,
            `FDR ${formatPValue(r.fdr)} · ${r.significance}`,
          ];
        },
      },
    };
    const onClick = (_e, els) => {
      if (els.length) onSelect(rows[els[0].index].stId);
    };
    if (state.mode === 'bar') {
      chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: rows.map((r) => `${SIG_GLYPH[r.significance]} ${shorten(r.name)}`),
          datasets: [
            {
              data: rows.map((r) => negLog10(r.fdr)),
              backgroundColor: rows.map((r) => c[r.significance]),
              borderColor: rows.map((r) => (r.stId === state.selected ? accent : 'transparent')),
              borderWidth: rows.map((r) => (r.stId === state.selected ? 3 : 0)),
            },
          ],
        },
        options: {
          indexAxis: 'y',
          maintainAspectRatio: false,
          animation: false,
          onClick,
          plugins: { legend: { display: false }, tooltip },
          scales: {
            x: {
              title: { display: true, text: '−log10(FDR)', color: text },
              ticks: { color: text },
              grid: { color: grid },
              beginAtZero: true,
              max: NEG_LOG10_CAP,
            },
            y: { ticks: { color: text, autoSkip: false }, grid: { display: false } },
          },
        },
      });
    } else {
      const radius = (r) => 4 + Math.sqrt(r.entitiesFound) * 2.2;
      chart = new Chart(canvas, {
        type: 'bubble',
        data: {
          datasets: [
            {
              data: rows.map((r) => ({ x: r.ratio, y: negLog10(r.fdr), r: radius(r) })),
              backgroundColor: rows.map((r) => c[r.significance]),
              borderColor: rows.map((r) => (r.stId === state.selected ? accent : text)),
              borderWidth: rows.map((r) => (r.stId === state.selected ? 3 : 1)),
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          animation: false,
          onClick,
          plugins: { legend: { display: false }, tooltip },
          scales: {
            x: {
              title: { display: true, text: 'Ratio (entities found ÷ pathway total)', color: text },
              ticks: { color: text },
              grid: { color: grid },
              beginAtZero: true,
            },
            y: {
              title: {
                display: true,
                text: '−log10(FDR); bubble size = entities found',
                color: text,
              },
              ticks: { color: text },
              grid: { color: grid },
              beginAtZero: true,
              max: NEG_LOG10_CAP,
            },
          },
        },
      });
    }
  }
  document.addEventListener('themechange', draw);

  return {
    // Gives the chart new rows (already filtered by the FDR cutoff and ordered best-first).
    update(rows) {
      state.rows = rows;
      draw();
    },
    // Marks one pathway as selected.
    setSelected(stId) {
      state.selected = stId;
      draw();
    },
  };
}

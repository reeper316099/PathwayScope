// Significance badges: color AND a distinct shape AND a text label (color is never the only signal).
import { SIGNIFICANCE_LEGEND } from '../core/stats.js';
import { h } from './dom.js';

export const SIG_GLYPH = { strong: '◆', moderate: '▲', weak: '■', none: '○' };
const LABELS = Object.fromEntries(SIGNIFICANCE_LEGEND.map((l) => [l.key, l.label]));

// Returns a small badge element for a significance bucket.
export function sigBadge(bucket) {
  return h(
    'span',
    {
      class: `badge sig-${bucket}`,
      title: SIGNIFICANCE_LEGEND.find((l) => l.key === bucket)?.rule,
    },
    h('span', { 'aria-hidden': 'true' }, SIG_GLYPH[bucket]),
    ' ',
    LABELS[bucket] ?? 'Unknown',
  );
}

// Returns the legend (shape + color + rule) shown above charts and tables.
export function sigLegend() {
  return h(
    'ul',
    { class: 'legend', 'aria-label': 'Significance legend' },
    SIGNIFICANCE_LEGEND.map((l) =>
      h('li', {}, sigBadge(l.key), ' ', h('span', { class: 'muted' }, l.rule)),
    ),
  );
}

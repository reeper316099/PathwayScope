// Selection bus: choosing a pathway or gene in ANY view is announced here so every other view can highlight it.
// A pathway and a gene can be selected at the same time (selecting a gene does not clear the selected pathway).
import { emit, on } from './state.js';

const current = { pathway: null, gene: null };
let last = null;

// Returns the most recent selection ({type, id}) or null.
export const getSelection = () => last;

// Returns the currently selected id for one type ('pathway' or 'gene'), or null.
export const getSelected = (type) => current[type];

// Sets (or clears, with {type, id: null}) one selection slot and notifies every subscriber; no-op if unchanged.
export function select(selection) {
  if (!selection || current[selection.type] === selection.id) return;
  current[selection.type] = selection.id;
  last = selection;
  emit('selection', selection);
}

// Subscribes to selection changes.
export const onSelection = (fn) => on('selection', fn);

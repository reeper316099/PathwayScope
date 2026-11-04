// Selection bus: choosing a pathway or gene in ANY view is announced here so every other view can highlight it.
import { emit, on } from './state.js';

let current = null;

// Returns the current selection ({type:'pathway'|'gene', id}) or null.
export const getSelection = () => current;

// Sets the selection (no-op if unchanged) and notifies every subscriber.
export function select(selection) {
  const same = current?.type === selection?.type && current?.id === selection?.id;
  if (same) return;
  current = selection;
  emit('selection', current);
}

// Subscribes to selection changes.
export const onSelection = (fn) => on('selection', fn);

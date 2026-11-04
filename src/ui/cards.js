// Shared panel states (loading skeleton, empty, error with retry), toasts, banner, and the "cached X ago" label.
import { ageLabel } from '../core/cache.js';
import { HttpError, isElectron } from '../core/http.js';
import { h } from './dom.js';

// Shows a short message in the aria-live toast region.
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 4000);
}

// Shows (or hides, with null) the page-wide banner under the top bar.
export function setBanner(text) {
  const el = document.getElementById('banner');
  el.textContent = text ?? '';
  el.hidden = !text;
}

// Returns the visible provenance text for data that may come from cache.
export function cacheLabel({ fromCache, cachedAt, stale }) {
  if (!fromCache || !cachedAt) return 'fetched live';
  return `${stale ? 'offline, showing cached data from' : 'cached'} ${ageLabel(cachedAt)}`;
}

// Turns any error into a friendly sentence for non-experts.
export function friendlyError(error) {
  if (error instanceof HttpError) {
    if (error.kind === 'aborted') return 'Cancelled.';
    if (error.kind === 'timeout')
      return 'The request took too long. Reactome may be busy; please try again.';
    if (error.kind === 'network') {
      if (isElectron())
        return 'Could not reach the data source. Check your internet connection. Anything you opened before is still available from the cache.';
      return navigator.onLine
        ? "This data source can't be reached from the browser. Download the desktop app for full functionality."
        : 'You appear to be offline.';
    }
    if (error.kind === 'blocked')
      return `The app's security rules blocked this request (${error.message}).`;
    if (error.status === 404) return 'Not found.';
    if (error.status >= 500)
      return `The data source had a problem (HTTP ${error.status}). Please try again in a moment.`;
    return `The data source answered with an error (${error.message}).`;
  }
  return error?.message || 'Something went wrong.';
}

// Skeleton shimmer placeholder with a given number of lines.
export const skeleton = (lines = 3) =>
  h(
    'div',
    { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' },
    Array.from({ length: lines }, (_, i) =>
      h('div', { class: 'skeleton-line', style: { width: `${95 - ((i * 17) % 40)}%` } }),
    ),
  );

// Friendly empty-state box.
export const emptyState = (message) => h('div', { class: 'state empty', role: 'status' }, message);

// Error box with an optional retry button.
export function errorState(error, onRetry) {
  return h(
    'div',
    { class: 'state error', role: 'alert' },
    h('p', {}, friendlyError(error)),
    onRetry && h('button', { class: 'btn', type: 'button', onclick: onRetry }, 'Try again'),
  );
}

// Warning box for partial failures (the rest of the panel still works).
export const warningNote = (message) =>
  h('p', { class: 'note warn', role: 'status' }, '⚠ ', message);

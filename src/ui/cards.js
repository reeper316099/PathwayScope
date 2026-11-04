// Small shared UI helpers: toast messages and the "cached X ago" label.
import { ageLabel } from '../core/cache.js';

// Shows a short message in the aria-live toast region.
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

// Returns the visible provenance text for data that may come from cache.
export function cacheLabel({ fromCache, cachedAt, stale }) {
  if (!fromCache || !cachedAt) return 'fetched live';
  return `${stale ? 'offline, showing cached data from' : 'cached'} ${ageLabel(cachedAt)}`;
}

// App bootstrap: hash router for the three modes, shared pathway detail drawer, menu/shortcut actions, offline banner.
import { cache, isElectron, onRequestMeta } from './core/http.js';
import { getDatabaseInfo } from './core/reactomeContent.js';
import { createDataManager } from './ui/dataManager.js';
import { createEnrichmentView } from './ui/enrichmentView.js';
import { createGeneExplorer } from './ui/geneExplorer.js';
import { createBrowserView } from './ui/browserView.js';
import { cacheLabel, setBanner, toast } from './ui/cards.js';
import { mountHistory } from './ui/history.js';
import { createPathwayDetail } from './ui/pathwayDetail.js';
import { mountGlobalSearch } from './ui/search.js';
import { getSelected, onSelection, select } from './ui/selection.js';
import { initTheme, toggleTheme } from './ui/theme.js';

const MODES = ['explorer', 'enrichment', 'browser'];
const $ = (id) => document.getElementById(id);
const views = {};
let mode = 'explorer';
let aboutInfo = '';

// Splits the URL hash ("#/explorer/TP53") into { mode, param }.
function parseHash() {
  const [m, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return {
    mode: MODES.includes(m) ? m : 'explorer',
    param: rest.length ? decodeURIComponent(rest.join('/')) : '',
  };
}

// Changes the URL hash (which triggers the router).
const go = (m, param = '') => {
  location.hash = `#/${m}${param ? `/${encodeURIComponent(param)}` : ''}`;
};

// Shared actions every view can call.
const ctx = {
  openPathway: (stId) => {
    select({ type: 'pathway', id: stId });
    if (mode === 'browser' && parseHash().param !== stId)
      history.replaceState(null, '', `#/browser/${stId}`);
  },
  navigateGene: (symbol) => go('explorer', symbol),
  currentPathway: () => getSelected('pathway'),
};

// Creates a view the first time its mode is shown.
function ensureView(name) {
  if (views[name]) return views[name];
  const root = document.querySelector(`[data-view="${name}"]`);
  views[name] = {
    explorer: createGeneExplorer,
    enrichment: createEnrichmentView,
    browser: createBrowserView,
  }[name](root, ctx);
  return views[name];
}

// Shows one mode and passes it the URL parameter (gene symbol or pathway ID).
function showMode({ mode: next, param }) {
  mode = next;
  document.querySelectorAll('[data-view]').forEach((el) => {
    el.hidden = el.dataset.view !== next;
  });
  document
    .querySelectorAll('[data-mode]')
    .forEach((a) =>
      a.dataset.mode === next
        ? a.setAttribute('aria-current', 'page')
        : a.removeAttribute('aria-current'),
    );
  if (next === 'browser') closeDrawer(); // the browser view has its own inline detail panel
  ensureView(next).show(param);
}

// ---- Pathway detail drawer (used by Gene Explorer and Enrichment) ----
let drawerDetail = null;
const closeDrawer = () => {
  $('drawer').hidden = true;
};
function openDrawer(stId) {
  $('drawer').hidden = false;
  drawerDetail ??= createPathwayDetail($('drawer-body'), { onOpenPathway: ctx.openPathway });
  drawerDetail.show(stId);
}
onSelection((sel) => {
  if (sel?.type === 'pathway' && mode !== 'browser') openDrawer(sel.id);
});

// Loads the Reactome release and shows it with its provenance (live vs cached).
async function refreshDataStatus() {
  const el = $('data-status');
  try {
    const info = await getDatabaseInfo();
    const release =
      info.releaseNumber === null
        ? 'not available'
        : `${info.releaseNumber}${info.releaseDate ? ` (${info.releaseDate})` : ''}`;
    el.textContent = `Reactome release: ${release} · ${cacheLabel(info)}`;
    $('about-data').textContent =
      `Data: Reactome release ${release}; fetched ${info.fromCache && info.cachedAt ? new Date(info.cachedAt).toLocaleString() : new Date().toLocaleString()}${info.fromCache ? ' (from cache)' : ''}. Every analysis shows its own release.`;
  } catch {
    el.textContent = 'Reactome release: not available';
  }
}

// Handles an action from the native menu or a keyboard shortcut.
async function handleAction({ action, payload }) {
  if (action.startsWith('mode:')) go(action.slice(5));
  else if (action === 'focusSearch') search.focus();
  else if (action === 'toggleTheme') toggleTheme();
  else if (action === 'about') $('about-dialog').showModal();
  else if (action === 'dataSources') $('sources-dialog').showModal();
  else if (action === 'manageData') dataManager.open();
  else if (action === 'cacheCleared') {
    cache.clear();
    toast(`Cache cleared (${payload?.removed ?? 0} saved responses removed).`);
    refreshDataStatus();
  } else if (action === 'openSession') {
    go('enrichment');
    ensureView('enrichment').openSessionText(payload);
  } else if (action === 'saveSession') ensureView('enrichment').saveSession();
  else if (action === 'exportCsv') ensureView('enrichment').exportCsv();
}

// Browser-only keyboard shortcuts (Electron uses the native menu accelerators instead).
function bindBrowserShortcuts() {
  const map = {
    k: 'focusSearch',
    d: 'toggleTheme',
    e: 'exportCsv',
    s: 'saveSession',
    1: 'mode:explorer',
    2: 'mode:enrichment',
    3: 'mode:browser',
  };
  window.addEventListener('keydown', (event) => {
    const action =
      (event.ctrlKey || event.metaKey) && !event.altKey ? map[event.key.toLowerCase()] : undefined;
    if (!action) return;
    event.preventDefault();
    handleAction({ action });
  });
}

// Opens link-outs through the allowlisted main-process call in Electron, or normally in a browser tab.
function bindExternalLinks() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-external]');
    if (!link || !isElectron()) return;
    event.preventDefault();
    window.api.openExternal(link.href);
  });
}

// Page-wide offline / blocked banner driven by every request outcome and by the browser's online/offline events.
function bindBanner() {
  let lastCachedAt = null;
  // Banner text for "offline, but cached data is shown".
  const offlineText = () =>
    `Offline: showing cached data${lastCachedAt ? ` from ${new Date(lastCachedAt).toLocaleString()}` : ''}. Anything that was never cached cannot be loaded until you are back online.`;
  onRequestMeta((event) => {
    if (event.type === 'ok' && event.fromCache && event.cachedAt) {
      lastCachedAt = event.cachedAt;
      if (event.stale || !navigator.onLine) setBanner(offlineText());
    } else if (event.type === 'ok' && !event.fromCache) setBanner(null);
    else if (event.type === 'error' && event.error.kind === 'network') {
      setBanner(
        isElectron()
          ? 'You appear to be offline. Cached data is shown where available; anything not cached cannot be loaded.'
          : navigator.onLine
            ? "This data source can't be reached from the browser. Download the desktop app for full functionality."
            : 'You appear to be offline.',
      );
    }
  });
  window.addEventListener('offline', () => setBanner(offlineText()));
  window.addEventListener('online', () => setBanner(null));
  if (!navigator.onLine) setBanner(offlineText());
}

let search;
let dataManager;
// Starts everything once the DOM is ready.
async function boot() {
  initTheme();
  bindBanner();
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('about-btn').addEventListener('click', () => handleAction({ action: 'about' }));
  dataManager = createDataManager($('data-dialog'));
  $('data-btn').addEventListener('click', () => dataManager.open());
  $('drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener(
    'keydown',
    (e) => e.key === 'Escape' && !$('drawer').hidden && closeDrawer(),
  );
  window.addEventListener('hashchange', () => showMode(parseHash()));
  bindExternalLinks();
  search = mountGlobalSearch({
    form: $('global-search'),
    input: $('search-input'),
    onGene: (g) => go('explorer', g),
    onPathway: (id) => {
      go('browser', id);
    },
  });
  mountHistory({
    historyEl: $('history-list'),
    sessionsEl: $('sessions-list'),
    onOpenGene: (g) => go('explorer', g),
    onOpenPathway: (id) => go('browser', id),
    onOpenSession: (id) => {
      go('enrichment');
      ensureView('enrichment').openSessionById(id);
    },
  });
  if (isElectron()) {
    window.api.onMenuAction(handleAction);
    const info = await window.api.getAppInfo();
    if (info.ok)
      aboutInfo = `Version ${info.version} · Electron ${info.electron} · ${info.platform}`;
  } else {
    bindBrowserShortcuts();
    aboutInfo = 'Web version';
  }
  $('about-version').textContent = aboutInfo;
  showMode(parseHash());
  refreshDataStatus();
}

boot();

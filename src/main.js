// App bootstrap: hash router for the three modes, menu/shortcut actions, theme, and the data-release status line.
import { cache, HttpError, isElectron } from './core/http.js';
import { getDatabaseInfo } from './core/reactomeContent.js';
import { cacheLabel, toast } from './ui/cards.js';
import { initTheme, toggleTheme } from './ui/theme.js';

const MODES = ['explorer', 'enrichment', 'browser'];
const $ = (id) => document.getElementById(id);

// Shows the view for a mode, marks the nav link as current, and updates the URL hash.
function showMode(mode) {
  const safe = MODES.includes(mode) ? mode : 'explorer';
  document.querySelectorAll('[data-view]').forEach((el) => {
    el.hidden = el.dataset.view !== safe;
  });
  document.querySelectorAll('[data-mode]').forEach((a) => {
    if (a.dataset.mode === safe) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (location.hash !== `#/${safe}`) location.hash = `#/${safe}`;
}

// Reads the mode from the URL hash (e.g. "#/browser").
const modeFromHash = () => location.hash.replace('#/', '');

// Loads the Reactome release and shows it, with where the data came from (live vs cached).
async function refreshDataStatus() {
  const el = $('data-status');
  try {
    const info = await getDatabaseInfo();
    const release =
      info.releaseNumber === null
        ? 'not available'
        : `${info.releaseNumber}${info.releaseDate ? ` (${info.releaseDate})` : ''}`;
    el.textContent = `Reactome release: ${release} · ${cacheLabel(info)}`;
    $('banner').hidden = true;
  } catch (error) {
    el.textContent = 'Reactome release: not available';
    const blocked = error instanceof HttpError && !isElectron();
    $('banner').hidden = false;
    $('banner').textContent = blocked
      ? "This data source can't be reached from the browser. Download the desktop app for full functionality."
      : 'Cannot reach Reactome right now. Cached data is shown where available.';
  }
}

// Opens one of the two info dialogs.
const openDialog = (id) => $(id).showModal();

// Handles an action from the native menu or a keyboard shortcut.
async function handleAction({ action, payload }) {
  if (action.startsWith('mode:')) showMode(action.slice(5));
  else if (action === 'focusSearch') $('search-input').focus();
  else if (action === 'toggleTheme') toggleTheme();
  else if (action === 'about') openDialog('about-dialog');
  else if (action === 'dataSources') openDialog('sources-dialog');
  else if (action === 'cacheCleared') {
    cache.clear();
    toast(`Cache cleared (${payload?.removed ?? 0} saved responses removed).`);
    refreshDataStatus();
  } else if (['saveSession', 'exportCsv', 'openSession'].includes(action))
    toast('There is no analysis to work with yet.');
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

// Opens link-outs: through the allowlisted main-process call in Electron, normally in a browser.
function bindExternalLinks() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-external]');
    if (!link) return;
    if (isElectron()) {
      event.preventDefault();
      window.api.openExternal(link.href);
    } else {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  });
}

// Starts everything once the DOM is ready.
async function boot() {
  initTheme();
  $('theme-toggle').addEventListener('click', toggleTheme);
  $('about-btn').addEventListener('click', () => handleAction({ action: 'about' }));
  $('global-search').addEventListener('submit', (event) => event.preventDefault());
  window.addEventListener('hashchange', () => showMode(modeFromHash()));
  bindExternalLinks();
  if (isElectron()) {
    window.api.onMenuAction(handleAction);
    const info = await window.api.getAppInfo();
    if (info.ok)
      $('about-version').textContent =
        `Version ${info.version} · Electron ${info.electron} · ${info.platform}`;
  } else {
    bindBrowserShortcuts();
    $('about-version').textContent = 'Web version';
  }
  showMode(modeFromHash());
  refreshDataStatus();
}

boot();

// "Manage stored data": see and delete history, saved sessions and cached lookups, one by one or all at once.
import { ageLabel } from '../core/cache.js';
import { cache, isElectron } from '../core/http.js';
import { toast } from './cards.js';
import { debounce, h, setChildren } from './dom.js';
import { emit, libraryStore, store } from './state.js';
import { ownersOf } from '../core/library.js';

const SHOW_LIMIT = 200;
const KIND_NAMES = {
  gene: 'Gene',
  pathway: 'Pathway',
  analysis: 'Analysis',
  shared: 'Shared',
  other: 'Other',
};

// Formats a byte count like "1.4 MB".
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Where cached lookups live: the disk cache in Electron (via IPC), this browser's storage on the web.
const cacheSource = {
  async list() {
    if (isElectron()) return window.api.listCache();
    const entries = cache.list();
    return {
      ok: true,
      folder: null,
      totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
      entries,
    };
  },
  async remove(key) {
    if (isElectron()) return window.api.deleteCacheEntry(key);
    if (key === 'all') cache.clear();
    else cache.remove(key);
    return { ok: true };
  },
};

// A small "✕" delete button with an accessible name.
const xButton = (label, onclick) =>
  h('button', { class: 'icon-x', type: 'button', 'aria-label': label, onclick }, '✕');

// Creates the stored-data manager inside `container` (the Settings view). Returns { refresh }.
export function createDataManager(container) {
  let filter = '';
  let confirming = false;

  // Runs a delete action, tells the rest of the app, shows a toast and redraws the section.
  async function act(action, message) {
    await action();
    emit('history-changed');
    emit('sessions-changed');
    toast(message);
    render();
  }

  // Section: search history.
  function historySection() {
    const history = store.getHistory();
    return h(
      'section',
      { class: 'data-section' },
      h(
        'div',
        { class: 'row-between' },
        h('h3', {}, `History (${history.length})`),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            disabled: history.length === 0,
            onclick: () => act(() => store.clearHistory(), 'History cleared.'),
          },
          'Clear history',
        ),
      ),
      history.length === 0
        ? h('p', { class: 'muted' }, 'No history.')
        : h(
            'ul',
            { class: 'data-list' },
            history.map((e) =>
              h(
                'li',
                { class: 'row-between' },
                h(
                  'span',
                  {},
                  e.label,
                  ' ',
                  h('span', { class: 'muted small' }, `${e.type} · ${ageLabel(Date.parse(e.at))}`),
                ),
                xButton(`Remove ${e.label} from history`, () =>
                  act(() => store.removeHistory(e.type, e.key), 'Removed from history.'),
                ),
              ),
            ),
          ),
    );
  }

  // Section: saved analysis sessions.
  function sessionsSection() {
    const sessions = store.listSessions();
    return h(
      'section',
      { class: 'data-section' },
      h(
        'div',
        { class: 'row-between' },
        h('h3', {}, `Saved sessions (${sessions.length})`),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            disabled: sessions.length === 0,
            onclick: () => act(() => store.clearSessions(), 'All saved sessions deleted.'),
          },
          'Delete all sessions',
        ),
      ),
      sessions.length === 0
        ? h('p', { class: 'muted' }, 'No saved sessions.')
        : h(
            'ul',
            { class: 'data-list' },
            sessions.map((s) =>
              h(
                'li',
                { class: 'row-between' },
                h(
                  'span',
                  {},
                  `${s.label} · ${s.rows} pathways`,
                  ' ',
                  h(
                    'span',
                    { class: 'muted small' },
                    `Reactome release ${s.dataVersion ?? 'not available'} · ${ageLabel(Date.parse(s.createdAt))}`,
                  ),
                ),
                xButton(`Delete saved session from ${s.createdAt}`, () =>
                  act(() => store.deleteSession(s.id), 'Saved session deleted.'),
                ),
              ),
            ),
          ),
    );
  }

  // Section: cached lookups (filterable table with a delete button per row).
  function cacheSection(cached) {
    const all = cached.entries ?? [];
    const needle = filter.trim().toLowerCase();
    const shown = all.filter((e) => !needle || e.label.toLowerCase().includes(needle));
    const rows = shown.slice(0, SHOW_LIMIT).map((e) =>
      h(
        'tr',
        {},
        h('td', {}, e.label),
        h('td', {}, KIND_NAMES[e.kind] ?? 'Other'),
        h('td', {}, ageLabel(e.cachedAt)),
        h('td', { class: 'num' }, formatBytes(e.bytes)),
        h(
          'td',
          {},
          xButton(`Delete cached item: ${e.label}`, () =>
            act(() => cacheSource.remove(e.key), 'Cached item deleted.'),
          ),
        ),
      ),
    );
    const filterBox = h('input', {
      type: 'search',
      'aria-label': 'Filter cached lookups',
      placeholder: 'Filter, e.g. TP53',
      value: filter,
      oninput: debounce((e) => {
        filter = e.target.value;
        render().then(() => container.querySelector('input[type=search]')?.focus());
      }, 200),
    });
    return h(
      'section',
      { class: 'data-section' },
      h(
        'div',
        { class: 'row-between' },
        h('h3', {}, `Cached lookups (${all.length} · ${formatBytes(cached.totalBytes)})`),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            disabled: all.length === 0,
            onclick: () => act(() => cacheSource.remove('all'), 'All cached lookups deleted.'),
          },
          'Clear all cached data',
        ),
      ),
      filterBox,
      shown.length === 0
        ? h(
            'p',
            { class: 'muted' },
            all.length ? 'No cached lookup matches that filter.' : 'Nothing cached.',
          )
        : h(
            'div',
            { class: 'table-wrap data-table' },
            h(
              'table',
              { class: 'data' },
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  ['What', 'Type', 'Fetched', 'Size', ''].map((t) => h('th', { scope: 'col' }, t)),
                ),
              ),
              h('tbody', {}, rows),
            ),
          ),
      shown.length > SHOW_LIMIT &&
        h(
          'p',
          { class: 'muted small' },
          `Showing the newest ${SHOW_LIMIT} of ${shown.length}; use the filter to narrow the list.`,
        ),
    );
  }

  // Deletes everything this app stores, then reloads so no deleted data stays on screen.
  async function deleteEverything() {
    // Unpin first (the main process remembers pins) so nothing stays frozen after everything else is gone.
    if (isElectron()) {
      for (const item of Object.values(libraryStore.lib.items)) {
        if (item.pinned)
          for (const owner of ownersOf(item)) await window.api.setCachePinned(owner, false);
      }
    }
    libraryStore.clear();
    store.clearHistory();
    store.clearSessions();
    await cacheSource.remove('all');
    location.reload();
  }

  // Section: delete everything, with a confirmation step.
  function dangerSection() {
    return h(
      'section',
      { class: 'data-section danger' },
      h('h3', {}, 'Delete everything'),
      h(
        'p',
        { class: 'muted' },
        'Removes all history, saved sessions and cached lookups from this device, then reloads the app. Files you exported (CSV, sessions, images) are not touched.',
      ),
      confirming
        ? h(
            'div',
            { class: 'actions' },
            h('strong', {}, 'Really delete everything?'),
            h(
              'button',
              { class: 'btn danger', type: 'button', onclick: deleteEverything },
              'Yes, delete everything',
            ),
            h(
              'button',
              {
                class: 'btn secondary',
                type: 'button',
                onclick: () => {
                  confirming = false;
                  render();
                },
              },
              'Cancel',
            ),
          )
        : h(
            'button',
            {
              class: 'btn danger',
              type: 'button',
              onclick: () => {
                confirming = true;
                render();
              },
            },
            'Delete everything…',
          ),
    );
  }

  // Fetches the cache list and redraws the whole section.
  async function render() {
    let cached = { entries: [], totalBytes: 0, folder: null };
    try {
      cached = await cacheSource.list();
    } catch {
      // The section still works for history and sessions.
    }
    const where = isElectron()
      ? [
          'Stored in the app-data folder',
          cached.folder
            ? [' (cached lookups: ', h('span', { class: 'mono' }, cached.folder), ')']
            : '',
          ". History and saved sessions are kept in the app's local storage in the same folder. Use File → Show Data Folder to open it.",
        ]
      : "Stored in this browser's local storage for this site (large cached items are kept in memory only until you reload).";
    setChildren(
      container,
      h(
        'p',
        { class: 'note' },
        'PathwayScope keeps these items on this device so repeat lookups are fast and your work survives a restart. There are no accounts and no tracking. To look things up, the gene symbols and gene lists you enter ARE sent to the public Reactome, UniProt and NCBI services; nothing is sent anywhere else.',
      ),
      h('p', { class: 'muted small' }, where),
      historySection(),
      sessionsSection(),
      cacheSection(cached),
      dangerSection(),
    );
  }

  return {
    // Redraws the section with fresh data (called whenever the Settings view is shown).
    refresh() {
      confirming = false;
      filter = '';
      return render();
    },
  };
}

// Home (desktop app): your Library. Everything you have looked up (genes, pathways, analyses) as one card each, with its size,
// folders (nested, an item can be in several), pinning ("keep"), and one-click deletion of an item together with its stored data.
import { ageLabel, safeLocalStorage } from '../core/cache.js';
import {
  addToFolder,
  childFolders,
  computeUsage,
  createFolder,
  deleteFolder,
  folderPath,
  folderUsage,
  importHistory,
  listContents,
  ownerId,
  ownersOf,
  removeFromFolder,
  removeItem,
  renameFolder,
  setPinned,
  storageBreakdown,
  syncSessions,
} from '../core/library.js';
import { toast } from './cards.js';
import { formatBytes } from './dataManager.js';
import { confirmDialog, closeOnOutsideClick, promptDialog } from './dialogs.js';
import { debounce, h, setChildren } from './dom.js';
import { emit, libraryStore, store } from './state.js';

const TYPE_NAME = { gene: 'Gene', pathway: 'Pathway', analysis: 'Analysis' };
const IMPORTED_KEY = 'ps:library:history-imported';
const SORTS = { recent: 'Recently opened', size: 'Size (largest first)', name: 'Name (A to Z)' };

// Creates the Home view inside `root`. ctx: { navigateGene(symbol), openPathwayItem(stId), openAnalysis(id), go(mode) }.
export function createHomeView(root, ctx) {
  const ui = { folderId: null, filter: '', sort: 'recent', renderToken: 0 };

  // Reads everything Home needs: the library (kept in step with saved sessions), cached entries, and sizes.
  async function load() {
    const lib = libraryStore.lib;
    const sessions = store.listSessions();
    const before = JSON.stringify(lib);
    syncSessions(lib, sessions);
    const ls = safeLocalStorage();
    if (ls && !ls.getItem(IMPORTED_KEY)) {
      importHistory(lib, store.getHistory());
      try {
        ls.setItem(IMPORTED_KEY, '1');
      } catch {
        // Import will simply be repeated next time (it never overwrites).
      }
    }
    if (JSON.stringify(lib) !== before) libraryStore.save();
    let entries = [];
    try {
      const reply = await window.api.listCache();
      if (reply.ok) {
        entries = reply.entries;
        // Keep the cache layer's pins in step with the library (e.g. if the pins file was lost).
        for (const item of Object.values(lib.items)) {
          if (!item.pinned) continue;
          for (const owner of ownersOf(item)) {
            if (!reply.pinnedOwners.includes(owner)) await window.api.setCachePinned(owner, true);
          }
        }
      }
    } catch {
      // Home still works without the size information.
    }
    const sessionBytes = {};
    for (const s of sessions) {
      const full = store.getSession(s.id);
      sessionBytes[ownerId('analysis', s.id)] = full ? JSON.stringify(full).length : 0;
    }
    return {
      lib,
      entries,
      sessionBytes,
      usage: computeUsage(lib, entries, sessionBytes),
      breakdown: storageBreakdown(lib, entries, sessionBytes),
    };
  }

  // ---- actions -------------------------------------------------------------------------------------------------------
  const save = () => libraryStore.save();
  // Runs an action that may throw a friendly error, saves, and redraws.
  async function act(fn, message) {
    try {
      await fn();
      save();
      if (message) toast(message);
    } catch (error) {
      toast(error.message);
    }
    return render();
  }

  // Opens an item where it belongs: genes in Gene Explorer, pathways in the Pathway Browser, analyses in Enrichment.
  function openItem(item) {
    if (item.type === 'gene') ctx.navigateGene(item.key);
    else if (item.type === 'pathway') ctx.openPathwayItem(item.key);
    else ctx.openAnalysis(item.key);
  }

  // Pins/unpins an item: the main process keeps a pinned item's cached data as a frozen snapshot.
  async function togglePin(item) {
    const pinned = !item.pinned;
    for (const owner of ownersOf(item)) await window.api.setCachePinned(owner, pinned);
    await act(
      () => setPinned(libraryStore.lib, item.id, pinned),
      pinned ? `Pinned "${item.label}".` : `Unpinned "${item.label}".`,
    );
  }

  // Deletes an item together with the stored data only it needs (data other items use stays).
  async function removeItemAndData(item) {
    for (const owner of ownersOf(item)) await window.api.removeCacheOwner(owner);
    if (item.type === 'analysis') store.deleteSession(item.key);
    store.removeHistory(item.type, item.key);
    removeItem(libraryStore.lib, item.id);
  }

  async function deleteItem(item, data) {
    const u = data.usage.items[item.id];
    const ok = await confirmDialog({
      title: `Delete "${item.label}"?`,
      body: [
        h('p', {}, `This frees about ${formatBytes(u.own + u.session)} of stored data.`),
        u.shared > 0 &&
          h(
            'p',
            { class: 'muted' },
            `${formatBytes(u.shared)} is also used by other items and stays.`,
          ),
        item.type === 'analysis' &&
          h(
            'p',
            { class: 'note warn' },
            'The saved results of this analysis are deleted. You can run it again from your gene list only if you still have the list.',
          ),
        item.pinned && h('p', { class: 'note warn' }, 'This item is pinned.'),
        h(
          'p',
          { class: 'muted small' },
          'Folders are not affected. Anything you exported to a file is not touched.',
        ),
      ],
    });
    if (!ok) return;
    await act(async () => {
      await removeItemAndData(item);
      emit('history-changed');
      emit('sessions-changed');
    }, `Deleted "${item.label}".`);
  }

  // The "Folders..." pop-up: tick the folders an item should be filed in; folders can be created on the spot.
  function openFilingDialog(itemId) {
    const lib = libraryStore.lib;
    const item = lib.items[itemId];
    const dialog = h('dialog', { class: 'modal', 'aria-labelledby': 'filing-title' });
    const list = h('div', { class: 'filing-list' });
    const draw = () => {
      const rows = [];
      const walk = (parentId, depth) => {
        for (const f of childFolders(lib, parentId)) {
          rows.push(
            h(
              'label',
              { class: 'filing-row', style: { paddingLeft: `${depth * 18}px` } },
              h('input', {
                type: 'checkbox',
                checked: item.folderIds.includes(f.id) || undefined,
                onchange: (e) => {
                  if (e.target.checked) addToFolder(lib, item.id, f.id);
                  else removeFromFolder(lib, item.id, f.id);
                  save();
                },
              }),
              ' ',
              f.name,
            ),
          );
          walk(f.id, depth + 1);
        }
      };
      walk(null, 0);
      setChildren(
        list,
        rows.length ? rows : h('p', { class: 'muted' }, 'No folders yet. Create one below.'),
      );
    };
    const nameInput = h('input', {
      type: 'text',
      placeholder: 'New folder name',
      'aria-label': 'New folder name',
      maxlength: '60',
    });
    const parentSelect = h('select', { 'aria-label': 'Where to create the new folder' });
    const drawParents = () => {
      setChildren(parentSelect, h('option', { value: '' }, 'at the top level'));
      for (const f of Object.values(lib.folders).sort((a, b) =>
        folderPath(lib, a.id)
          .map((p) => p.name)
          .join('/')
          .localeCompare(
            folderPath(lib, b.id)
              .map((p) => p.name)
              .join('/'),
          ),
      )) {
        parentSelect.append(
          h(
            'option',
            { value: f.id },
            `inside ${folderPath(lib, f.id)
              .map((p) => p.name)
              .join(' / ')}`,
          ),
        );
      }
    };
    const message = h('p', { class: 'note warn', role: 'alert', hidden: true });
    const create = () => {
      try {
        const folder = createFolder(lib, nameInput.value, parentSelect.value || null);
        addToFolder(lib, item.id, folder.id);
        save();
        nameInput.value = '';
        message.hidden = true;
        draw();
        drawParents();
      } catch (error) {
        message.textContent = error.message;
        message.hidden = false;
      }
    };
    setChildren(
      dialog,
      h('h2', { id: 'filing-title' }, `Folders for "${item.label}"`),
      h(
        'p',
        { class: 'muted' },
        'An item can be in several folders. Removing it from a folder does not delete it.',
      ),
      list,
      h(
        'div',
        { class: 'filing-new' },
        nameInput,
        parentSelect,
        h('button', { class: 'btn secondary', type: 'button', onclick: create }, 'Create and add'),
      ),
      message,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Done'),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      render();
    });
    document.body.append(dialog);
    closeOnOutsideClick(dialog);
    draw();
    drawParents();
    dialog.showModal();
  }

  const newFolder = () =>
    promptDialog({
      title: 'New folder',
      label: ui.folderId ? 'Name (created inside the current folder)' : 'Name',
      confirmLabel: 'Create',
      onSubmit: (text) => {
        createFolder(libraryStore.lib, text, ui.folderId);
        save();
      },
    }).then((ok) => ok && render());
  const rename = (folder) =>
    promptDialog({
      title: `Rename "${folder.name}"`,
      label: 'New name',
      value: folder.name,
      confirmLabel: 'Rename',
      onSubmit: (text) => {
        renameFolder(libraryStore.lib, folder.id, text);
        save();
      },
    }).then((ok) => ok && render());

  async function removeFolder(folder, data) {
    const nested = childFolders(libraryStore.lib, folder.id).length;
    const usage = folderUsage(libraryStore.lib, data.usage, folder.id);
    const ok = await confirmDialog({
      title: `Delete the folder "${folder.name}"?`,
      confirmLabel: 'Delete folder',
      body: [
        h(
          'p',
          {},
          `${usage.items} item${usage.items === 1 ? '' : 's'} inside ${nested ? `and ${nested} sub-folder${nested === 1 ? '' : 's'} ` : ''}will NOT be deleted: they just won't be in this folder any more.`,
        ),
        h(
          'p',
          { class: 'muted small' },
          'To delete the stored data too, delete the items themselves.',
        ),
      ],
    });
    if (!ok) return;
    if (ui.folderId && folderPath(libraryStore.lib, ui.folderId).some((f) => f.id === folder.id))
      ui.folderId = folder.parentId;
    await act(
      () => deleteFolder(libraryStore.lib, folder.id),
      `Deleted the folder "${folder.name}".`,
    );
  }

  // "Free up space": deletes every unpinned item and all unsorted data; pinned items and shared data are kept.
  async function freeUpSpace(data) {
    const victims = Object.values(data.lib.items).filter((i) => !i.pinned);
    const itemBytes = victims.reduce(
      (n, i) => n + data.usage.items[i.id].own + data.usage.items[i.id].session,
      0,
    );
    const bytes = itemBytes + data.usage.unsorted.bytes;
    if (bytes === 0 && victims.length === 0) return toast('There is nothing to free up.');
    const kept = Object.values(data.lib.items).length - victims.length;
    const ok = await confirmDialog({
      title: 'Free up space?',
      confirmLabel: 'Delete unpinned items',
      body: [
        h(
          'p',
          {},
          `Deletes ${victims.length} unpinned item${victims.length === 1 ? '' : 's'} and ${data.usage.unsorted.count} unsorted cached item${data.usage.unsorted.count === 1 ? '' : 's'}, freeing about ${formatBytes(bytes)}.`,
        ),
        h(
          'p',
          { class: 'muted' },
          `${kept} pinned item${kept === 1 ? '' : 's'} and the shared data are kept. Saved analyses among the unpinned items are deleted.`,
        ),
      ],
    });
    if (!ok) return;
    await act(
      async () => {
        for (const item of victims) await removeItemAndData(item);
        for (const key of data.usage.unsorted.keys) await window.api.deleteCacheEntry(key);
        emit('history-changed');
        emit('sessions-changed');
      },
      `Freed about ${formatBytes(bytes)}.`,
    );
  }

  async function clearKeys(keys, what, data) {
    const bytes = keys.reduce((n, k) => n + (data.usage.entryBytes.get(k) ?? 0), 0);
    const ok = await confirmDialog({
      title: `Delete ${what}?`,
      confirmLabel: 'Delete',
      body: [
        h('p', {}, `Frees about ${formatBytes(bytes)}.`),
        h(
          'p',
          { class: 'muted' },
          what.startsWith('shared')
            ? 'This data is downloaded again the next time a lookup needs it (the pathway hierarchy is large, so that takes a moment).'
            : 'No library item uses this data. It can always be downloaded again.',
        ),
      ],
    });
    if (ok)
      await act(
        async () => {
          for (const key of keys) await window.api.deleteCacheEntry(key);
        },
        `Freed about ${formatBytes(bytes)}.`,
      );
  }

  // ---- cards ---------------------------------------------------------------------------------------------------------
  function itemCard(item, data) {
    const u = data.usage.items[item.id];
    const filed = item.folderIds.map((id) => data.lib.folders[id]).filter(Boolean);
    return h(
      'article',
      {
        class: `lib-card${item.pinned ? ' pinned' : ''}`,
        draggable: 'true',
        dataset: { id: item.id },
        ondragstart: (e) => {
          e.dataTransfer.setData('text/plain', item.id);
          e.dataTransfer.effectAllowed = 'copy';
        },
      },
      h(
        'div',
        { class: 'lib-card-head' },
        h('span', { class: `type-badge type-${item.type}` }, TYPE_NAME[item.type]),
        item.pinned &&
          h(
            'span',
            {
              class: 'pin-badge',
              title:
                'Pinned: its stored data is kept exactly as it is (a frozen snapshot, usable offline) and "Free up space" skips it.',
            },
            '★ Pinned',
          ),
      ),
      h(
        'h3',
        {},
        h(
          'button',
          { class: 'link-btn lib-open', type: 'button', onclick: () => openItem(item) },
          item.label,
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        `Last opened ${ageLabel(Date.parse(item.lastOpenedAt))} · `,
        h('strong', {}, formatBytes(u.own + u.session)),
        u.shared > 0 ? ` (+ ${formatBytes(u.shared)} also used by other items)` : '',
      ),
      filed.length > 0 &&
        h(
          'p',
          { class: 'small' },
          'In: ',
          filed.map((f) =>
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                onclick: () => {
                  ui.folderId = f.id;
                  ui.filter = '';
                  render();
                },
              },
              f.name,
            ),
          ),
        ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: () => openItem(item) },
          'Open',
        ),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            'aria-pressed': String(item.pinned),
            'aria-label': `${item.pinned ? 'Unpin' : 'Pin'} ${item.label}`,
            onclick: () => togglePin(item),
          },
          item.pinned ? 'Unpin' : 'Pin',
        ),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            'aria-label': `Folders for ${item.label}`,
            onclick: () => openFilingDialog(item.id),
          },
          'Folders…',
        ),
        ui.folderId &&
          item.folderIds.includes(ui.folderId) &&
          h(
            'button',
            {
              class: 'btn secondary',
              type: 'button',
              'aria-label': `Remove ${item.label} from this folder`,
              onclick: () =>
                act(
                  () => removeFromFolder(libraryStore.lib, item.id, ui.folderId),
                  'Removed from this folder.',
                ),
            },
            'Remove from this folder',
          ),
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            'aria-label': `Delete ${item.label}`,
            onclick: () => deleteItem(item, data),
          },
          'Delete',
        ),
      ),
    );
  }

  function folderCard(folder, data) {
    const usage = folderUsage(data.lib, data.usage, folder.id);
    const subs = childFolders(data.lib, folder.id).length;
    return h(
      'article',
      {
        class: 'folder-card',
        dataset: { folder: folder.id },
        ondragover: (e) => {
          e.preventDefault();
          e.currentTarget.classList.add('drop');
        },
        ondragleave: (e) => e.currentTarget.classList.remove('drop'),
        ondrop: (e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('drop');
          const id = e.dataTransfer.getData('text/plain');
          if (data.lib.items[id])
            act(
              () => addToFolder(libraryStore.lib, id, folder.id),
              `Filed "${data.lib.items[id].label}" in "${folder.name}".`,
            );
        },
      },
      h(
        'div',
        { class: 'lib-card-head' },
        h('span', { class: 'type-badge type-folder' }, 'Folder'),
      ),
      h(
        'h3',
        {},
        h(
          'button',
          {
            class: 'link-btn lib-open',
            type: 'button',
            onclick: () => {
              ui.folderId = folder.id;
              ui.filter = '';
              render();
            },
          },
          folder.name,
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        `${usage.items} item${usage.items === 1 ? '' : 's'}${subs ? ` · ${subs} sub-folder${subs === 1 ? '' : 's'}` : ''} · `,
        h('strong', {}, formatBytes(usage.bytes)),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            onclick: () => {
              ui.folderId = folder.id;
              ui.filter = '';
              render();
            },
          },
          'Open',
        ),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            'aria-label': `Rename folder ${folder.name}`,
            onclick: () => rename(folder),
          },
          'Rename',
        ),
        h(
          'button',
          {
            class: 'btn danger',
            type: 'button',
            'aria-label': `Delete folder ${folder.name}`,
            onclick: () => removeFolder(folder, data),
          },
          'Delete',
        ),
      ),
    );
  }

  // The storage bar: one bar, four honest groups, each also written out as text (never color alone).
  function storageCard(data) {
    const b = data.breakdown;
    const groups = [
      ['pinned', 'Pinned items', b.pinned],
      ['items', 'Other items', b.items],
      ['shared', 'Shared by every lookup', b.shared],
      ['unsorted', 'Unsorted (no item owns it)', b.unsorted],
    ];
    return h(
      'section',
      { class: 'card', 'aria-label': 'Storage' },
      h(
        'div',
        { class: 'row-between' },
        h('h2', {}, 'Storage'),
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: () => freeUpSpace(data) },
          'Free up space…',
        ),
      ),
      h(
        'p',
        {},
        h('strong', {}, formatBytes(b.total)),
        ` stored on this device for ${Object.keys(data.lib.items).length} item${Object.keys(data.lib.items).length === 1 ? '' : 's'}.`,
      ),
      b.total > 0 &&
        h(
          'div',
          {
            class: 'storage-bar',
            role: 'img',
            'aria-label': groups
              .map(([, name, bytes]) => `${name}: ${formatBytes(bytes)}`)
              .join('; '),
          },
          groups
            .filter(([, , bytes]) => bytes > 0)
            .map(([key, , bytes]) =>
              h('span', {
                class: `seg seg-${key}`,
                style: { width: `${Math.max(2, (bytes / b.total) * 100)}%` },
              }),
            ),
        ),
      h(
        'ul',
        { class: 'storage-legend' },
        groups.map(([key, name, bytes]) =>
          h(
            'li',
            {},
            h('span', { class: `swatch seg-${key}`, 'aria-hidden': 'true' }),
            ` ${name}: `,
            h('strong', {}, formatBytes(bytes)),
          ),
        ),
      ),
      h(
        'p',
        { class: 'muted small' },
        'Items are what you looked up; each shows the space only it needs. Data several items use is counted once here.',
      ),
    );
  }

  function quickStartCard() {
    const input = h('input', {
      type: 'text',
      id: 'home-gene',
      placeholder: 'Human gene symbol, e.g. TP53',
      maxlength: '30',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Look up a gene',
    });
    return h(
      'section',
      { class: 'card', 'aria-label': 'Quick start' },
      h('h2', {}, 'Start something new'),
      h(
        'form',
        {
          class: 'inline-form',
          onsubmit: (e) => {
            e.preventDefault();
            if (input.value.trim()) ctx.navigateGene(input.value.trim());
          },
        },
        input,
        h('button', { class: 'btn', type: 'submit' }, 'Look up gene'),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: () => ctx.go('enrichment') },
          'Analyze a gene list',
        ),
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: () => ctx.go('browser') },
          'Browse pathways',
        ),
      ),
    );
  }

  function libraryCard(data) {
    const lib = data.lib;
    const needle = ui.filter.trim().toLowerCase();
    const sortItems = (items) =>
      [...items].sort((a, b) =>
        ui.sort === 'size'
          ? data.usage.itemTotal(b.id) - data.usage.itemTotal(a.id)
          : ui.sort === 'name'
            ? a.label.localeCompare(b.label)
            : Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt),
      );
    let folders;
    let items;
    if (needle) {
      folders = Object.values(lib.folders)
        .filter((f) => f.name.toLowerCase().includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name));
      items = Object.values(lib.items).filter(
        (i) => i.label.toLowerCase().includes(needle) || i.key.toLowerCase().includes(needle),
      );
    } else {
      ({ folders, items } = listContents(lib, ui.folderId));
    }
    const path = folderPath(lib, ui.folderId);
    const crumbs = h(
      'nav',
      { class: 'crumbs-bar', 'aria-label': 'Folder path' },
      ui.folderId
        ? h(
            'button',
            {
              class: 'link-btn',
              type: 'button',
              onclick: () => {
                ui.folderId = null;
                render();
              },
            },
            'Library',
          )
        : h('strong', {}, 'Library'),
      path.map((f, i) => [
        ' / ',
        i === path.length - 1
          ? h('strong', {}, f.name)
          : h(
              'button',
              {
                class: 'link-btn',
                type: 'button',
                onclick: () => {
                  ui.folderId = f.id;
                  render();
                },
              },
              f.name,
            ),
      ]),
    );
    const filter = h('input', {
      type: 'search',
      placeholder: 'Search your library…',
      'aria-label': 'Search your library',
      value: ui.filter,
      oninput: debounce((e) => {
        ui.filter = e.target.value;
        render().then(() => root.querySelector('input[aria-label="Search your library"]')?.focus());
      }, 200),
    });
    const sort = h(
      'select',
      {
        'aria-label': 'Sort items',
        onchange: (e) => {
          ui.sort = e.target.value;
          render();
        },
      },
      Object.entries(SORTS).map(([value, label]) =>
        h('option', { value, selected: ui.sort === value || undefined }, label),
      ),
    );
    const total = Object.keys(lib.items).length;
    return h(
      'section',
      { class: 'card', 'aria-label': 'Library' },
      h(
        'div',
        { class: 'row-between' },
        h('h2', {}, needle ? 'Search results' : ui.folderId ? path.at(-1).name : 'Library'),
        h('button', { class: 'btn', type: 'button', onclick: newFolder }, 'New folder'),
      ),
      !needle && crumbs,
      h('div', { class: 'toolbar' }, filter, sort),
      !needle &&
        !ui.folderId &&
        items.length > 0 &&
        h(
          'p',
          { class: 'muted small' },
          'Items that are not in any folder. Drag an item onto a folder to file it there.',
        ),
      folders.length + items.length === 0
        ? h(
            'div',
            { class: 'state empty' },
            total === 0
              ? 'Nothing here yet. Look up a gene, run an analysis or open a pathway, and it will appear here.'
              : needle
                ? 'Nothing matches your search.'
                : ui.folderId
                  ? 'This folder is empty. Drag items here, or use "Folders…" on an item.'
                  : 'Everything you have is filed in folders.',
          )
        : h(
            'div',
            { class: 'lib-grid' },
            folders.map((f) => folderCard(f, data)),
            sortItems(items).map((i) => itemCard(i, data)),
          ),
    );
  }

  function otherDataCard(data) {
    const { shared, unsorted } = data.usage;
    if (shared.count === 0 && unsorted.count === 0) return null;
    return h(
      'details',
      { class: 'card other-data' },
      h('summary', {}, `Shared and unsorted data (${formatBytes(shared.bytes + unsorted.bytes)})`),
      h(
        'div',
        { class: 'row-between' },
        h(
          'p',
          {},
          h('strong', {}, `Shared by every lookup: ${formatBytes(shared.bytes)}`),
          ` (${shared.count} item${shared.count === 1 ? '' : 's'}: the pathway hierarchy and Reactome release information)`,
        ),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            disabled: shared.count === 0,
            onclick: () => clearKeys(shared.keys, 'shared data', data),
          },
          'Delete shared data',
        ),
      ),
      h(
        'div',
        { class: 'row-between' },
        h(
          'p',
          {},
          h('strong', {}, `Unsorted: ${formatBytes(unsorted.bytes)}`),
          ` (${unsorted.count} cached item${unsorted.count === 1 ? '' : 's'} no library item owns, for example example lists or data from older versions)`,
        ),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            disabled: unsorted.count === 0,
            onclick: () => clearKeys(unsorted.keys, 'unsorted data', data),
          },
          'Delete unsorted data',
        ),
      ),
    );
  }

  function recentStrip(data) {
    const recent = Object.values(data.lib.items)
      .sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt))
      .slice(0, 6);
    if (recent.length === 0) return null;
    return h(
      'section',
      { class: 'card', 'aria-label': 'Recent' },
      h('h2', {}, 'Recent'),
      h(
        'ul',
        { class: 'chips' },
        recent.map((i) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                title: `${TYPE_NAME[i.type]} · ${ageLabel(Date.parse(i.lastOpenedAt))}`,
                onclick: () => openItem(i),
              },
              `${TYPE_NAME[i.type]}: ${i.label}`,
            ),
          ),
        ),
      ),
    );
  }

  // The heading and the quick-start box are created once and never redrawn, so text you are typing is never wiped.
  const dynamic = h('div', { class: 'home-dynamic' });
  setChildren(root, h('h1', {}, 'Home'), quickStartCard(), dynamic);

  // Draws the cards below the quick-start box (the latest call wins if several overlap).
  async function render() {
    const token = ++ui.renderToken;
    const data = await load();
    if (token !== ui.renderToken) return;
    setChildren(
      dynamic,
      storageCard(data),
      recentStrip(data),
      libraryCard(data),
      otherDataCard(data),
    );
  }

  return {
    // Called whenever Home is shown: reloads sizes and the library so nothing is stale.
    show() {
      ui.folderId = ui.folderId && libraryStore.lib.folders[ui.folderId] ? ui.folderId : null;
      return render();
    },
  };
}

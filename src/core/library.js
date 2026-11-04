// The Library: things the user has looked up (genes, pathways, analyses), the folders they are filed in, and which cached
// responses belong to which item. Pure data functions (they change the object they are given) so they are easy to test.

export const LIBRARY_VERSION = 1;
export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDERS = 500;
export const MAX_ITEMS = 5000;
const MAX_NAME = 60;

// Owner ids look like "gene:TP53", "pathway:R-HSA-69541" or "analysis:<session id>"; they tag cached responses.
export const OWNER_PATTERN = /^(gene|pathway|analysis):[A-Za-z0-9._:-]{1,64}$/;

// Error with a message that is safe to show the user.
export class LibraryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LibraryError';
  }
}

// Builds the owner id for a thing (gene symbols are upper-cased so TP53 and tp53 are the same item).
export const ownerId = (type, key) =>
  `${type}:${type === 'gene' ? String(key).toUpperCase() : String(key)}`;

// Creates an empty library.
export const emptyLibrary = () => ({ version: LIBRARY_VERSION, items: {}, folders: {} });

// Throws a LibraryError unless the condition holds.
function must(condition, message) {
  if (!condition) throw new LibraryError(message);
}

// Every owner id that refers to an item: its own id plus one per gene alias (e.g. HER2 for ERBB2).
export const ownersOf = (item) => [item.id, ...(item.aliases ?? []).map((a) => ownerId('gene', a))];

// Finds the item an owner id refers to (directly, or through a gene alias); undefined if none.
export function findItemByOwner(lib, owner) {
  if (lib.items[owner]) return lib.items[owner];
  return Object.values(lib.items).find(
    (item) =>
      item.type === 'gene' && (item.aliases ?? []).some((a) => ownerId('gene', a) === owner),
  );
}

// Creates an item, or refreshes its label/aliases/last-opened time if it already exists. Returns the item.
export function upsertItem(lib, { type, key, label, aliases = [], createdAt }, now = new Date()) {
  must(['gene', 'pathway', 'analysis'].includes(type), 'Unknown item type.');
  const id = ownerId(type, key);
  must(OWNER_PATTERN.test(id), 'Invalid item key.');
  const stamp = now.toISOString();
  let item = lib.items[id];
  if (!item) {
    must(
      Object.keys(lib.items).length < MAX_ITEMS,
      'The library is full; delete some items first.',
    );
    item = {
      id,
      type,
      key: type === 'gene' ? String(key).toUpperCase() : String(key),
      label,
      aliases: [],
      createdAt: createdAt ?? stamp,
      lastOpenedAt: stamp,
      pinned: false,
      folderIds: [],
    };
    lib.items[id] = item;
  }
  item.label = label || item.label;
  item.lastOpenedAt = stamp;
  const known = new Set(item.aliases.map((a) => a.toUpperCase()));
  for (const alias of aliases) {
    const up = String(alias).toUpperCase();
    if (up !== item.key && !known.has(up) && /^[A-Z0-9._@-]{1,30}$/.test(up)) {
      item.aliases.push(up);
      known.add(up);
    }
  }
  return item;
}

// Removes an item from the library (its cached data is deleted separately). Returns the removed item or undefined.
export function removeItem(lib, itemId) {
  const item = lib.items[itemId];
  delete lib.items[itemId];
  return item;
}

// Pins or unpins an item ("keep": never swept away by clean-up and served from the cache as a frozen snapshot).
export function setPinned(lib, itemId, pinned) {
  must(lib.items[itemId], 'Unknown item.');
  lib.items[itemId].pinned = Boolean(pinned);
}

// Validates and normalizes a folder name.
function cleanName(name) {
  const text = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  must(text.length >= 1, 'Please enter a folder name.');
  must(text.length <= MAX_NAME, `Folder names can be at most ${MAX_NAME} characters.`);
  must(![...text].some((c) => c < ' '), 'That folder name has invalid characters.');
  return text;
}

// Folders directly inside a parent (null = top level), sorted by name.
export const childFolders = (lib, parentId = null) =>
  Object.values(lib.folders)
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));

// The chain of folders from the top level down to this folder (empty for the top level).
export function folderPath(lib, folderId) {
  const path = [];
  for (let id = folderId; id; id = lib.folders[id]?.parentId ?? null) {
    must(path.length <= MAX_FOLDER_DEPTH + 1, 'The folder structure is too deep.');
    if (!lib.folders[id]) break;
    path.unshift(lib.folders[id]);
  }
  return path;
}

// Ids of a folder and every folder nested inside it.
export function folderAndDescendants(lib, folderId) {
  const ids = [folderId];
  for (let i = 0; i < ids.length; i += 1) for (const f of childFolders(lib, ids[i])) ids.push(f.id);
  return ids;
}

// Creates a folder (optionally inside another one). Names must be unique among siblings.
export function createFolder(lib, name, parentId = null, now = new Date()) {
  const clean = cleanName(name);
  must(parentId === null || lib.folders[parentId], 'The parent folder does not exist.');
  must(Object.keys(lib.folders).length < MAX_FOLDERS, 'Too many folders.');
  must(
    folderPath(lib, parentId).length < MAX_FOLDER_DEPTH,
    `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`,
  );
  must(
    !childFolders(lib, parentId).some((f) => f.name.toLowerCase() === clean.toLowerCase()),
    'A folder with that name already exists here.',
  );
  const id = `f-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  lib.folders[id] = { id, name: clean, parentId, createdAt: now.toISOString() };
  return lib.folders[id];
}

// Renames a folder.
export function renameFolder(lib, folderId, name) {
  const folder = lib.folders[folderId];
  must(folder, 'Unknown folder.');
  const clean = cleanName(name);
  must(
    !childFolders(lib, folder.parentId).some(
      (f) => f.id !== folderId && f.name.toLowerCase() === clean.toLowerCase(),
    ),
    'A folder with that name already exists here.',
  );
  folder.name = clean;
}

// Moves a folder (with everything inside it) into another folder or to the top level; refuses loops and too-deep trees.
export function moveFolder(lib, folderId, newParentId = null) {
  const folder = lib.folders[folderId];
  must(folder, 'Unknown folder.');
  must(newParentId === null || lib.folders[newParentId], 'The destination folder does not exist.');
  const inside = folderAndDescendants(lib, folderId);
  must(
    newParentId === null || !inside.includes(newParentId),
    'A folder cannot be moved into itself.',
  );
  const depthBelow =
    Math.max(...inside.map((id) => folderPath(lib, id).length)) - folderPath(lib, folderId).length;
  must(
    folderPath(lib, newParentId).length + 1 + depthBelow <= MAX_FOLDER_DEPTH,
    `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep.`,
  );
  must(
    !childFolders(lib, newParentId).some(
      (f) => f.id !== folderId && f.name.toLowerCase() === folder.name.toLowerCase(),
    ),
    'A folder with that name already exists there.',
  );
  folder.parentId = newParentId;
}

// Deletes a folder and the folders inside it. Items are NOT deleted: they just lose that filing (they may be in other folders).
export function deleteFolder(lib, folderId) {
  must(lib.folders[folderId], 'Unknown folder.');
  const ids = folderAndDescendants(lib, folderId);
  let itemsAffected = 0;
  for (const item of Object.values(lib.items)) {
    const before = item.folderIds.length;
    item.folderIds = item.folderIds.filter((id) => !ids.includes(id));
    if (item.folderIds.length !== before) itemsAffected += 1;
  }
  ids.forEach((id) => delete lib.folders[id]);
  return { foldersRemoved: ids.length, itemsAffected };
}

// Files an item in a folder (an item can be in several folders).
export function addToFolder(lib, itemId, folderId) {
  must(lib.items[itemId], 'Unknown item.');
  must(lib.folders[folderId], 'Unknown folder.');
  if (!lib.items[itemId].folderIds.includes(folderId)) lib.items[itemId].folderIds.push(folderId);
}

// Takes an item out of one folder (the item itself stays in the library).
export function removeFromFolder(lib, itemId, folderId) {
  must(lib.items[itemId], 'Unknown item.');
  lib.items[itemId].folderIds = lib.items[itemId].folderIds.filter((id) => id !== folderId);
}

// What to show for one place: its sub-folders and its items (null = top level: top-level folders plus items filed nowhere).
export function listContents(lib, folderId = null) {
  const items = Object.values(lib.items).filter((item) =>
    folderId === null ? item.folderIds.length === 0 : item.folderIds.includes(folderId),
  );
  return { folders: childFolders(lib, folderId), items };
}

// Ids of the items filed in a folder or in any folder nested inside it.
export function itemIdsInFolderTree(lib, folderId) {
  const ids = new Set(folderAndDescendants(lib, folderId));
  return new Set(
    Object.values(lib.items)
      .filter((item) => item.folderIds.some((f) => ids.has(f)))
      .map((item) => item.id),
  );
}

// Works out how much space each item uses. `entries` are cached responses ({key, bytes, kind, owners}); `sessionBytes` maps
// an analysis item id to the size of its saved session. Data owned by one item counts as "own"; data several items use counts
// as "shared with others"; data every lookup needs (kind "shared") and data nobody owns are reported separately.
export function computeUsage(lib, entries, sessionBytes = {}) {
  const items = {};
  const entryBytes = new Map();
  const shared = { bytes: 0, count: 0, keys: [] };
  const unsorted = { bytes: 0, count: 0, keys: [] };
  for (const item of Object.values(lib.items))
    items[item.id] = { own: 0, shared: 0, session: sessionBytes[item.id] ?? 0, keys: [] };
  for (const e of entries) {
    entryBytes.set(e.key, e.bytes);
    if (e.kind === 'shared') {
      shared.bytes += e.bytes;
      shared.count += 1;
      shared.keys.push(e.key);
      continue;
    }
    const owning = new Set(
      (e.owners ?? []).map((o) => findItemByOwner(lib, o)?.id).filter(Boolean),
    );
    if (owning.size === 0) {
      unsorted.bytes += e.bytes;
      unsorted.count += 1;
      unsorted.keys.push(e.key);
      continue;
    }
    for (const id of owning) {
      items[id][owning.size === 1 ? 'own' : 'shared'] += e.bytes;
      items[id].keys.push(e.key);
    }
  }
  const total = (u) => u.own + u.shared + u.session;
  const totalBytes =
    entries.reduce((n, e) => n + e.bytes, 0) +
    Object.values(sessionBytes).reduce((n, b) => n + b, 0);
  return { items, shared, unsorted, entryBytes, totalBytes, itemTotal: (id) => total(items[id]) };
}

// Size of a folder: the distinct cached responses and sessions of every item inside it (counted once even if several items share them).
export function folderUsage(lib, usage, folderId) {
  const ids = itemIdsInFolderTree(lib, folderId);
  const keys = new Set();
  let session = 0;
  for (const id of ids) {
    usage.items[id]?.keys.forEach((k) => keys.add(k));
    session += usage.items[id]?.session ?? 0;
  }
  let bytes = session;
  for (const k of keys) bytes += usage.entryBytes.get(k) ?? 0;
  return { items: ids.size, bytes };
}

// Splits all stored bytes into four honest groups for the storage bar: data of pinned items, data of other items, data every lookup
// shares (hierarchy, release info), and data no library item owns. Every cached response and session is counted exactly once.
export function storageBreakdown(lib, entries, sessionBytes = {}) {
  const out = { pinned: 0, items: 0, shared: 0, unsorted: 0, total: 0 };
  for (const e of entries) {
    let group;
    if (e.kind === 'shared') group = 'shared';
    else {
      const owning = (e.owners ?? []).map((o) => findItemByOwner(lib, o)).filter(Boolean);
      group = owning.length === 0 ? 'unsorted' : owning.some((i) => i.pinned) ? 'pinned' : 'items';
    }
    out[group] += e.bytes;
    out.total += e.bytes;
  }
  for (const [id, bytes] of Object.entries(sessionBytes)) {
    out[lib.items[id]?.pinned ? 'pinned' : 'items'] += bytes;
    out.total += bytes;
  }
  return out;
}

// Makes the library match the saved sessions: adds an analysis item for each session that has none (never overwriting an
// existing item) and drops analysis items whose session was deleted.
export function syncSessions(lib, sessions) {
  const live = new Set();
  for (const s of sessions) {
    const id = ownerId('analysis', s.id);
    live.add(id);
    if (!lib.items[id])
      upsertItem(
        lib,
        { type: 'analysis', key: s.id, label: `Analysis of ${s.label}`, createdAt: s.createdAt },
        new Date(s.createdAt),
      );
  }
  for (const item of Object.values(lib.items))
    if (item.type === 'analysis' && !live.has(item.id)) delete lib.items[item.id];
}

// One-time import of the older History list (genes and pathways) so existing users see something on Home.
export function importHistory(lib, history, now = new Date()) {
  for (const h of [...history].reverse()) {
    if (h.type !== 'gene' && h.type !== 'pathway') continue;
    const id = ownerId(h.type, h.key);
    if (!OWNER_PATTERN.test(id) || lib.items[id]) continue;
    // History labels read "Gene TP53"; the Library shows the type as a badge, so a gene's label is just its symbol.
    const label = h.type === 'gene' ? String(h.key).toUpperCase() : h.label;
    const item = upsertItem(
      lib,
      { type: h.type, key: h.key, label, createdAt: h.at },
      new Date(h.at ?? now),
    );
    item.lastOpenedAt = h.at ?? item.lastOpenedAt;
  }
}

// Checks that loaded JSON looks like a library; returns a clean copy or an empty library if it does not.
export function parseLibrary(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      !data ||
      data.version !== LIBRARY_VERSION ||
      typeof data.items !== 'object' ||
      typeof data.folders !== 'object'
    )
      return emptyLibrary();
    const lib = emptyLibrary();
    for (const [id, f] of Object.entries(data.folders)) {
      if (
        f &&
        typeof f.name === 'string' &&
        f.id === id &&
        (f.parentId === null || typeof f.parentId === 'string')
      )
        lib.folders[id] = {
          id,
          name: f.name.slice(0, MAX_NAME),
          parentId: f.parentId,
          createdAt: String(f.createdAt ?? ''),
        };
    }
    for (const [id, i] of Object.entries(data.items)) {
      if (
        i &&
        i.id === id &&
        OWNER_PATTERN.test(id) &&
        ['gene', 'pathway', 'analysis'].includes(i.type) &&
        typeof i.label === 'string'
      ) {
        lib.items[id] = {
          id,
          type: i.type,
          key: String(i.key),
          label: i.label.slice(0, 200),
          aliases: Array.isArray(i.aliases)
            ? i.aliases.filter((a) => typeof a === 'string').slice(0, 10)
            : [],
          createdAt: String(i.createdAt ?? ''),
          lastOpenedAt: String(i.lastOpenedAt ?? ''),
          pinned: i.pinned === true,
          folderIds: Array.isArray(i.folderIds) ? i.folderIds.filter((f) => lib.folders[f]) : [],
        };
      }
    }
    for (const f of Object.values(lib.folders))
      if (f.parentId !== null && !lib.folders[f.parentId]) f.parentId = null; // repair orphans
    return lib;
  } catch {
    return emptyLibrary();
  }
}

// Creates the persistent library (localStorage-like storage, injectable for tests). `lib` is the live object.
export function createLibraryStore(storage, key = 'ps:library') {
  let lib = emptyLibrary();
  try {
    const raw = storage?.getItem(key);
    if (raw) lib = parseLibrary(raw);
  } catch {
    lib = emptyLibrary();
  }
  return {
    get lib() {
      return lib;
    },
    // Writes the library; returns false if storage is full or blocked.
    save() {
      try {
        storage.setItem(key, JSON.stringify(lib));
        return true;
      } catch {
        return false;
      }
    },
    // Forgets everything (used by "Delete everything").
    clear() {
      lib = emptyLibrary();
      try {
        storage?.removeItem(key);
      } catch {
        // Nothing to do if storage is unavailable.
      }
    },
  };
}

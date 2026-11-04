// Remembers recent searches (history) and analysis sessions in localStorage (try/catch everywhere; capped sizes).
import { safeLocalStorage } from './cache.js';

const KEYS = {
  history: 'ps:history',
  index: 'ps:sessions:index',
  session: (id) => `ps:session:${id}`,
};
export const LIMITS = { history: 30, sessions: 15 };

// Creates a store over any Storage-like object (injectable for tests).
export function createStore(storage = safeLocalStorage(), now = () => new Date()) {
  const read = (key, fallback) => {
    try {
      const raw = storage?.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  // Writes JSON; returns false if storage is blocked or full.
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };
  const remove = (key) => {
    try {
      storage?.removeItem(key);
    } catch {
      // Nothing to do if storage is unavailable.
    }
  };

  // Lists history entries, newest first.
  const getHistory = () => read(KEYS.history, []);

  // Adds a history entry (type: 'gene' | 'analysis' | 'pathway'), de-duplicating by type+key.
  function addHistory({ type, key, label }) {
    const entry = { type, key, label, at: now().toISOString() };
    const list = [entry, ...getHistory().filter((h) => !(h.type === type && h.key === key))].slice(
      0,
      LIMITS.history,
    );
    write(KEYS.history, list);
    return list;
  }

  const clearHistory = () => remove(KEYS.history);

  // Lists saved session summaries (newest first) from the small index.
  const listSessions = () => read(KEYS.index, []);

  // Saves a full session; evicts the oldest when over the cap or when storage is full. Returns true if stored.
  function saveSession(session) {
    const meta = {
      id: session.id,
      createdAt: session.createdAt,
      label: `${session.inputIdentifiers.length} identifiers`,
      rows: session.rows.length,
      dataVersion: session.dataVersion,
    };
    let index = [meta, ...listSessions().filter((s) => s.id !== session.id)];
    while (index.length > LIMITS.sessions) remove(KEYS.session(index.pop().id));
    for (;;) {
      if (write(KEYS.session(session.id), session)) {
        write(KEYS.index, index);
        return true;
      }
      const victim = index.filter((s) => s.id !== session.id).pop();
      if (!victim) return false; // Even a lone session does not fit.
      index = index.filter((s) => s.id !== victim.id);
      remove(KEYS.session(victim.id));
    }
  }

  const getSession = (id) => read(KEYS.session(id), null);

  function deleteSession(id) {
    remove(KEYS.session(id));
    write(
      KEYS.index,
      listSessions().filter((s) => s.id !== id),
    );
  }

  return {
    getHistory,
    addHistory,
    clearHistory,
    listSessions,
    saveSession,
    getSession,
    deleteSession,
  };
}

// Shared app state: current analysis session, lazy hierarchy, found-gene cache, and a tiny event bus.
import { createStore } from '../core/sessionStore.js';
import {
  fetchFoundDetails,
  refreshSessionIfExpired,
  TokenExpiredError,
} from '../core/reactomeAnalysis.js';
import { getHierarchy } from '../core/reactomeContent.js';

const bus = new EventTarget();
export const store = createStore();
export const state = { session: null, hierarchyPromise: null, foundCache: new Map() };

// Emits a named event with a payload.
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

// Subscribes to a named event; returns an unsubscribe function.
export function on(type, fn) {
  const handler = (e) => fn(e.detail);
  bus.addEventListener(type, handler);
  return () => bus.removeEventListener(type, handler);
}

// Loads the pathway hierarchy once (shared by all views); a failure is not cached so a retry works.
export function getHierarchyOnce() {
  if (!state.hierarchyPromise) {
    state.hierarchyPromise = getHierarchy().catch((error) => {
      state.hierarchyPromise = null;
      throw error;
    });
  }
  return state.hierarchyPromise;
}

let saveTimer;
// Saves the current session to localStorage shortly after the last change (found-gene lists are added lazily).
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (state.session) store.saveSession(state.session);
  }, 800);
}

// Makes a session the active one (optionally saving it) and tells every view.
export function setSession(session, { persist = true } = {}) {
  state.session = session;
  if (session && persist) {
    store.saveSession(session);
    store.addHistory({
      type: 'analysis',
      key: session.id,
      label: `Analysis of ${session.inputIdentifiers.length} identifiers`,
    });
  }
  emit('session', session);
  emit('sessions-changed');
}

// Upper-cased identifiers the user typed (for matching participants by symbol).
export const userIdentifierSet = () =>
  new Set((state.session?.inputIdentifiers ?? []).map((id) => id.toUpperCase()));

// Loads (and caches) which of the user's identifiers matched a pathway, re-running the analysis once if the token expired.
export async function loadFound(stId, options = {}) {
  const session = state.session;
  if (!session) return null;
  const key = `${session.reactomeToken}|${stId}`;
  if (state.foundCache.has(key)) return state.foundCache.get(key);
  let details;
  try {
    details = await fetchFoundDetails(session.reactomeToken, stId, options);
  } catch (error) {
    if (!(error instanceof TokenExpiredError)) throw error;
    const { session: renewed } = await refreshSessionIfExpired(
      { ...session, reactomeToken: null },
      options,
    );
    setSession(renewed);
    details = await fetchFoundDetails(renewed.reactomeToken, stId, options);
  }
  const live = state.session;
  state.foundCache.set(`${live.reactomeToken}|${stId}`, details);
  const row = live.rows.find((r) => r.stId === stId);
  if (row && row.foundIdentifiers === null) {
    row.foundIdentifiers = details.map((d) => d.id);
    persistSoon();
  }
  return details;
}

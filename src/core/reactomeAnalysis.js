// Reactome Analysis Service client: submit a gene list (POST), page through results, found genes, unmapped identifiers, re-run.
import { TTL } from './cache.js';
import { getJson, HttpError } from './http.js';
import { getDatabaseInfo } from './reactomeContent.js';
import { compareRows, foundRatio, significanceBucket } from './stats.js';

export const ANALYSIS_BASE = 'https://reactome.org/AnalysisService';
const PAGE_SIZE = 500;
const NOT_FOUND_PAGE_SIZE = 500;
const MAX_PAGES = 50; // Safety stop so a misbehaving server cannot loop forever.

export const DEFAULT_PARAMETERS = {
  projectToHuman: true,
  includeInteractors: false,
  includeDisease: true,
  minSize: null,
  maxSize: null,
};

// Error raised when a token no longer exists on Reactome's side (tokens live about 7 days).
export class TokenExpiredError extends Error {
  constructor() {
    super('The Reactome analysis token has expired.');
    this.name = 'TokenExpiredError';
  }
}

// Reactome tokens are base64 text; anything else makes the server answer HTTP 500, so we never send malformed ones.
export const isWellFormedToken = (token) =>
  typeof token === 'string' && /^[A-Za-z0-9+/]{8,100}={0,2}$/.test(token);

// Makes a unique id for a session (crypto.randomUUID when available).
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Maps one Reactome pathway result to the app's EnrichmentRow (our ratio = found/total; Reactome's own ratio is vs. the whole background).
export function toEnrichmentRow(p) {
  const found = p.entities.found;
  const total = p.entities.total;
  return {
    stId: p.stId,
    name: p.name,
    entitiesFound: found,
    entitiesTotal: total,
    ratio: foundRatio(found, total) ?? 0,
    pValue: p.entities.pValue,
    fdr: p.entities.fdr,
    significance: significanceBucket(p.entities.fdr) ?? 'none',
    foundIdentifiers: null,
  };
}

// Builds the query string for fetching results of a token with the user's filters (FDR cutoff is applied in the UI, not here).
function resultQuery(parameters, page) {
  const q = new URLSearchParams({
    pageSize: String(PAGE_SIZE),
    page: String(page),
    sortBy: 'ENTITIES_FDR',
    order: 'ASC',
    resource: 'TOTAL',
    species: '9606',
    pValue: '1',
    includeDisease: String(parameters.includeDisease),
  });
  if (parameters.minSize !== null) q.set('min', String(parameters.minSize));
  if (parameters.maxSize !== null) q.set('max', String(parameters.maxSize));
  return q.toString();
}

// Submits the identifier list; returns Reactome's summary (token, pathwaysFound, identifiersNotFound) and its first result.
export async function submitAnalysis(identifiers, parameters, options = {}) {
  const base = parameters.projectToHuman ? 'identifiers/projection' : 'identifiers/';
  const query = new URLSearchParams({
    interactors: String(parameters.includeInteractors),
    pageSize: '1',
    page: '1',
    sortBy: 'ENTITIES_FDR',
    order: 'ASC',
    resource: 'TOTAL',
    species: '9606',
  });
  // A "#" first line is Reactome's header line (it names the sample and avoids its "Missing header" warning).
  const body = `#PathwayScope\n${identifiers.join('\n')}`;
  const data = await getJson(`${ANALYSIS_BASE}/${base}?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
    ttl: TTL.analysisSeconds,
    timeoutMs: 60_000,
    ...options,
  });
  if (!data?.summary?.token) throw new Error('Reactome did not return an analysis token.');
  return data;
}

// Downloads every page of pathway results for a token, applying disease/size filters; throws TokenExpiredError on 404.
export async function fetchAllResults(token, parameters, options = {}) {
  if (!isWellFormedToken(token)) throw new TokenExpiredError();
  const rows = [];
  let pathwaysFound = 0;
  let sample = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    let data;
    try {
      data = await getJson(
        `${ANALYSIS_BASE}/token/${encodeURIComponent(token)}?${resultQuery(parameters, page)}`,
        { ttl: TTL.analysisSeconds, timeoutMs: 60_000, ...options },
      );
    } catch (error) {
      if (error instanceof HttpError && error.kind === 'http' && error.status === 404)
        throw new TokenExpiredError();
      throw error;
    }
    pathwaysFound = data.pathwaysFound ?? pathwaysFound;
    const batch = data.pathways ?? [];
    if (!sample && batch.length) sample = batch[0].entities;
    rows.push(...batch.map(toEnrichmentRow));
    if (batch.length < PAGE_SIZE || rows.length >= pathwaysFound) break;
  }
  return { rows, pathwaysFound, sample };
}

// Lists the identifiers Reactome could not map (pages through the endpoint; returns the ids exactly as submitted).
export async function fetchUnmapped(token, options = {}) {
  const ids = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await getJson(
      `${ANALYSIS_BASE}/token/${encodeURIComponent(token)}/notFound?pageSize=${NOT_FOUND_PAGE_SIZE}&page=${page}`,
      { ttl: TTL.analysisSeconds, ...options },
    );
    const list = Array.isArray(batch) ? batch : [];
    ids.push(...list.map((x) => x.id));
    if (list.length < NOT_FOUND_PAGE_SIZE) break;
  }
  return ids;
}

// Loads the user's identifiers that matched one pathway: [{ id (as typed), uniprot: [mapped accessions] }].
export async function fetchFoundDetails(token, stId, options = {}) {
  if (!isWellFormedToken(token)) throw new TokenExpiredError();
  try {
    const data = await getJson(
      `${ANALYSIS_BASE}/token/${encodeURIComponent(token)}/found/entities/${encodeURIComponent(stId)}`,
      { ttl: TTL.analysisSeconds, ...options },
    );
    return (data?.identifiers ?? []).map((i) => ({
      id: i.id,
      uniprot: (i.mapsTo ?? []).filter((m) => m.resource === 'UNIPROT').flatMap((m) => m.ids ?? []),
    }));
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'http' && error.status === 404)
      throw new TokenExpiredError();
    throw error;
  }
}

// Loads just the identifiers (as the user typed them) that matched one pathway, e.g. ["Her2", "TP53"].
export async function fetchFoundIdentifiers(token, stId, options = {}) {
  return (await fetchFoundDetails(token, stId, options)).map((i) => i.id);
}

// Derives the background size Reactome used: pathway total / Reactome's own ratio (an inference, labeled as derived in the UI).
export function deriveBackgroundSize(sample) {
  if (!sample || !(sample.total > 0) || !(sample.ratio > 0)) return null;
  const size = sample.total / sample.ratio;
  return Number.isFinite(size) ? Math.round(size) : null;
}

// Runs a complete analysis and returns an AnalysisSession (rows stored in full so it can be viewed offline).
export async function runAnalysis(
  identifiers,
  parameters = DEFAULT_PARAMETERS,
  { onProgress, sessionId, ...callerOptions } = {},
) {
  const params = { ...DEFAULT_PARAMETERS, ...parameters };
  // Every cached response of this analysis is tagged with its session id so "Home" can group, size and delete it as one item.
  const id = sessionId ?? newId();
  const options = {
    ...callerOptions,
    owners: [...new Set([...(callerOptions.owners ?? []), `analysis:${id}`])],
  };
  onProgress?.(`Submitting ${identifiers.length} identifiers to Reactome…`);
  const submitted = await submitAnalysis(identifiers, params, options);
  const token = decodeURIComponent(submitted.summary.token);
  onProgress?.('Downloading pathway results…');
  const [results, unmapped, info] = await Promise.all([
    fetchAllResults(token, params, options),
    fetchUnmapped(token, options),
    getDatabaseInfo(options).catch(() => null),
  ]);
  return {
    id,
    createdAt: new Date().toISOString(),
    inputIdentifiers: [...identifiers],
    unmappedIdentifiers: unmapped,
    parameters: params,
    reactomeToken: token,
    rows: [...results.rows].sort(compareRows),
    dataVersion: info?.releaseNumber ? String(info.releaseNumber) : null,
    backgroundEntities: deriveBackgroundSize(results.sample),
    pathwaysTested: Number.isInteger(submitted.pathwaysFound) ? submitted.pathwaysFound : null,
  };
}

// Counts for the results header: how many identifiers were submitted, mapped and unmapped.
export function summarizeMapping(session) {
  const submitted = session.inputIdentifiers.length;
  const unmapped = session.unmappedIdentifiers.length;
  return {
    submitted,
    unmapped,
    mapped: Math.max(0, submitted - unmapped),
    unmappedFraction: submitted > 0 ? unmapped / submitted : 0,
  };
}

// Makes sure a loaded session still has a live token; if Reactome forgot it, re-runs from the stored list. Offline: keeps the stored rows.
export async function refreshSessionIfExpired(session, options = {}) {
  if (!isWellFormedToken(session.reactomeToken)) return rerun(session, options);
  try {
    await getJson(
      `${ANALYSIS_BASE}/token/${encodeURIComponent(session.reactomeToken)}?pageSize=1&page=1&species=9606`,
      { timeoutMs: 20_000, ...options },
    );
    return { session, rerun: false, offline: false, versionChanged: false };
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'http' && error.status === 404)
      return rerun(session, options);
    if (error instanceof HttpError && ['network', 'timeout'].includes(error.kind))
      return { session, rerun: false, offline: true, versionChanged: false };
    throw error;
  }
}

// Re-runs a stored session's identifiers; keeps its id/createdAt and reports if the Reactome release changed.
async function rerun(session, options) {
  const fresh = await runAnalysis(session.inputIdentifiers, session.parameters, {
    ...options,
    sessionId: session.id,
  });
  const updated = { ...fresh, id: session.id, createdAt: session.createdAt };
  return {
    session: updated,
    rerun: true,
    offline: false,
    versionChanged:
      session.dataVersion !== null &&
      fresh.dataVersion !== null &&
      session.dataVersion !== fresh.dataVersion,
  };
}

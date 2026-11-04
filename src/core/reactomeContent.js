// Reactome Content Service client: gene search, pathways for a gene, pathway details, participants, hierarchy, interactors.
import { TTL } from './cache.js';
import { buildHierarchy } from './hierarchy.js';
import { getJson, getJsonWithMeta, HttpError } from './http.js';

export const CONTENT_BASE = 'https://reactome.org/ContentService';
export const HUMAN_TAX_ID = '9606';
export const STID_PATTERN = /^R-[A-Z]{3}-\d+$/;
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,29}$/;

// Real Reactome pathways whose participants become the example gene lists (names are fetched live, never hard-coded).
export const EXAMPLE_PATHWAY_IDS = ['R-HSA-6804757', 'R-HSA-69473', 'R-HSA-109581'];

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&apos;': "'",
};

// Turns the HTML Reactome returns (highlight spans, links, <br>) into plain text; the result is always shown as text, never as HTML.
export function stripHtml(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp|apos);/g, (m) => ENTITIES[m])
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Returns true if the text is an acceptable gene-symbol-like search term (prevents odd characters in URLs).
export const isValidSymbolInput = (text) =>
  typeof text === 'string' && SYMBOL_PATTERN.test(text.trim());

// Wraps a request so a 404 means "nothing found" (null) instead of an exception; other errors still throw.
async function orNull(promise) {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof HttpError && error.kind === 'http' && error.status === 404) return null;
    throw error;
  }
}

// Throws if a stable ID is malformed (it goes into a URL path).
function checkStId(stId) {
  if (typeof stId !== 'string' || !STID_PATTERN.test(stId))
    throw new RangeError(`Invalid Reactome stable ID: ${String(stId)}`);
}

// Converts a raw Content Service pathway object into the app's Pathway shape.
export function toPathway(raw, { isLowestLevel = false, summary = null, childStIds = [] } = {}) {
  return {
    stId: raw.stId,
    name: stripHtml(raw.displayName ?? raw.name?.[0] ?? ''),
    summary,
    isLowestLevel,
    hasDiagram: raw.hasDiagram === true,
    parentStIds: [],
    childStIds,
  };
}

// Finds the human gene a symbol refers to. Returns { symbol, uniprotAccession, entityStIds, isAlias } or null if nothing matches.
export async function searchGene(input, options = {}) {
  if (!isValidSymbolInput(input)) return null;
  const query = input.trim();
  const url = `${CONTENT_BASE}/search/query?query=${encodeURIComponent(query)}&species=${encodeURIComponent('Homo sapiens')}&types=Protein&cluster=true`;
  const data = await orNull(getJson(url, { ttl: TTL.contentSeconds, ...options }));
  const entries = (data?.results ?? [])
    .flatMap((group) => group.entries ?? [])
    .filter((e) => e.databaseName === 'UniProt' && e.referenceIdentifier)
    .map((e) => ({
      stId: e.stId,
      symbol: stripHtml(e.referenceName ?? ''),
      accession: e.referenceIdentifier,
    }));
  if (entries.length === 0) return null;

  const exact = entries.filter((e) => e.symbol.toUpperCase() === query.toUpperCase());
  const accessions = new Set(entries.map((e) => e.accession));
  // An exact symbol match wins; otherwise accept an alias only if every hit is the same protein (unambiguous).
  const chosen = exact.length > 0 ? exact[0] : accessions.size === 1 ? entries[0] : null;
  if (!chosen) return null;
  return {
    symbol: chosen.symbol,
    uniprotAccession: chosen.accession,
    entityStIds: entries
      .filter((e) => e.accession === chosen.accession)
      .map((e) => e.stId)
      .slice(0, 10),
    isAlias: exact.length === 0,
  };
}

// Lists the lowest-level pathways (Reactome's own definition) that contain a protein, via its UniProt accession.
export async function getLowestPathwaysForGene(uniprotAccession, options = {}) {
  if (!/^[A-Za-z0-9-]{4,15}$/.test(uniprotAccession))
    throw new RangeError('Invalid UniProt accession.');
  const url = `${CONTENT_BASE}/data/mapping/UniProt/${encodeURIComponent(uniprotAccession)}/pathways?species=${HUMAN_TAX_ID}`;
  const data = await orNull(getJson(url, { ttl: TTL.contentSeconds, ...options }));
  return (data ?? []).map((raw) => toPathway(raw, { isLowestLevel: true }));
}

// Fetches a pathway's details: summary text, sub-events, literature references, species and release date.
export async function getPathwayDetails(stId, options = {}) {
  checkStId(stId);
  const raw = await getJson(`${CONTENT_BASE}/data/query/${stId}`, {
    ttl: TTL.contentSeconds,
    ...options,
  });
  const summaryText = (raw.summation ?? [])
    .map((s) => stripHtml(s.text))
    .filter(Boolean)
    .join('\n\n');
  const events = (raw.hasEvent ?? []).map((e) => ({
    stId: e.stId,
    name: stripHtml(e.displayName ?? ''),
    isPathway: e.schemaClass === 'Pathway' || e.schemaClass === 'TopLevelPathway',
  }));
  const references = (raw.literatureReference ?? []).map((r) => ({
    title: stripHtml(r.title ?? r.displayName ?? '') || null,
    journal: r.journal ?? null,
    year: Number.isInteger(r.year) ? r.year : null,
    pubMedId: Number.isInteger(r.pubMedIdentifier) ? r.pubMedIdentifier : null,
    url: Number.isInteger(r.pubMedIdentifier)
      ? `https://pubmed.ncbi.nlm.nih.gov/${r.pubMedIdentifier}/`
      : null,
  }));
  return {
    pathway: toPathway(raw, {
      summary: summaryText || null,
      childStIds: events.filter((e) => e.isPathway).map((e) => e.stId),
    }),
    species: raw.speciesName ?? null,
    releaseDate: raw.releaseDate ?? null,
    subEvents: events,
    references,
  };
}

// Pulls the recommended protein name out of UniProt's free-text "description" field (null if the pattern is absent).
export function proteinNameFromDescription(description) {
  const text = Array.isArray(description) ? description[0] : description;
  const match =
    typeof text === 'string'
      ? text.match(
          /recommendedName:\s*(.+?)(?:\s+ecNumber|\s+alternativeName:|\s+shortName:|\s+includes:|\s+contains:|$)/i,
        )
      : null;
  return match ? match[1].trim() : null;
}

// Lists a pathway's participants as rows { symbol, identifier, name, type, source } (proteins by gene symbol).
export async function getParticipants(stId, options = {}) {
  checkStId(stId);
  const data = await getJson(`${CONTENT_BASE}/data/participants/${stId}/referenceEntities`, {
    ttl: TTL.contentSeconds,
    ...options,
  });
  const seen = new Set();
  const rows = [];
  for (const e of data ?? []) {
    const key = `${e.databaseName}:${e.identifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isProtein = e.databaseName === 'UniProt';
    rows.push({
      symbol: isProtein ? (e.name?.[0] ?? null) : null,
      identifier: e.identifier ?? null,
      name: isProtein ? proteinNameFromDescription(e.description) : (e.name?.[0] ?? null),
      type: e.moleculeType ?? 'not available',
      source: e.databaseName ?? 'not available',
    });
  }
  return rows;
}

// Downloads the full human pathway hierarchy (large, cached 7 days) and builds the graph.
export async function getHierarchy(options = {}) {
  const raw = await getJson(`${CONTENT_BASE}/data/eventsHierarchy/${HUMAN_TAX_ID}`, {
    ttl: TTL.contentSeconds,
    timeoutMs: 60_000,
    ...options,
  });
  return buildHierarchy(raw);
}

// Gets static (IntAct-derived) interactors: { accession, total, interactors:[...] }. `total` comes from the summary endpoint
// because the details endpoint's own `count` is only the size of the returned page.
export async function getInteractors(uniprotAccession, { pageSize = 25, ...options } = {}) {
  if (!/^[A-Za-z0-9-]{4,15}$/.test(uniprotAccession))
    throw new RangeError('Invalid UniProt accession.');
  const base = `${CONTENT_BASE}/interactors/static/molecule/${encodeURIComponent(uniprotAccession)}`;
  const [summary, details] = await Promise.all([
    orNull(getJson(`${base}/summary`, { ttl: TTL.contentSeconds, ...options })),
    orNull(
      getJson(`${base}/details?pageSize=${Number(pageSize)}&page=1`, {
        ttl: TTL.contentSeconds,
        ...options,
      }),
    ),
  ]);
  const total = summary?.entities?.[0]?.count;
  return {
    accession: uniprotAccession,
    total: Number.isInteger(total) ? total : 0,
    interactors: (details?.entities?.[0]?.interactors ?? []).map((i) => ({
      accession: i.acc,
      symbol: i.alias ?? null,
      score: typeof i.score === 'number' ? i.score : null,
      evidences: Number.isInteger(i.evidences) ? i.evidences : null,
    })),
  };
}

// Fetches the current Reactome release (number + date) so the UI can always state which data it shows.
export async function getDatabaseInfo(options = {}) {
  const { data, cachedAt, stale, fromCache } = await getJsonWithMeta(
    `${CONTENT_BASE}/data/database/info`,
    { ttl: TTL.versionSeconds, ...options },
  );
  const release = Number(data?.releaseNumber);
  return {
    releaseNumber: Number.isInteger(release) ? release : null,
    releaseDate: typeof data?.releaseDate === 'string' ? data.releaseDate : null,
    cachedAt,
    stale,
    fromCache,
  };
}

// Builds an example gene list from the real participants of a Reactome pathway, labeled with its source.
export async function getExampleGeneList(stId, options = {}) {
  const [details, participants, info] = await Promise.all([
    getPathwayDetails(stId, options),
    getParticipants(stId, options),
    getDatabaseInfo(options).catch(() => null),
  ]);
  const symbols = [
    ...new Set(participants.filter((p) => p.source === 'UniProt' && p.symbol).map((p) => p.symbol)),
  ];
  const release = info?.releaseNumber ? `, Reactome release ${info.releaseNumber}` : '';
  return {
    stId,
    name: details.pathway.name,
    identifiers: symbols,
    source: `Gene symbols of the proteins annotated in the Reactome pathway "${details.pathway.name}" (${stId})${release}. These genes define that pathway, so it is expected to appear as enriched: a sanity check, not a discovery.`,
  };
}

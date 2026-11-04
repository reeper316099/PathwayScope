// Exports and session files: CSV (RFC 4180 escaping, spreadsheet-formula safe) and validated session save/load.
import { significanceBucket } from './stats.js';

export const SESSION_FORMAT = 'pathwayscope-session';
export const SESSION_VERSION = 1;
const LIMITS = { rows: 20_000, identifiers: 50_000, fieldLength: 2_000_000 };
const SIGNIFICANCE = new Set(['strong', 'moderate', 'weak', 'none']);
const STID = /^R-[A-Z]{3}-\d+(\.\d+)?$/;

// Error thrown for malformed session files, with a message safe to show the user.
export class SessionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionError';
  }
}

// Escapes one CSV cell: quotes fields with commas/quotes/newlines, and defuses spreadsheet formulas in text.
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'number' ? String(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Builds a CSV string from column definitions ({header, value(row)}) and rows; lines end in CRLF per RFC 4180.
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// Columns for the enrichment results table export (numbers stay numbers; missing values are "not available").
export const ENRICHMENT_COLUMNS = [
  { header: 'Pathway ID', value: (r) => r.stId },
  { header: 'Pathway name', value: (r) => r.name },
  { header: 'Entities found', value: (r) => r.entitiesFound },
  { header: 'Entities total', value: (r) => r.entitiesTotal },
  { header: 'Ratio (found/total)', value: (r) => r.ratio },
  { header: 'p-value (hypergeometric, uncorrected)', value: (r) => r.pValue },
  { header: 'FDR (Benjamini-Hochberg)', value: (r) => r.fdr },
  { header: 'Significance', value: (r) => r.significance },
  {
    header: 'Found identifiers',
    value: (r) => (r.foundIdentifiers ? r.foundIdentifiers.join(';') : 'not available'),
  },
];

// Converts enrichment rows to CSV text.
export const enrichmentToCsv = (rows) => toCsv(ENRICHMENT_COLUMNS, rows);

// Serializes an AnalysisSession to the JSON text written to disk.
export function serializeSession(session, now = new Date()) {
  return JSON.stringify(
    { format: SESSION_FORMAT, version: SESSION_VERSION, savedAt: now.toISOString(), session },
    null,
    2,
  );
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v, max) =>
  Array.isArray(v) && v.length <= max && v.every((s) => typeof s === 'string' && s.length < 500);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;

// Throws SessionError unless the condition holds.
function must(condition, message) {
  if (!condition) throw new SessionError(message);
}

// Validates one EnrichmentRow and returns a clean copy (the significance bucket is recomputed, never trusted).
function cleanRow(r, index) {
  must(isObj(r), `Row ${index + 1} is not an object.`);
  must(
    typeof r.stId === 'string' && STID.test(r.stId),
    `Row ${index + 1} has an invalid pathway ID.`,
  );
  must(typeof r.name === 'string' && r.name.length < 1000, `Row ${index + 1} has an invalid name.`);
  must(
    isNonNegInt(r.entitiesFound) && isNonNegInt(r.entitiesTotal),
    `Row ${index + 1} has invalid entity counts.`,
  );
  must(
    isNum(r.ratio) && isNum(r.pValue) && isNum(r.fdr),
    `Row ${index + 1} has invalid statistics.`,
  );
  must(SIGNIFICANCE.has(r.significance), `Row ${index + 1} has an invalid significance label.`);
  must(
    r.foundIdentifiers === null || isStrArray(r.foundIdentifiers, 100_000),
    `Row ${index + 1} has invalid found identifiers.`,
  );
  return {
    stId: r.stId,
    name: r.name,
    entitiesFound: r.entitiesFound,
    entitiesTotal: r.entitiesTotal,
    ratio: r.ratio,
    pValue: r.pValue,
    fdr: r.fdr,
    significance: significanceBucket(r.fdr) ?? 'none',
    foundIdentifiers: r.foundIdentifiers,
  };
}

// Parses and strictly validates session file text; returns an AnalysisSession or throws SessionError.
export function parseSession(text) {
  must(
    typeof text === 'string' && text.length > 0 && text.length <= LIMITS.fieldLength * 10,
    'The file is empty or too large.',
  );
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SessionError('This file is not valid JSON.');
  }
  must(isObj(file) && file.format === SESSION_FORMAT, 'This is not a PathwayScope session file.');
  must(file.version === SESSION_VERSION, `Unsupported session version: ${String(file.version)}.`);
  const s = file.session;
  must(isObj(s), 'The session data is missing.');
  must(typeof s.id === 'string' && s.id.length > 0 && s.id.length < 100, 'Invalid session id.');
  must(
    typeof s.createdAt === 'string' && !Number.isNaN(Date.parse(s.createdAt)),
    'Invalid creation date.',
  );
  must(isStrArray(s.inputIdentifiers, LIMITS.identifiers), 'Invalid input identifiers.');
  must(isStrArray(s.unmappedIdentifiers, LIMITS.identifiers), 'Invalid unmapped identifiers.');
  must(isObj(s.parameters), 'Invalid parameters.');
  const p = s.parameters;
  must(
    ['projectToHuman', 'includeInteractors', 'includeDisease'].every(
      (k) => typeof p[k] === 'boolean',
    ),
    'Invalid analysis options.',
  );
  must(
    [p.minSize, p.maxSize].every((v) => v === null || isNonNegInt(v)),
    'Invalid pathway size limits.',
  );
  must(
    s.reactomeToken === null ||
      (typeof s.reactomeToken === 'string' && /^[A-Za-z0-9+/]{8,100}={0,2}$/.test(s.reactomeToken)),
    'Invalid Reactome token.',
  );
  must(
    s.dataVersion === null || (typeof s.dataVersion === 'string' && s.dataVersion.length < 100),
    'Invalid data version.',
  );
  must(Array.isArray(s.rows) && s.rows.length <= LIMITS.rows, 'Invalid results table.');
  must(
    s.backgroundEntities === undefined ||
      s.backgroundEntities === null ||
      isNonNegInt(s.backgroundEntities),
    'Invalid background size.',
  );
  must(
    s.pathwaysTested === undefined || s.pathwaysTested === null || isNonNegInt(s.pathwaysTested),
    'Invalid pathway count.',
  );
  return {
    id: s.id,
    createdAt: s.createdAt,
    inputIdentifiers: s.inputIdentifiers,
    unmappedIdentifiers: s.unmappedIdentifiers,
    parameters: {
      projectToHuman: p.projectToHuman,
      includeInteractors: p.includeInteractors,
      includeDisease: p.includeDisease,
      minSize: p.minSize,
      maxSize: p.maxSize,
    },
    reactomeToken: s.reactomeToken,
    rows: s.rows.map(cleanRow),
    dataVersion: s.dataVersion,
    backgroundEntities: s.backgroundEntities ?? null,
    pathwaysTested: s.pathwaysTested ?? null,
  };
}

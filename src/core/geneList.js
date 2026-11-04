// Parses and cleans a pasted gene list: delimiters, Excel columns, header row, quotes, duplicates, identifier types.

export const MAX_IDENTIFIERS = 5000; // Our own cap (Reactome accepted 20,000 in testing; 5,000 keeps the UI responsive).
export const MAX_INPUT_CHARS = 2_000_000; // Refuse absurdly large pastes before parsing.

// Identifier patterns (case-insensitive). UniProt pattern is the official accession regex.
const PATTERNS = {
  ensembl: /^ENS[A-Z]{0,6}[GTP]\d{11}(\.\d+)?$/i,
  uniprot: /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-\d+)?$/i,
  entrez: /^\d{1,9}$/,
  symbol: /^[A-Za-z][A-Za-z0-9._@-]*$/,
};
const LOOKS_LIKE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const HEADER_WORDS =
  /^(genes?|symbols?|gene[ _-]?(symbols?|names?|ids?)|hgnc([ _-]?symbols?)?|ids?|identifiers?|names?|uniprot(_?ids?|[ _-]?accessions?)?|accessions?|ensembl([ _-]?(gene)?([ _-]?ids?)?)?|entrez([ _-]?(gene)?([ _-]?ids?)?)?)$/i;
const QUOTES = /^["'`‘’“”]+|["'`‘’“”]+$/g;

// Classifies one identifier as 'ensembl' | 'uniprot' | 'entrez' | 'symbol' | 'unknown'.
// Histone gene symbols (H2BC21, H2AC6, H4C3...) collide with the UniProt accession pattern; real lists use them as symbols.
const HISTONE_SYMBOL = /^H[1-4][A-Z]{1,2}[A-Z0-9]*\d{1,2}$/i;

export function detectIdentifierType(id) {
  if (HISTONE_SYMBOL.test(id)) return 'symbol';
  for (const type of ['ensembl', 'uniprot', 'entrez', 'symbol']) {
    if (PATTERNS[type].test(id)) return type;
  }
  return 'unknown';
}

// Removes a leading byte-order mark (Excel/Notepad exports add one; Reactome would not recognise the first gene).
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// Cleans one raw token: trims whitespace, removes the BOM and surrounding quotes.
function cleanToken(raw) {
  return stripBom(raw).trim().replace(QUOTES, '').trim();
}

// True if a cell looks like a number (used to recognise data columns such as fold-changes or p-values).
const isNumeric = (cell) => /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cell.trim());

// Splits a line into cells on tabs (or on , / ; when the line has no tabs).
function splitCells(line) {
  const delimiter = line.includes('\t') ? '\t' : /[,;]/;
  return line.split(delimiter);
}

// Detects a pasted table (e.g. Excel columns with a header or numeric data) and returns its first column, or null.
function firstColumnIfTable(lines) {
  if (lines.length < 2) return null;
  const rows = lines.map(splitCells);
  const width = rows[0].length;
  if (width < 2 || rows.some((r) => r.length !== width)) return null;
  const header = HEADER_WORDS.test(cleanToken(rows[0][0]));
  const dataRows = header ? rows.slice(1) : rows;
  const otherCells = dataRows.flatMap((r) => r.slice(1)).filter((c) => c.trim() !== '');
  const numeric =
    otherCells.length > 0 && otherCells.filter(isNumeric).length / otherCells.length >= 0.8;
  return header || numeric ? rows.map((r) => r[0]) : null;
}

// Parses pasted text into a clean identifier list plus everything the UI should tell the user.
export function parseGeneList(text, { maxIdentifiers = MAX_IDENTIFIERS } = {}) {
  const result = {
    identifiers: [],
    duplicatesRemoved: 0,
    warnings: [],
    detectedTypes: {},
    ignored: [],
    headerRemoved: false,
    tooLarge: false,
  };
  if (typeof text !== 'string' || text.trim() === '') {
    result.warnings.push('No identifiers found.');
    return result;
  }
  if (text.length > MAX_INPUT_CHARS) {
    result.tooLarge = true;
    result.warnings.push(
      `The pasted text is too large (over ${MAX_INPUT_CHARS.toLocaleString('en-US')} characters).`,
    );
    return result;
  }

  // Drop comment lines ("#...") and blank lines; a leading comment/header line counts as a header.
  const lines = stripBom(text)
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== '');
  const comments = lines.filter((l) => l.trim().startsWith('#'));
  const body = lines.filter((l) => !l.trim().startsWith('#'));
  if (comments.length) result.headerRemoved = true;

  let tokens;
  const column = firstColumnIfTable(body);
  if (column) {
    tokens = column;
    result.warnings.push(
      'Multiple columns detected: using the first column as identifiers and ignoring the rest.',
    );
  } else {
    tokens = body.join('\n').split(/[\s,;]+/);
  }

  tokens = tokens.map(cleanToken).filter((t) => t !== '');
  if (tokens.length && HEADER_WORDS.test(tokens[0])) {
    tokens.shift();
    result.headerRemoved = true;
  }

  const seen = new Set();
  for (const token of tokens) {
    if (!LOOKS_LIKE_IDENTIFIER.test(token)) {
      result.ignored.push(token);
      continue;
    }
    const key = token.toUpperCase();
    if (seen.has(key)) {
      result.duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    result.identifiers.push(token);
    const type = detectIdentifierType(token);
    result.detectedTypes[type] = (result.detectedTypes[type] ?? 0) + 1;
  }

  if (result.ignored.length) {
    const sample = result.ignored.slice(0, 5).join(', ');
    result.warnings.push(
      `Ignored ${result.ignored.length} entr${result.ignored.length === 1 ? 'y' : 'ies'} that do not look like identifiers (${sample}${result.ignored.length > 5 ? ', …' : ''}).`,
    );
  }
  const types = Object.keys(result.detectedTypes);
  if (types.length > 1) {
    result.warnings.push(
      `Mixed identifier types detected (${types.map((t) => `${result.detectedTypes[t]} ${t}`).join(', ')}). Reactome can map mixed lists, but results are easier to interpret with one type.`,
    );
  }
  if (result.detectedTypes.entrez) {
    result.warnings.push(
      'Entrez IDs map less reliably in Reactome (for example, 7157 for TP53 was not recognised in our testing). Gene symbols or UniProt accessions are recommended.',
    );
  }
  if (result.detectedTypes.unknown) {
    result.warnings.push(
      `${result.detectedTypes.unknown} identifier(s) have an unrecognised format and may be reported as unmapped.`,
    );
  }
  if (result.identifiers.length > maxIdentifiers) {
    result.tooLarge = true;
    result.warnings.push(
      `This list has ${result.identifiers.length.toLocaleString('en-US')} identifiers, which is over the limit of ${maxIdentifiers.toLocaleString('en-US')}. Please shorten it.`,
    );
  }
  if (result.identifiers.length === 0) result.warnings.push('No identifiers found.');
  return result;
}

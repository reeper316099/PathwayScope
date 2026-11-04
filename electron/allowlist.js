// Allowlists: which hosts the main process may fetch from, and which https links may open in the system browser.

// Hosts the main process may call (exact hostname match, https only).
export const FETCH_HOSTS = new Set(['reactome.org', 'rest.uniprot.org', 'eutils.ncbi.nlm.nih.gov']);

// Minimum gap between requests per host in ms (NCBI allows 3 requests/second without an API key).
export const MIN_INTERVAL_MS = {
  'reactome.org': 150,
  'rest.uniprot.org': 100,
  'eutils.ncbi.nlm.nih.gov': 350,
};

// The only URL prefix that may be POSTed to (Analysis Service gene-list submission).
export const POST_ALLOWED_PREFIXES = ['https://reactome.org/AnalysisService/identifiers/'];

// Hosts that "openExternal" may open in the user's browser (link-outs, repo, DOI/PubMed).
export const LINK_HOSTS = new Set([
  'reactome.org',
  'www.uniprot.org',
  'alphafold.ebi.ac.uk',
  'gnomad.broadinstitute.org',
  'www.ncbi.nlm.nih.gov',
  'pubmed.ncbi.nlm.nih.gov',
  'doi.org',
  'github.com',
]);

// Limits that protect the main process from huge payloads or hung requests.
export const LIMITS = {
  maxUrlLength: 4096,
  maxBodyBytes: 1_000_000,
  maxResponseBytes: 25_000_000,
  defaultTimeoutMs: 20_000,
  analysisTimeoutMs: 60_000,
  maxTimeoutMs: 120_000,
  maxCacheTtlSeconds: 7 * 24 * 3600,
  maxSaveBytes: 50_000_000,
  maxSessionFileBytes: 20_000_000,
};

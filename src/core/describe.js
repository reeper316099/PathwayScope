// Turns an API request into a short human-readable label (shown in "Manage stored data") and a kind for grouping.

const KINDS = ['gene', 'pathway', 'analysis', 'shared', 'other'];
export const isKind = (value) => KINDS.includes(value);

// Removes control characters and shortens a label to a sane length.
const tidy = (text) =>
  [...text]
    .filter((c) => c >= ' ')
    .join('')
    .slice(0, 120);

// Returns { label, kind } for a request; unknown requests get a generic label (never an empty one).
export function describeRequest(method, url, body = '') {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { label: 'Cached response', kind: 'other' };
  }
  const p = decodeURIComponent(u.pathname);
  const q = u.searchParams;
  const make = (label, kind) => ({ label: tidy(label), kind });
  let m;

  if (u.hostname === 'reactome.org') {
    if (p.endsWith('/search/query')) return make(`Gene search: ${q.get('query') ?? '?'}`, 'gene');
    if ((m = p.match(/\/data\/mapping\/UniProt\/([^/]+)\/pathways$/)))
      return make(`Pathways of protein ${m[1]}`, 'gene');
    if ((m = p.match(/\/interactors\/static\/molecule\/([^/]+)\/(summary|details)$/)))
      return make(`Interactors of protein ${m[1]} (${m[2]})`, 'gene');
    if ((m = p.match(/\/data\/query\/(R-[A-Z]{3}-\d+)$/)))
      return make(`Pathway details: ${m[1]}`, 'pathway');
    if ((m = p.match(/\/data\/participants\/(R-[A-Z]{3}-\d+)\//)))
      return make(`Pathway participants: ${m[1]}`, 'pathway');
    if (p.includes('/data/eventsHierarchy/'))
      return make('Pathway hierarchy (all human pathways)', 'shared');
    if ((m = p.match(/\/exporter\/diagram\/(R-[A-Z]{3}-\d+)\.svg$/)))
      return make(
        `Pathway diagram: ${m[1]}${q.has('token') ? ' (with analysis highlighting)' : ''}`,
        'pathway',
      );
    if (p.endsWith('/data/database/info')) return make('Reactome release information', 'shared');
    if (p.includes('/AnalysisService/identifiers/')) {
      const count = body
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.startsWith('#')).length;
      return make(`Enrichment analysis (${count} identifier${count === 1 ? '' : 's'})`, 'analysis');
    }
    if ((m = p.match(/\/AnalysisService\/token\/[^/]+\/found\/entities\/(R-[A-Z]{3}-\d+)$/)))
      return make(`Your genes found in pathway ${m[1]}`, 'analysis');
    if (/\/AnalysisService\/token\/[^/]+\/notFound$/.test(p))
      return make('Unmapped identifiers of an analysis', 'analysis');
    if (/\/AnalysisService\/token\/[^/]+$/.test(p))
      return make('Enrichment analysis results', 'analysis');
  }
  if (u.hostname === 'rest.uniprot.org' && (m = p.match(/\/uniprotkb\/([^/]+)$/)))
    return make(`Protein name: ${m[1]}`, 'gene');
  if (
    u.hostname === 'eutils.ncbi.nlm.nih.gov' &&
    (m = (q.get('term') ?? '').match(/^([^[\s]+)\[gene\]/))
  )
    return make(`ClinVar record count: ${m[1]}`, 'gene');
  return make(`Cached ${method} response from ${u.hostname}`, 'other');
}

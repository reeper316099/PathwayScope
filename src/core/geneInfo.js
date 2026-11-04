// Light gene info for the gene card: protein name from UniProt and a ClinVar pathogenic-record count from NCBI E-utilities.
import { TTL } from './cache.js';
import { getJson } from './http.js';

const ACCESSION = /^[A-Za-z0-9-]{4,15}$/;
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,29}$/;

// Gets the recommended protein name for a UniProt accession (null if UniProt does not give one).
export async function getProteinInfo(accession, options = {}) {
  if (!ACCESSION.test(accession)) throw new RangeError('Invalid UniProt accession.');
  const url = `https://rest.uniprot.org/uniprotkb/${accession}?fields=accession,gene_primary,protein_name&format=json`;
  const data = await getJson(url, { ttl: TTL.contentSeconds, ...options });
  return {
    accession: data?.primaryAccession ?? accession,
    proteinName:
      data?.proteinDescription?.recommendedName?.fullName?.value ??
      data?.proteinDescription?.submissionNames?.[0]?.fullName?.value ??
      null,
  };
}

// Counts ClinVar records for a gene that carry a "pathogenic" clinical-significance property; returns null if unavailable.
export async function getClinvarPathogenicCount(symbol, options = {}) {
  if (!SYMBOL.test(symbol)) throw new RangeError('Invalid gene symbol.');
  const term = encodeURIComponent(`${symbol}[gene] AND "clinsig pathogenic"[Properties]`);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar&term=${term}&retmode=json&retmax=0`;
  const data = await getJson(url, { ttl: TTL.contentSeconds, ...options });
  const count = Number(data?.esearchresult?.count);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

// Builds outbound links (plain links only; nothing is fetched from these hosts for link-outs).
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,29}$/;
const ACCESSION = /^[A-Za-z0-9-]{4,15}$/;
const STID = /^R-[A-Z]{3}-\d+$/;

// Returns the link builder result, or null when the input would not make a valid URL.
const ifValid = (ok, build) => (ok ? build() : null);

export const links = {
  // ClinVar search for a gene symbol.
  clinvar: (symbol) =>
    ifValid(
      SYMBOL.test(symbol),
      () => `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(`${symbol}[gene]`)}`,
    ),
  // AlphaFold DB entry page for a UniProt accession (we never fetch structures).
  alphafold: (accession) =>
    ifValid(ACCESSION.test(accession), () => `https://alphafold.ebi.ac.uk/entry/${accession}`),
  // UniProt entry page.
  uniprot: (accession) =>
    ifValid(
      ACCESSION.test(accession),
      () => `https://www.uniprot.org/uniprotkb/${accession}/entry`,
    ),
  // gnomAD gene page (we never query gnomAD).
  gnomad: (symbol) =>
    ifValid(
      SYMBOL.test(symbol),
      () => `https://gnomad.broadinstitute.org/gene/${encodeURIComponent(symbol)}`,
    ),
  // Reactome Pathway Browser page for a pathway stable ID.
  reactomePathway: (stId) =>
    ifValid(STID.test(stId), () => `https://reactome.org/PathwayBrowser/#/${stId}`),
  // Reactome site search for a gene symbol (human entries).
  reactomeGene: (symbol) =>
    ifValid(
      SYMBOL.test(symbol),
      () =>
        `https://reactome.org/content/query?q=${encodeURIComponent(symbol)}&species=Homo+sapiens&cluster=true`,
    ),
};

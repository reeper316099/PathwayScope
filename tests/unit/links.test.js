// Tests for link-out builders and the gene-info clients (UniProt protein name, ClinVar count).
import { afterEach, describe, expect, it } from 'vitest';
import { getClinvarPathogenicCount, getProteinInfo } from '../../src/core/geneInfo.js';
import { cache } from '../../src/core/http.js';
import { links } from '../../src/core/links.js';
import { jsonResponse, stubFetch } from '../helpers/fixtures.js';

afterEach(() => cache.clear());

describe('links', () => {
  it('builds the expected URLs', () => {
    expect(links.uniprot('P04637')).toBe('https://www.uniprot.org/uniprotkb/P04637/entry');
    expect(links.alphafold('P04637')).toBe('https://alphafold.ebi.ac.uk/entry/P04637');
    expect(links.gnomad('TP53')).toBe('https://gnomad.broadinstitute.org/gene/TP53');
    expect(links.clinvar('TP53')).toBe('https://www.ncbi.nlm.nih.gov/clinvar/?term=TP53%5Bgene%5D');
    expect(links.reactomePathway('R-HSA-69541')).toBe(
      'https://reactome.org/PathwayBrowser/#/R-HSA-69541',
    );
    expect(links.reactomeGene('TP53')).toContain('reactome.org/content/query?q=TP53');
  });
  it('returns null for inputs that could not make a safe URL', () => {
    expect(links.uniprot('../x')).toBeNull();
    expect(links.gnomad('a b')).toBeNull();
    expect(links.reactomePathway('R-HSA-1/../x')).toBeNull();
    expect(links.clinvar('')).toBeNull();
  });
});

describe('getProteinInfo', () => {
  it('reads the recommended name from the real UniProt response shape', async () => {
    stubFetch([
      [
        (u) => u.includes('rest.uniprot.org/uniprotkb/P04637'),
        () =>
          jsonResponse({
            primaryAccession: 'P04637',
            proteinDescription: {
              recommendedName: { fullName: { value: 'Cellular tumor antigen p53' } },
            },
          }),
      ],
    ]);
    expect(await getProteinInfo('P04637')).toEqual({
      accession: 'P04637',
      proteinName: 'Cellular tumor antigen p53',
    });
  });
  it('returns a null name when UniProt gives none, and rejects bad accessions', async () => {
    stubFetch([[() => true, () => jsonResponse({ primaryAccession: 'Q00000' })]]);
    expect((await getProteinInfo('Q00000')).proteinName).toBeNull();
    await expect(getProteinInfo('x y')).rejects.toThrow(RangeError);
  });
});

describe('getClinvarPathogenicCount', () => {
  it('parses the esearch count (a string in the real response)', async () => {
    const calls = stubFetch([
      [() => true, () => jsonResponse({ esearchresult: { count: '1031' } })],
    ]);
    expect(await getClinvarPathogenicCount('TP53')).toBe(1031);
    expect(decodeURIComponent(calls[0].url)).toContain(
      'TP53[gene] AND "clinsig pathogenic"[Properties]',
    );
  });
  it('returns null (not 0) when the response has no usable count', async () => {
    stubFetch([[() => true, () => jsonResponse({ esearchresult: {} })]]);
    expect(await getClinvarPathogenicCount('TP53')).toBeNull();
  });
  it('rejects invalid symbols without a request', async () => {
    const calls = stubFetch([]);
    await expect(getClinvarPathogenicCount('a b')).rejects.toThrow(RangeError);
    expect(calls).toHaveLength(0);
  });
});

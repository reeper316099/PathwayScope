// Gene card: symbol, protein name, UniProt accession, link-outs, ClinVar badge and Reactome interactors.
import { getClinvarPathogenicCount, getProteinInfo } from '../core/geneInfo.js';
import { links } from '../core/links.js';
import { getInteractors } from '../core/reactomeContent.js';
import { friendlyError, warningNote } from './cards.js';
import { externalLink, h, setChildren } from './dom.js';

// Builds the gene card; slow parts (protein name, ClinVar, interactors) fill in as they arrive and fail independently.
export function createGeneCard(gene, { signal, onOpenGene }) {
  const nameEl = h('span', { class: 'muted' }, 'protein name: loading…');
  const clinvarEl = h('span', { class: 'badge neutral' }, 'ClinVar: loading…');
  const interactorsEl = h('div', { class: 'interactors muted' }, 'Interactors: loading…');
  const card = h(
    'section',
    { class: 'card gene-card', 'aria-label': `Gene ${gene.symbol}` },
    h('h2', { class: 'gene-title' }, gene.symbol),
    gene.isAlias &&
      warningNote(`You searched for an alias; Reactome resolves it to ${gene.symbol}.`),
    h('p', {}, nameEl),
    h(
      'p',
      { class: 'muted' },
      'UniProt accession: ',
      externalLink(links.uniprot(gene.uniprotAccession), gene.uniprotAccession),
      ' (human)',
    ),
    h(
      'p',
      { class: 'linkouts' },
      externalLink(links.clinvar(gene.symbol), 'ClinVar'),
      externalLink(links.alphafold(gene.uniprotAccession), 'AlphaFold DB'),
      externalLink(links.uniprot(gene.uniprotAccession), 'UniProt'),
      externalLink(links.gnomad(gene.symbol), 'gnomAD'),
      externalLink(links.reactomeGene(gene.symbol), 'Reactome'),
    ),
    h('p', {}, clinvarEl),
    interactorsEl,
  );

  getProteinInfo(gene.uniprotAccession, { signal }).then(
    (info) =>
      setChildren(
        nameEl,
        info.proteinName ? `Protein: ${info.proteinName}` : 'Protein name: not available',
      ),
    () => setChildren(nameEl, 'Protein name: not available (UniProt could not be reached)'),
  );
  getClinvarPathogenicCount(gene.symbol, { signal }).then(
    (count) => {
      clinvarEl.className = 'badge neutral';
      setChildren(
        clinvarEl,
        count === null
          ? 'ClinVar: not available'
          : `ClinVar: ${count.toLocaleString('en-US')} records with a pathogenic classification`,
      );
      clinvarEl.title =
        'Count of ClinVar records for this gene whose clinical significance includes "pathogenic". An approximate orientation number, not a clinical statement.';
    },
    () => setChildren(clinvarEl, 'ClinVar: not available'),
  );
  getInteractors(gene.uniprotAccession, { pageSize: 10, signal }).then(
    (result) => {
      if (result.total === 0)
        return setChildren(interactorsEl, 'Interactors (IntAct, via Reactome): none listed.');
      setChildren(
        interactorsEl,
        h(
          'strong',
          {},
          `Interactors (IntAct, via Reactome): ${result.total} total; top ${result.interactors.length} by score`,
        ),
        h(
          'ul',
          { class: 'chips' },
          result.interactors.map((i) =>
            h(
              'li',
              {},
              i.symbol
                ? h(
                    'button',
                    {
                      class: 'chip',
                      type: 'button',
                      title: `score ${i.score ?? 'not available'}, ${i.evidences ?? 'not available'} evidences`,
                      onclick: () => onOpenGene(i.symbol),
                    },
                    i.symbol,
                  )
                : h('span', { class: 'chip' }, i.accession),
            ),
          ),
        ),
      );
    },
    (error) => setChildren(interactorsEl, `Interactors: not available (${friendlyError(error)})`),
  );
  return card;
}

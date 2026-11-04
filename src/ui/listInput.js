// Gene list input: textarea + drag-and-drop, live parse preview, options panel, live example lists, run/cancel.
import { MAX_IDENTIFIERS, parseGeneList } from '../core/geneList.js';
import { DEFAULT_PARAMETERS } from '../core/reactomeAnalysis.js';
import { EXAMPLE_PATHWAY_IDS, getExampleGeneList } from '../core/reactomeContent.js';
import { friendlyError } from './cards.js';
import { debounce, h, setChildren } from './dom.js';

const TYPE_NAMES = {
  symbol: 'gene symbols',
  uniprot: 'UniProt accessions',
  ensembl: 'Ensembl IDs',
  entrez: 'Entrez IDs',
  unknown: 'unrecognised',
};
const MAX_FILE_BYTES = 2_000_000;

// Builds a labeled option control with a one-line plain-English explanation shown under it (also a tooltip).
const option = (id, label, help, control) =>
  h(
    'div',
    { class: 'option' },
    h('label', { for: id, title: help }, label),
    control,
    h('p', { class: 'hint', id: `${id}-help` }, help),
  );

// Mounts the input card. callbacks: { onRun(identifiers, params), onCancel(), onCutoff(fdr) }. Returns { setRunning, getParams, setText }.
export function createListInput(root, { onRun, onCancel, onCutoff }) {
  const textarea = h('textarea', {
    id: 'gene-list',
    rows: '9',
    spellcheck: 'false',
    'aria-describedby': 'list-preview',
    placeholder:
      'Paste gene symbols, UniProt accessions or Ensembl IDs, one per line or separated by commas, spaces, tabs or semicolons.',
  });
  const preview = h('div', {
    id: 'list-preview',
    class: 'preview',
    role: 'status',
    'aria-live': 'polite',
  });
  const sourceNote = h('p', { class: 'note', hidden: true });
  const drop = h(
    'div',
    { class: 'dropzone' },
    textarea,
    h('p', { class: 'hint' }, 'You can also drag a .txt, .csv or .tsv file onto the box.'),
  );
  const examples = h('div', { class: 'examples' });

  const project = h('input', {
    id: 'opt-project',
    type: 'checkbox',
    checked: DEFAULT_PARAMETERS.projectToHuman || undefined,
  });
  const disease = h('input', {
    id: 'opt-disease',
    type: 'checkbox',
    checked: DEFAULT_PARAMETERS.includeDisease || undefined,
  });
  const interactors = h('input', { id: 'opt-interactors', type: 'checkbox' });
  const minSize = h('input', {
    id: 'opt-min',
    type: 'number',
    min: '1',
    max: '100000',
    placeholder: 'no minimum',
  });
  const maxSize = h('input', {
    id: 'opt-max',
    type: 'number',
    min: '1',
    max: '100000',
    placeholder: 'no maximum',
  });
  const cutoff = h('input', {
    id: 'opt-fdr',
    type: 'range',
    min: '0.001',
    max: '0.2',
    step: '0.001',
    value: '0.05',
  });
  const cutoffValue = h('output', { for: 'opt-fdr' }, '0.05');
  cutoff.addEventListener('input', () => {
    cutoffValue.textContent = Number(cutoff.value).toString();
    onCutoff(Number(cutoff.value));
  });

  const runBtn = h(
    'button',
    { class: 'btn', type: 'button', disabled: true },
    'Run enrichment analysis',
  );
  const cancelBtn = h(
    'button',
    { class: 'btn secondary', type: 'button', hidden: true, onclick: () => onCancel() },
    'Cancel',
  );
  const progress = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });

  let parsed = parseGeneList('');
  // Re-parses the textarea and updates the live preview and Run button.
  const update = () => {
    parsed = parseGeneList(textarea.value);
    const types = Object.entries(parsed.detectedTypes)
      .map(([t, n]) => `${n} ${TYPE_NAMES[t]}`)
      .join(', ');
    setChildren(
      preview,
      parsed.identifiers.length === 0
        ? h(
            'span',
            { class: 'muted' },
            textarea.value.trim() ? 'No identifiers found yet.' : 'Nothing pasted yet.',
          )
        : h(
            'strong',
            {},
            `${parsed.identifiers.length.toLocaleString('en-US')} identifiers`,
            parsed.duplicatesRemoved
              ? `, ${parsed.duplicatesRemoved} duplicate${parsed.duplicatesRemoved === 1 ? '' : 's'} removed`
              : '',
            parsed.headerRemoved ? ', header row skipped' : '',
            types ? ` · type: ${types}` : '',
          ),
      parsed.warnings
        .filter((w) => w !== 'No identifiers found.')
        .map((w) => h('p', { class: 'note warn' }, '⚠ ', w)),
      parsed.ignored.length > 0 &&
        h(
          'details',
          {},
          h('summary', {}, `Ignored entries (${parsed.ignored.length})`),
          h('p', { class: 'mono' }, parsed.ignored.slice(0, 200).join('  ')),
        ),
    );
    runBtn.disabled = parsed.identifiers.length === 0 || parsed.tooLarge;
  };
  textarea.addEventListener('input', debounce(update, 150));
  textarea.addEventListener('input', () => {
    sourceNote.hidden = true;
  });

  // Reads a dropped/chosen file into the textarea (text only, size-capped).
  const loadFile = async (file) => {
    if (file.size > MAX_FILE_BYTES)
      return setChildren(
        preview,
        h('p', { class: 'note warn' }, `⚠ ${file.name} is larger than ${MAX_FILE_BYTES / 1e6} MB.`),
      );
    textarea.value = await file.text();
    sourceNote.hidden = false;
    sourceNote.textContent = `Loaded from file: ${file.name}`;
    update();
  };
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });

  // Reads the options into the parameters object stored with a session.
  const getParams = () => ({
    projectToHuman: project.checked,
    includeInteractors: interactors.checked,
    includeDisease: disease.checked,
    minSize: minSize.value ? Number(minSize.value) : null,
    maxSize: maxSize.value ? Number(maxSize.value) : null,
  });
  runBtn.addEventListener('click', () => {
    const params = getParams();
    if (params.minSize !== null && params.maxSize !== null && params.minSize > params.maxSize) {
      return setChildren(
        preview,
        h('p', { class: 'note warn' }, '⚠ The minimum pathway size is larger than the maximum.'),
      );
    }
    return onRun(parsed.identifiers, params);
  });

  // Loads the example chips live from real Reactome pathways (names and genes come from the API).
  const loadExamples = async () => {
    setChildren(examples, h('span', { class: 'muted' }, 'Loading example lists from Reactome…'));
    const loaded = await Promise.allSettled(
      EXAMPLE_PATHWAY_IDS.map((id) => getExampleGeneList(id)),
    );
    const ok = loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed = loaded.find((r) => r.status === 'rejected');
    setChildren(
      examples,
      h('strong', {}, 'Example lists: '),
      ok.map((ex) =>
        h(
          'button',
          {
            class: 'chip',
            type: 'button',
            title: ex.source,
            onclick: () => {
              textarea.value = ex.identifiers.join('\n');
              sourceNote.hidden = false;
              sourceNote.textContent = `Source: ${ex.source}`;
              update();
            },
          },
          `${ex.name} (${ex.identifiers.length} genes)`,
        ),
      ),
      failed &&
        h(
          'span',
          { class: 'note warn' },
          `⚠ Some examples could not be loaded: ${friendlyError(failed.reason)} `,
          h('button', { class: 'link-btn', type: 'button', onclick: loadExamples }, 'Retry'),
        ),
    );
  };

  root.append(
    h('h2', {}, 'Your gene list'),
    examples,
    drop,
    sourceNote,
    preview,
    h(
      'fieldset',
      { class: 'options' },
      h('legend', {}, 'Options'),
      option(
        'opt-project',
        'Project to human',
        'Convert non-human identifiers to their human equivalents before testing (Reactome default).',
        project,
      ),
      option(
        'opt-disease',
        'Include disease pathways',
        'Count pathways about disease states (for example, mutated or defective versions of normal pathways).',
        disease,
      ),
      option(
        'opt-interactors',
        'Include interactors',
        'Also match your genes to proteins that merely bind Reactome entities; this widens the match and can add noise.',
        interactors,
      ),
      option(
        'opt-min',
        'Minimum pathway size',
        'Hide pathways with fewer entities than this (tiny pathways are easy to hit by chance).',
        minSize,
      ),
      option(
        'opt-max',
        'Maximum pathway size',
        'Hide pathways with more entities than this (huge pathways are broad and less specific).',
        maxSize,
      ),
      option(
        'opt-fdr',
        'FDR cutoff (display only)',
        'Only show pathways whose corrected p-value (FDR) is below this. It does not change the statistics, only what you see.',
        h('span', {}, cutoff, ' ', cutoffValue),
      ),
    ),
    h('div', { class: 'actions' }, runBtn, cancelBtn),
    progress,
  );
  update();
  loadExamples();

  return {
    // Switches the Run/Cancel buttons and shows progress text while an analysis is running.
    setRunning(running, text = '') {
      runBtn.hidden = running;
      cancelBtn.hidden = !running;
      progress.textContent = text;
    },
    setProgress: (text) => {
      progress.textContent = text;
    },
    getParams,
    getCutoff: () => Number(cutoff.value),
    // Puts text into the box (used when opening a saved session).
    setText(text, note) {
      textarea.value = text;
      sourceNote.hidden = !note;
      sourceNote.textContent = note ?? '';
      update();
    },
    maxIdentifiers: MAX_IDENTIFIERS,
  };
}

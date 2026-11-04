// Global search box with suggestions: "Gene: X" (opens Gene Explorer) and matching pathway names (opens Pathway Browser).
import { searchByName } from '../core/hierarchy.js';
import { isValidSymbolInput } from '../core/reactomeContent.js';
import { debounce, h, setChildren } from './dom.js';
import { getHierarchyOnce } from './state.js';

// Wires up the top-bar search form. Returns { focus }.
export function mountGlobalSearch({ form, input, onGene, onPathway }) {
  const list = h('ul', {
    class: 'suggestions',
    role: 'listbox',
    id: 'search-suggestions',
    hidden: true,
  });
  form.append(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'search-suggestions');
  let items = [];
  let active = 0;
  let hierarchy = null;

  // Closes the dropdown.
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  // Runs the action of a suggestion and resets the box.
  const choose = (item) => {
    close();
    input.value = '';
    item.run();
  };
  // Redraws the suggestion list for the current text.
  const render = () => {
    const text = input.value.trim();
    items = [];
    if (text && isValidSymbolInput(text))
      items.push({
        label: `Gene: ${text.toUpperCase()}`,
        hint: 'open in Gene Explorer',
        run: () => onGene(text),
      });
    if (text.length >= 2 && hierarchy) {
      for (const node of searchByName(hierarchy, text, { limit: 6 }))
        items.push({
          label: node.name,
          hint: `pathway ${node.stId}`,
          run: () => onPathway(node.stId),
        });
    }
    active = Math.min(active, Math.max(0, items.length - 1));
    list.hidden = items.length === 0;
    input.setAttribute('aria-expanded', String(items.length > 0));
    setChildren(
      list,
      items.map((item, i) =>
        h(
          'li',
          {
            role: 'option',
            id: `sugg-${i}`,
            'aria-selected': String(i === active),
            class: i === active ? 'active' : '',
            onmousedown: (e) => {
              e.preventDefault();
              choose(item);
            },
          },
          item.label,
          ' ',
          h('span', { class: 'muted' }, item.hint),
        ),
      ),
    );
    input.setAttribute('aria-activedescendant', items.length ? `sugg-${active}` : '');
  };
  const debounced = debounce(render, 120);

  input.addEventListener('focus', () => {
    if (!hierarchy)
      getHierarchyOnce().then(
        (x) => {
          hierarchy = x;
          render();
        },
        () => {},
      );
  });
  input.addEventListener('input', () => {
    active = 0;
    debounced();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!items.length) return;
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
    } else if (event.key === 'Escape') close();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    debounced.cancel();
    render();
    if (items[active]) choose(items[active]);
  });
  return { focus: () => input.focus() };
}

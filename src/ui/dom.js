// Tiny DOM helper. Text is ALWAYS inserted as text nodes (never innerHTML), so API data cannot inject markup.

// Creates an element: attrs may include class, dataset, style (object, applied via CSSOM so the CSP allows it), onclick-style handlers.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

// Appends children (nodes, strings, numbers, nested arrays); null/false are skipped.
export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Replaces all content of an element with the given children.
export function setChildren(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

// Returns a debounced version of fn (used for live parse previews and search-as-you-type).
export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

// Creates an <a> link that opens externally (data-external lets main.js route it through the allowlisted IPC call).
export const externalLink = (href, text, attrs = {}) =>
  href
    ? h(
        'a',
        { href, 'data-external': '', rel: 'noopener noreferrer', target: '_blank', ...attrs },
        text,
      )
    : h('span', {}, text);

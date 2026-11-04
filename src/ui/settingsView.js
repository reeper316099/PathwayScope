// Settings: appearance, stored data (history, sessions, cached lookups), help links and keyboard shortcuts.
import { createDataManager } from './dataManager.js';
import { h, setChildren } from './dom.js';
import { toggleTheme } from './theme.js';

const SHORTCUTS = [
  ['Ctrl/Cmd + Shift + H', 'Home (desktop app)'],
  ['Ctrl/Cmd + K', 'Focus the search box'],
  ['Ctrl/Cmd + 1 / 2 / 3 / 4', 'Gene Explorer / Enrichment / Pathway Browser / Settings'],
  ['Ctrl/Cmd + D', 'Toggle dark mode'],
  ['Ctrl/Cmd + S', 'Save the current analysis as a session file'],
  ['Ctrl/Cmd + E', 'Export the results table as CSV'],
  ['Esc, or click outside', 'Close a pop-up window'],
];

// Creates the Settings view inside `root`. ctx: { openDialog(id) } opens the About and Data sources pop-ups.
export function createSettingsView(root, ctx) {
  const themeButton = h('button', {
    class: 'btn secondary',
    type: 'button',
    'aria-pressed': 'false',
    onclick: toggleTheme,
  });
  // Keeps the button label in step with the current theme (also when changed from the top bar or a shortcut).
  const syncTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.textContent = dark
      ? 'Dark mode: on (switch to light)'
      : 'Dark mode: off (switch to dark)';
  };
  document.addEventListener('themechange', syncTheme);
  syncTheme();

  const dataBox = h('div', { id: 'data-manager' });
  const manager = createDataManager(dataBox);

  setChildren(
    root,
    h('h1', {}, 'Settings'),
    h(
      'section',
      { class: 'card', 'aria-label': 'Appearance' },
      h('h2', {}, 'Appearance'),
      h(
        'p',
        { class: 'muted' },
        'The theme follows your system by default; your choice is remembered on this device.',
      ),
      themeButton,
    ),
    h(
      'section',
      { class: 'card', 'aria-label': 'Stored data' },
      h('h2', {}, 'Stored data'),
      dataBox,
    ),
    h(
      'section',
      { class: 'card', 'aria-label': 'Help and information' },
      h('h2', {}, 'Help and information'),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          { class: 'btn secondary', type: 'button', onclick: () => ctx.openDialog('about-dialog') },
          'About PathwayScope',
        ),
        h(
          'button',
          {
            class: 'btn secondary',
            type: 'button',
            onclick: () => ctx.openDialog('sources-dialog'),
          },
          'Data sources',
        ),
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-label': 'Keyboard shortcuts' },
      h('h2', {}, 'Keyboard shortcuts'),
      h(
        'table',
        { class: 'data' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', { scope: 'col' }, 'Keys'), h('th', { scope: 'col' }, 'Action')),
        ),
        h(
          'tbody',
          {},
          SHORTCUTS.map(([keys, what]) =>
            h('tr', {}, h('td', {}, h('kbd', {}, keys)), h('td', {}, what)),
          ),
        ),
      ),
    ),
  );

  return {
    // Called whenever the view is shown: reloads the stored-data lists so they are never stale.
    show() {
      syncTheme();
      return manager.refresh();
    },
  };
}

// Light/dark theme: remembers the choice (try/catch storage) and defaults to the system preference.
const KEY = 'ps:theme';

// Reads the saved theme, or null if none/blocked.
function readSaved() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

// Applies a theme to <html data-theme> and updates the toggle button state.
function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.setAttribute('aria-pressed', String(theme === 'dark'));
}

// Sets the initial theme (saved choice, else system preference).
export function initTheme() {
  apply(
    readSaved() ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
}

// Flips the theme and remembers it.
export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  apply(next);
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked: the choice just won't persist.
  }
}

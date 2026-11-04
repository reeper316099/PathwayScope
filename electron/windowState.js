// Remembers window size/position between launches in userData/window-state.json.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATE = { width: 1280, height: 820 };

// Loads saved bounds, falling back to defaults if the file is missing or invalid.
export function loadWindowState(dir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'window-state.json'), 'utf8'));
    const ok = ['width', 'height'].every(
      (k) => Number.isInteger(s[k]) && s[k] >= 200 && s[k] <= 10000,
    );
    const pos = Number.isInteger(s.x) && Number.isInteger(s.y) ? { x: s.x, y: s.y } : {};
    return ok
      ? { width: s.width, height: s.height, ...pos, maximized: s.maximized === true }
      : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

// Writes the current (non-maximized) bounds so the next launch restores them.
export function saveWindowState(dir, win) {
  try {
    const bounds =
      win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(
      path.join(dir, 'window-state.json'),
      JSON.stringify({ ...bounds, maximized: win.isMaximized() }),
    );
  } catch {
    // Not being able to save window size is harmless.
  }
}

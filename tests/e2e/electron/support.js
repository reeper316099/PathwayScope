// Electron e2e helpers: launch the built app with its own (temporary or reused) user-data folder, in the background.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..');

// Creates a fresh temporary user-data directory.
export const newUserData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ps-e2e-'));

// Launches the app (built with `npm run build:electron`) without stealing focus; returns { app, win, errors }.
export async function launch(userData = newUserData()) {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: root,
    env: { ...process.env, PATHWAYSCOPE_BACKGROUND: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => m.type() === 'error' && errors.push(`console.error: ${m.text()}`));
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await win.setViewportSize({ width: 1400, height: 900 });
  await win.waitForFunction(
    () => !document.getElementById('data-status').textContent.includes('loading'),
    null,
    { timeout: 60_000 },
  );
  return { app, win, errors, userData };
}

// Runs an enrichment analysis in the open window with the given text and waits for results.
export async function runEnrichment(win, text) {
  await win.click('a[data-mode=enrichment]');
  await win.locator('#gene-list').fill(text);
  await win.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await win.locator('.results .facts').waitFor({ timeout: 90_000 });
}

// Lists the JSON files in the app's disk cache folder.
export function cacheFiles(userData) {
  const dir = path.join(userData, 'pathwayscope-data-cache');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
}

// Puts the renderer offline (navigator.onLine false) AND makes the main process's fetch fail, as a real outage would.
export async function goOffline(app) {
  await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.__realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed (simulated outage)');
    };
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Network.enable');
    await wc.debugger.sendCommand('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  });
}

export { expect };

// Clicks a native menu item by its label (synthetic keystrokes cannot reach native accelerators).
export function clickMenu(app, label) {
  return app.evaluate(({ Menu }, l) => {
    const find = (items) => {
      for (const i of items) {
        if (i.label === l) return i;
        if (i.submenu) {
          const f = find(i.submenu.items);
          if (f) return f;
        }
      }
      return null;
    };
    find(Menu.getApplicationMenu().items).click();
  }, label);
}

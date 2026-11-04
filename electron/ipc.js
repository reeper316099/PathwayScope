// Registers the IPC handlers behind window.api: fetchJson, saveFile, openExternal, getAppInfo, listCache, deleteCacheEntry.
import fs from 'node:fs/promises';
import { performFetch } from './remoteFetch.js';
import {
  RequestError,
  validateCacheKey,
  validateExternalUrl,
  validateFetchRequest,
  validateSaveRequest,
} from './validate.js';

// Wires every handler; the sender check ensures only our own window can call them.
export function registerIpc({
  app,
  ipcMain,
  dialog,
  shell,
  cache,
  limiter,
  getWindow,
  isTrustedUrl,
}) {
  // Rejects IPC calls that do not come from the top-level frame of our own window.
  const trusted = (event) => {
    const win = getWindow();
    return (
      Boolean(win) &&
      event.sender === win.webContents &&
      event.senderFrame === win.webContents.mainFrame &&
      isTrustedUrl(event.senderFrame.url)
    );
  };
  // Wraps a handler so validation errors become {ok:false,error} instead of thrown IPC errors.
  const guarded =
    (fn) =>
    async (event, ...args) => {
      if (!trusted(event))
        return { ok: false, error: 'Untrusted sender.', code: 'untrusted-sender' };
      try {
        return await fn(...args);
      } catch (error) {
        return {
          ok: false,
          error: error.message,
          code: error instanceof RequestError ? error.code : 'internal',
        };
      }
    };

  ipcMain.handle(
    'api:fetchJson',
    guarded((url, options) => performFetch(validateFetchRequest(url, options), { cache, limiter })),
  );

  ipcMain.handle(
    'api:listCache',
    guarded(async () => {
      const entries = await cache.list();
      return {
        ok: true,
        folder: cache.dir,
        totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
        entries,
      };
    }),
  );

  ipcMain.handle(
    'api:deleteCacheEntry',
    guarded(async (key) => {
      const checked = validateCacheKey(key);
      if (checked === 'all') return { ok: true, removed: await cache.clear() };
      return { ok: true, removed: (await cache.delete(checked)) ? 1 : 0 };
    }),
  );

  ipcMain.handle(
    'api:openExternal',
    guarded(async (url) => {
      await shell.openExternal(validateExternalUrl(url));
      return { ok: true };
    }),
  );

  ipcMain.handle(
    'api:saveFile',
    guarded(async (req) => {
      const { defaultName, content, encoding } = validateSaveRequest(req);
      const result = await dialog.showSaveDialog(getWindow(), { defaultPath: defaultName });
      if (result.canceled || !result.filePath) return { ok: true, saved: false };
      await fs.writeFile(result.filePath, Buffer.from(content, encoding));
      return { ok: true, saved: true };
    }),
  );

  ipcMain.handle(
    'api:getAppInfo',
    guarded(async () => ({
      ok: true,
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      packaged: app.isPackaged,
    })),
  );
}

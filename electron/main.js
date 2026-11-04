// Electron main process: secure window, menu, IPC, disk cache. The renderer gets no network or Node access.
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LIMITS } from './allowlist.js';
import { DiskCache } from './diskCache.js';
import { registerIpc } from './ipc.js';
import { buildMenu } from './menu.js';
import { RateLimiter } from './remoteFetch.js';
import { RequestError, validateExternalUrl } from './validate.js';
import { loadWindowState, saveWindowState } from './windowState.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.ELECTRON_DEV_URL || null; // set by scripts/dev-electron.mjs only
// Background mode: show the window without stealing focus or bouncing the Dock (used by tests and `dev:electron:bg`).
const BACKGROUND = process.env.PATHWAYSCOPE_BACKGROUND === '1';
const DIST_DIR = path.join(here, '..', 'dist');
const ICON_PATH = path.join(here, '..', 'build', 'icon.png');
const APP_URL = DEV_URL ?? pathToFileURL(path.join(DIST_DIR, 'index.html')).href;

let mainWindow = null;

// True if a URL belongs to our own app (dev server origin, or a file inside dist/).
function isTrustedUrl(url) {
  if (DEV_URL) return url.startsWith(DEV_URL);
  return url.startsWith(pathToFileURL(DIST_DIR).href);
}

// Opens an allowlisted https URL in the system browser; silently ignores anything else.
function openLink(url) {
  try {
    shell.openExternal(validateExternalUrl(url));
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
  }
}

// Forwards a menu action (and optional payload) to the renderer.
function send(action, payload) {
  mainWindow?.webContents.send('menu:action', { action, payload });
}

// Lets the user pick a session .json file in main (the renderer never touches the file system).
async function openSessionFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Session', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const stat = await fs.stat(result.filePaths[0]);
  if (stat.size > LIMITS.maxSessionFileBytes) {
    dialog.showErrorBox('File too large', 'This session file is too large to open.');
    return;
  }
  send('openSession', await fs.readFile(result.filePaths[0], 'utf8'));
}

// Hardens a session: deny every permission request and (in dev) apply a CSP header since file:// has none.
function hardenSession(ses) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  if (DEV_URL) {
    const devCsp = `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${DEV_URL.replace('http', 'ws')}; object-src 'none'; base-uri 'none'`;
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [devCsp] },
      });
    });
  }
}

// Creates the single main window with all security switches on.
function createWindow() {
  const state = loadWindowState(app.getPath('userData'));
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1000,
    minHeight: 700,
    title: 'PathwayScope',
    icon: fsSync.existsSync(ICON_PATH) ? ICON_PATH : undefined, // packaged apps get their icon from electron-builder instead
    backgroundColor: '#1E1B4B',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () =>
    BACKGROUND ? mainWindow.showInactive() : mainWindow.show(),
  );
  mainWindow.on('close', () => saveWindowState(app.getPath('userData'), mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Never open new windows; allowlisted https links go to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  // Block every navigation away from the app (link clicks, redirects, location changes).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow.webContents.getURL()) return;
    event.preventDefault();
    openLink(url);
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.loadURL(APP_URL);
}

// Starts the app: single-instance lock, security, IPC, menu, window.
function start() {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (!mainWindow || BACKGROUND) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (BACKGROUND) app.dock?.hide();
    hardenSession(session.defaultSession);
    const cache = new DiskCache(path.join(app.getPath('userData'), 'pathwayscope-data-cache'));
    registerIpc({
      app,
      ipcMain,
      dialog,
      shell,
      cache,
      limiter: new RateLimiter(),
      getWindow: () => mainWindow,
      isTrustedUrl,
    });
    buildMenu({
      isMac: process.platform === 'darwin',
      send,
      onOpenSession: () =>
        openSessionFile().catch((e) => dialog.showErrorBox('Could not open session', e.message)),
      onClearCache: async () => send('cacheCleared', { removed: await cache.clear() }),
      openLink,
      quit: () => app.quit(),
    });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

start();

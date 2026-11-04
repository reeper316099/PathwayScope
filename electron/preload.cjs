// Preload (CommonJS: sandboxed preloads cannot be ES modules). Exposes a tiny, validated API; no Node APIs leak.
const { contextBridge, ipcRenderer } = require('electron');

// Throws early in the renderer if an argument has the wrong type (main re-validates everything anyway).
function expect(condition, message) {
  if (!condition) throw new TypeError(message);
}

// Copies only the option fields the main process understands.
function pickFetchOptions(options = {}) {
  expect(options && typeof options === 'object', 'options must be an object');
  const { method, headers, body, cacheTtlSeconds, timeoutMs } = options;
  return { method, headers, body, cacheTtlSeconds, timeoutMs };
}

contextBridge.exposeInMainWorld('api', {
  // Fetches a URL via the main process (allowlist, rate limit, disk cache).
  fetchJson: (url, options) => {
    expect(typeof url === 'string', 'url must be a string');
    return ipcRenderer.invoke('api:fetchJson', url, pickFetchOptions(options));
  },
  // Asks main to show a native "Save as" dialog and write the file.
  saveFile: (request) => {
    expect(request && typeof request === 'object', 'request must be an object');
    const { defaultName, content, encoding } = request;
    return ipcRenderer.invoke('api:saveFile', { defaultName, content, encoding });
  },
  // Opens an allowlisted https link in the system browser.
  openExternal: (url) => {
    expect(typeof url === 'string', 'url must be a string');
    return ipcRenderer.invoke('api:openExternal', url);
  },
  // Returns app name/version/platform for the About dialog.
  getAppInfo: () => ipcRenderer.invoke('api:getAppInfo'),
  // One-way subscription to native menu actions (a 5th function beyond the original four; see report).
  onMenuAction: (callback) => {
    expect(typeof callback === 'function', 'callback must be a function');
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('menu:action', listener);
    return () => ipcRenderer.removeListener('menu:action', listener);
  },
});

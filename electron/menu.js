// Builds the native application menu; items send "menu actions" to the renderer or run main-process tasks.
import { Menu } from 'electron';

// Creates and installs the menu. `send(action, payload)` forwards actions to the renderer.
export function buildMenu({
  isMac,
  send,
  onOpenSession,
  onClearCache,
  onShowDataFolder,
  openLink,
  quit,
}) {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(action) });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Session…', accelerator: 'CmdOrCtrl+O', click: onOpenSession },
        item('Save Session…', 'CmdOrCtrl+S', 'saveSession'),
        item('Export CSV…', 'CmdOrCtrl+E', 'exportCsv'),
        { type: 'separator' },
        item('Manage Stored Data…', null, 'manageData'),
        { label: 'Show Data Folder', click: onShowDataFolder },
        { label: 'Clear Cache', click: onClearCache },
        { type: 'separator' },
        { label: 'Quit', accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q', click: quit },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        item('Focus Search', 'CmdOrCtrl+K', 'focusSearch'),
        item('Gene Explorer', 'CmdOrCtrl+1', 'mode:explorer'),
        item('Enrichment Analysis', 'CmdOrCtrl+2', 'mode:enrichment'),
        item('Pathway Browser', 'CmdOrCtrl+3', 'mode:browser'),
        item('Settings', 'CmdOrCtrl+4', 'mode:settings'),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        item('Toggle Dark Mode', 'CmdOrCtrl+D', 'toggleTheme'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        item('About PathwayScope', null, 'about'),
        item('Data Sources', null, 'dataSources'),
        { type: 'separator' },
        {
          label: 'GitHub Repository',
          click: () => openLink('https://github.com/reeper316099/PathwayScope'),
        },
        {
          label: 'Report an Issue',
          click: () => openLink('https://github.com/reeper316099/PathwayScope/issues'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

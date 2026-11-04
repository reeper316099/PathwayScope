// E2E against the PACKAGED desktop binary (not `electron .`): set PS_PACKAGED_APP to the executable inside the built app, e.g.
//   PS_PACKAGED_APP="<release>/mac-arm64/PathwayScope.app/Contents/MacOS/PathwayScope" npm run test:e2e:packaged
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const exe = process.env.PS_PACKAGED_APP;
const list50 = fs.readFileSync(new URL('../../fixtures/gene-list-50.txt', import.meta.url), 'utf8');

test.skip(!exe, 'Set PS_PACKAGED_APP to the packaged executable to run this test.');

test('packaged app: launches, is hardened, runs a gene search and an enrichment analysis (GET and POST through IPC)', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-packaged-'));
  const app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userData}`],
    env: { ...process.env, PATHWAYSCOPE_BACKGROUND: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: 1400, height: 900 });

  const info = await app.evaluate(({ app: a }) => ({
    packaged: a.isPackaged,
    version: a.getVersion(),
    name: a.getName(),
  }));
  expect(info).toEqual({ packaged: true, version: '0.1.0', name: 'PathwayScope' });
  expect(await win.title()).toBe('PathwayScope');
  expect(await win.evaluate(() => [typeof require, typeof process])).toEqual([
    'undefined',
    'undefined',
  ]);
  expect(
    await win.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    ),
  ).toContain("connect-src 'self'");
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      sandbox: p.sandbox,
    };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  await win.waitForFunction(
    () => !document.getElementById('data-status').textContent.includes('loading'),
    null,
    { timeout: 60_000 },
  );
  expect(await win.locator('#about-version').textContent()).toBe(
    'Version 0.1.0 · Electron 45.2.2 · ' + process.platform,
  );

  // the packaged app opens on Home; go to Gene Explorer for the lookup
  await expect(win.locator('[data-view=home]')).toBeVisible();
  await win.click('a[data-mode=explorer]');

  // gene search (GET via the main process)
  await win.fill('#gene-input', 'TP53');
  await win.click('[data-view=explorer] .inline-form .btn');
  await expect(win.locator('.gene-title')).toHaveText('TP53', { timeout: 60_000 });
  await expect(win.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 60_000,
  });
  await expect(win.locator('.pathway-item').first()).toBeAttached();

  // enrichment (POST via the main process), chart, network and diagram
  await win.click('a[data-mode=enrichment]');
  await win.locator('#gene-list').fill(list50);
  await win.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await expect(win.locator('.results .facts')).toContainText('50 of 50 (100.0%) mapped', {
    timeout: 90_000,
  });
  await expect(win.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  });
  await expect(win.locator('.chart-box canvas')).toBeVisible();
  await win.click('a[data-mode=browser]');
  await win.locator('.tree-card input[type=search]').fill('Cell Cycle Checkpoints');
  await win.locator('.tree-row', { hasText: 'Cell Cycle Checkpoints' }).first().click();
  await expect(win.locator('.detail-card svg.diagram-svg')).toBeVisible({ timeout: 90_000 });

  expect(fs.readdirSync(path.join(userData, 'pathwayscope-data-cache')).length).toBeGreaterThan(5);
  expect(errors).toEqual([]);
  await win.screenshot({ path: 'docs/screenshots/packaged-mac-arm64.png' });
  await app.close();
});

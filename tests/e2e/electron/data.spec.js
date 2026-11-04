// Electron e2e: "Manage stored data" lists and deletes cached lookups on disk, history and sessions, one by one or all at once.
import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { cacheFiles, clickMenu, expect, launch, newUserData, runEnrichment } from './support.js';

test('Manage stored data: list, delete one cached lookup (really removed from disk), clear history, delete sessions, delete everything', async () => {
  const userData = newUserData();
  let run = await launch(userData);
  await run.win.fill('#gene-input', 'TP53');
  await run.win.click('[data-view=explorer] .inline-form .btn');
  await expect(run.win.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 60_000,
  });
  await runEnrichment(run.win, 'TP53\nBRCA1\nATM\nCHEK2');
  await expect(run.win.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  });
  await run.win.waitForTimeout(1200);

  await clickMenu(run.app, 'Manage Stored Data…');
  const dialog = run.win.locator('#data-manager');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    'gene symbols and gene lists you enter ARE sent to the public Reactome, UniProt and NCBI',
  );
  await expect(dialog).toContainText(path.join(userData, 'pathwayscope-data-cache'));
  // readable labels, not hashes
  await expect(dialog.locator('table.data')).toContainText('Gene search: TP53');
  await expect(dialog.locator('table.data')).toContainText('Enrichment analysis (4 identifiers)');
  await expect(dialog.locator('table.data')).toContainText('Reactome release information');
  const filesBefore = cacheFiles(userData);
  const rowsBefore = await dialog.locator('table.data tbody tr').count();
  expect(rowsBefore).toBe(filesBefore.length);
  // delete one specific lookup: the file and its description disappear from disk
  await dialog.getByRole('button', { name: 'Delete cached item: Gene search: TP53' }).click();
  await expect(dialog.locator('table.data')).not.toContainText('Gene search: TP53');
  expect(cacheFiles(userData).length).toBe(filesBefore.length - 1);
  const metaFiles = fs
    .readdirSync(path.join(userData, 'pathwayscope-data-cache'))
    .filter((f) => f.endsWith('.meta'));
  expect(metaFiles.length).toBe(filesBefore.length - 1);
  // filter
  await dialog.getByLabel('Filter cached lookups').fill('enrichment');
  await expect(dialog.locator('table.data tbody tr').first()).toContainText('Enrichment');
  await dialog.getByLabel('Filter cached lookups').fill('');
  // history: remove one entry, then clear all
  await expect(dialog).toContainText('History (');
  const historyBefore = await dialog
    .locator('section', { hasText: 'History (' })
    .first()
    .locator('li')
    .count();
  expect(historyBefore).toBeGreaterThanOrEqual(2);
  await dialog
    .locator('section', { hasText: 'History (' })
    .first()
    .locator('.icon-x')
    .first()
    .click();
  await expect(
    dialog.locator('section', { hasText: 'History (' }).first().locator('li'),
  ).toHaveCount(historyBefore - 1);
  await dialog.getByRole('button', { name: 'Clear history' }).click();
  await expect(dialog).toContainText('History (0)');
  await expect(run.win.locator('#history-list')).toContainText('No searches or analyses yet.');
  // saved sessions: delete all
  await expect(dialog).toContainText('Saved sessions (1)');
  await dialog.getByRole('button', { name: 'Delete all sessions' }).click();
  await expect(dialog).toContainText('Saved sessions (0)');
  await expect(run.win.locator('#sessions-list')).toContainText('No saved sessions yet.');
  // clear all cached data
  await dialog.getByRole('button', { name: 'Clear all cached data' }).click();
  await expect(dialog).toContainText('Nothing cached.');
  expect(cacheFiles(userData)).toEqual([]);
  await run.app.close();

  // delete everything needs a confirmation, then reloads with nothing left
  run = await launch(userData);
  await run.win.fill('#gene-input', 'BRCA1');
  await run.win.click('[data-view=explorer] .inline-form .btn');
  await expect(run.win.locator('.gene-title')).toHaveText('BRCA1', { timeout: 60_000 });
  await runEnrichment(run.win, 'TP53\nATM');
  await run.win.waitForTimeout(1200);
  await clickMenu(run.app, 'Manage Stored Data…');
  const d2 = run.win.locator('#data-manager');
  await d2.getByRole('button', { name: 'Delete everything…' }).click();
  await expect(d2).toContainText('Really delete everything?');
  await d2.getByRole('button', { name: 'Cancel' }).click();
  expect(cacheFiles(userData).length).toBeGreaterThan(0); // cancel really cancels
  await d2.getByRole('button', { name: 'Delete everything…' }).click();
  await d2.getByRole('button', { name: 'Yes, delete everything' }).click();
  await run.win.waitForFunction(
    () => !document.getElementById('data-status').textContent.includes('loading'),
    null,
    { timeout: 60_000 },
  );
  await expect(run.win.locator('#history-list')).toContainText('No searches or analyses yet.');
  await expect(run.win.locator('#sessions-list')).toContainText('No saved sessions yet.');
  // (the reloaded app has already re-fetched the release info for its footer, so only that one entry may exist)
  expect(cacheFiles(userData).length).toBeLessThanOrEqual(1);
  await run.app.close();
});

test('Manage stored data: the IPC delete call refuses anything that is not one of our cache keys', async () => {
  const { app, win } = await launch();
  const del = (key) => win.evaluate((k) => window.api.deleteCacheEntry(k), key);
  for (const bad of ['../../etc/passwd', '', 'abc', '/', 'ALL'])
    expect(await del(bad)).toMatchObject({ ok: false, code: 'bad-key' });
  expect(await win.evaluate(() => window.api.listCache())).toMatchObject({ ok: true });
  await app.close();
});

test('Manage stored data: File menu has Show Data Folder and Manage Stored Data (which opens Settings)', async () => {
  const { app, win } = await launch();
  const labels = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find((i) => i.label === 'File')
      .submenu.items.map((i) => i.label),
  );
  expect(labels).toEqual(
    expect.arrayContaining(['Manage Stored Data…', 'Show Data Folder', 'Clear Cache']),
  );
  await clickMenu(app, 'Manage Stored Data…');
  await expect(win.locator('[data-view=settings]')).toBeVisible();
  await expect(win.locator('a[data-mode=settings]')).toHaveAttribute('aria-current', 'page');
  await clickMenu(app, 'Gene Explorer');
  await clickMenu(app, 'Settings');
  await expect(win.locator('[data-view=settings] h1')).toHaveText('Settings');
  await app.close();
});

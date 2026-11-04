// Generates the Electron window screenshots (docs/screenshots) from the built desktop app and live Reactome data.
import fs from 'node:fs';
import { test } from '@playwright/test';
import { clickMenu, expect, launch } from './support.js';

test('screenshots: Electron window (light and dark) for each mode', async () => {
  const { app, win, errors } = await launch();
  const list = fs.readFileSync(new URL('../../fixtures/gene-list-50.txt', import.meta.url), 'utf8');
  await win.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await win.fill('#gene-input', 'TP53');
  await win.click('.inline-form .btn');
  await expect(win.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 60_000,
  });
  await win.waitForTimeout(500);
  await win.screenshot({ path: 'docs/screenshots/electron-explorer.png' });
  await win.click('a[data-mode=enrichment]');
  await win.locator('#gene-list').fill(list);
  await win.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await expect(win.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 90_000,
  });
  await win.waitForTimeout(800);
  await win.locator('.viz-grid').scrollIntoViewIfNeeded();
  await win.waitForTimeout(500);
  await win.screenshot({ path: 'docs/screenshots/electron-enrichment.png' });
  await win.click('a[data-mode=browser]');
  await win.locator('.tree-card input[type=search]').fill('Cell Cycle Checkpoints');
  await win.locator('.tree-row', { hasText: 'Cell Cycle Checkpoints' }).first().click();
  await expect(win.locator('.detail-card svg.diagram-svg')).toBeVisible({ timeout: 90_000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: 'docs/screenshots/electron-browser.png' });
  await win.click('#theme-toggle');
  await win.waitForTimeout(600);
  await win.screenshot({ path: 'docs/screenshots/electron-browser-dark.png' });
  await win.click('#theme-toggle');
  await clickMenu(app, 'Manage Stored Data…');
  await expect(win.locator('#data-manager table.data')).toBeVisible();
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'docs/screenshots/electron-settings.png' });
  expect(errors).toEqual([]);
  await app.close();
});

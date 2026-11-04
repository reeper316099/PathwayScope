// Shared e2e helpers: a `test` that fails on console errors / uncaught exceptions / unhandled rejections, and UI helpers.
import { expect, test as base } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Browser-reported 404s are logged as console errors; tests that EXPECT a 404 allow them explicitly.
export const ALLOW_404 = /Failed to load resource: the server responded with a status of 404/;

export const test = base.extend({
  // `problems.allow(regex)` whitelists expected messages; any other error fails the test at teardown.
  problems: [
    async ({ page }, use) => {
      const seen = [];
      const allowed = [];
      page.on('console', (m) => m.type() === 'error' && seen.push(`console.error: ${m.text()}`));
      page.on('pageerror', (e) => seen.push(`pageerror: ${e.message}`));
      await page.addInitScript(() =>
        window.addEventListener('unhandledrejection', (e) =>
          console.error(`unhandledrejection: ${e.reason?.message ?? e.reason}`),
        ),
      );
      const api = { allow: (re) => allowed.push(re), seen };
      await use(api);
      const bad = seen.filter((m) => !allowed.some((re) => re.test(m)));
      expect(bad, `unexpected console errors:\n${bad.join('\n')}`).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

// Absolute path of a file in tests/fixtures.
export const fixturePath = (name) =>
  path.resolve(import.meta.dirname, '..', '..', 'fixtures', name);

// Reads a fixture text file.
export const readFixture = (name) => fs.readFileSync(fixturePath(name), 'utf8');

// Opens the Enrichment mode, pastes text and clicks Run; resolves when results or an error state appear.
export async function runEnrichment(page, text, { waitFor = '.results .facts' } = {}) {
  await page.goto('/#/enrichment');
  await page.locator('#gene-list').fill(text);
  await expect(page.locator('#list-preview')).not.toHaveText(/Nothing pasted yet/);
  await page.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await page.locator(waitFor).first().waitFor({ timeout: 90_000 });
}

// Asserts every results panel rendered: header, interpretation, chart canvas, network canvas, table rows.
export async function expectFullResults(page) {
  await expect(page.locator('.results .facts')).toBeVisible();
  await expect(page.locator('.card[aria-label="What this means"] li').first()).toBeVisible();
  await expect(page.locator('.chart-box canvas')).toBeVisible();
  await expect(page.locator('.network-box canvas').first()).toBeAttached();
  await expect(page.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  });
  await expect(page.locator('.card[aria-label="Results table"] tbody tr').first()).toBeVisible();
}

// Returns the visible text of the results header facts.
export const factsText = (page) => page.locator('.results .facts').innerText();

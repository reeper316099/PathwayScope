// Web e2e: blocked services, slow network, partial failures, mobile viewport and dark mode.
import { expect, expectFullResults, runEnrichment, test } from '../support/collect.js';

// Console errors caused by deliberately blocked requests are expected in these tests.
const BLOCKED = /Failed to load resource|net::ERR|Failed to fetch/;

test('blocked Analysis Service: friendly error with Try again, then recovery', async ({
  page,
  problems,
}) => {
  problems.allow(BLOCKED);
  await page.route('**/AnalysisService/**', (route) => route.abort());
  await runEnrichment(page, 'TP53\nBRCA1\nATM', { waitFor: '.results .state.error' });
  await expect(page.locator('.results .state.error')).toContainText(
    "can't be reached from the browser",
  );
  await page.unroute('**/AnalysisService/**');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.results .facts')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#banner')).toBeHidden();
});

test('blocked Content Service: Gene Explorer shows the browser banner and an error with retry', async ({
  page,
  problems,
}) => {
  problems.allow(BLOCKED);
  await page.route('**/ContentService/**', (route) => route.abort());
  await page.goto('/#/explorer/TP53');
  await expect(page.locator('.explorer-result .state.error')).toContainText(
    "can't be reached from the browser",
  );
  await expect(page.locator('#banner')).toContainText(
    "This data source can't be reached from the browser. Download the desktop app for full functionality.",
  );
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('slow network: skeleton and progress text show while the analysis runs, then results arrive', async ({
  page,
}) => {
  await page.route('**/AnalysisService/**', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await page.goto('/#/enrichment');
  await page.locator('#gene-list').fill('TP53\nBRCA1\nATM\nCHEK2');
  await page.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await expect(page.locator('.results .skeleton')).toBeVisible();
  await expect(page.locator('p[aria-live=polite]').last()).toContainText(
    /Submitting 4 identifiers|Downloading|Starting/,
  );
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(page.locator('.results .facts')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Run enrichment analysis' })).toBeVisible();
});

test('cancel: a running analysis can be cancelled', async ({ page }) => {
  await page.route('**/AnalysisService/**', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await page.goto('/#/enrichment');
  await page.locator('#gene-list').fill('TP53\nBRCA1');
  await page.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.results .state.empty')).toContainText('Analysis cancelled');
});

test('partial state: diagram fails but participants, summary and references still show, with a warning-style error for the diagram', async ({
  page,
  problems,
}) => {
  problems.allow(BLOCKED);
  await page.route('**/exporter/diagram/**', (route) => route.abort());
  await page.goto('/#/browser/R-HSA-69620');
  await expect(page.locator('.detail-card h2')).toHaveText('Cell Cycle Checkpoints', {
    timeout: 60_000,
  });
  await expect(
    page.locator('.detail-card .section').filter({ hasText: 'Diagram' }).locator('.state.error'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.detail-card table.data tbody tr').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.locator('.detail-card .section').filter({ hasText: 'Summary' }).first(),
  ).toBeVisible();
});

test('partial state: when the analysis overlay fails, the plain diagram is shown with a visible warning', async ({
  page,
  problems,
}) => {
  problems.allow(/Failed to load resource: the server responded with a status of 404/); // the 404 is this test's own mocked response
  await runEnrichment(page, 'TP53\nBRCA1\nATM\nCHEK2');
  await page.route(/exporter\/diagram\/.*token=/, (route) =>
    route.fulfill({ status: 404, body: '{"code":404}' }),
  );
  await page.goto('/#/browser/R-HSA-69620');
  await expect(page.locator('.detail-card svg.diagram-svg')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.detail-card .note.warn')).toContainText(
    'analysis highlighting could not be loaded',
  );
});

test.describe('mobile viewport 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('layout fits, tab bar is fixed, gene search and enrichment work', async ({ page }) => {
    await page.goto('/#/explorer/TP53');
    await expect(page.locator('.gene-title')).toHaveText('TP53');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    expect(await page.locator('.rail').evaluate((el) => getComputedStyle(el).position)).toBe(
      'fixed',
    );
    await runEnrichment(page, 'TP53\nBRCA1\nATM\nCHEK2');
    await expectFullResults(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: 'docs/screenshots/web-mobile-enrichment.png', fullPage: false });
  });
});

test.describe('dark mode', () => {
  test.use({ colorScheme: 'dark' });
  test('follows the system preference, can be toggled, and is remembered', async ({ page }) => {
    await page.goto('/#/explorer/TP53');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test('keyboard shortcuts (browser): Ctrl+K focuses search, Ctrl+1/2/3 switch modes, Ctrl+D toggles dark mode', async ({
  page,
}) => {
  await page.goto('/#/explorer');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.press('Control+2');
  await expect(page).toHaveURL(/#\/enrichment/);
  await page.keyboard.press('Control+3');
  await expect(page).toHaveURL(/#\/browser/);
  await page.keyboard.press('Control+1');
  await expect(page).toHaveURL(/#\/explorer/);
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.keyboard.press('Control+d');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme);
});

test('About dialog states the limitations, and the tree supports keyboard navigation', async ({
  page,
}) => {
  await page.goto('/#/browser');
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: 60_000 });
  const first = page.locator('.tree-row').first();
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tree-row').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(first).toBeFocused();
  await page.getByRole('button', { name: 'About' }).click();
  await expect(page.locator('#about-dialog')).toContainText('hypothesis-generating');
  await expect(page.locator('#about-dialog')).toContainText('Human pathways only');
  await expect(page.locator('#about-dialog')).toContainText('not medical advice');
});

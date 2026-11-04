// Generates the README screenshots (docs/screenshots) from the real web build and live Reactome data.
import { expect, readFixture, test } from '../support/collect.js';

const OUT = 'docs/screenshots';

// Opens all three modes with a real analysis active and saves one screenshot per mode.
async function shoot(page, prefix) {
  await page.goto('/#/explorer/TP53');
  await expect(page.locator('.pathway-item').first()).toBeAttached();
  await expect(page.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${prefix}-explorer.png` });
  await page.goto('/#/enrichment');
  await page.locator('#gene-list').fill(readFixture('gene-list-50.txt'));
  await page.getByRole('button', { name: 'Run enrichment analysis' }).click();
  await expect(page.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 90_000,
  });
  await page.waitForTimeout(800);
  await page.locator('.results').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/${prefix}-enrichment-results.png`, fullPage: false });
  await page.locator('.viz-grid').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${prefix}-enrichment-charts.png`, fullPage: false });
  await page.getByRole('link', { name: /Pathway Browser/ }).click();
  await page.locator('.tree-card input[type=search]').fill('Cell Cycle Checkpoints');
  await page.locator('.tree-row', { hasText: 'Cell Cycle Checkpoints' }).first().click();
  await expect(page.locator('.detail-card svg.diagram-svg')).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${prefix}-browser.png` });
  await page.getByRole('button', { name: 'Manage stored data' }).click();
  await expect(page.locator('#data-manager table.data')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${prefix}-settings.png` });
}

test('screenshots: desktop light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await shoot(page, 'web-desktop-light');
});

test.describe('dark', () => {
  test.use({ colorScheme: 'dark' });
  test('screenshots: desktop dark', async ({ page }) => {
    await shoot(page, 'web-desktop-dark');
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  test('screenshots: mobile web', async ({ page }) => {
    await shoot(page, 'web-mobile');
  });
});

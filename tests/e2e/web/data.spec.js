// Web e2e: "Manage stored data" in the browser build (localStorage-backed).
import { expect, readFixture, runEnrichment, test } from '../support/collect.js';

test('Manage stored data (web): labeled entries, delete one, clear history, delete sessions, delete everything', async ({
  page,
}) => {
  await page.goto('/#/explorer/TP53');
  await expect(page.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 30_000,
  });
  await runEnrichment(page, 'TP53\nBRCA1\nATM\nCHEK2');
  await expect(page.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  }); // all background requests done
  await page.getByRole('button', { name: 'Manage stored data' }).click();
  const dialog = page.locator('#data-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("browser's local storage");
  await expect(dialog).toContainText('ARE sent to the public Reactome, UniProt and NCBI');
  await expect(dialog.locator('table.data')).toContainText('Gene search: TP53');
  await expect(dialog.locator('table.data')).toContainText('Enrichment analysis (4 identifiers)');
  const before = await dialog.locator('table.data tbody tr').count();
  await dialog.getByRole('button', { name: 'Delete cached item: Gene search: TP53' }).click();
  await expect(dialog.locator('table.data')).not.toContainText('Gene search: TP53');
  expect(await dialog.locator('table.data tbody tr').count()).toBe(before - 1);
  // the deleted lookup really is gone from storage
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter(
          (k) => k.startsWith('ps:cache:') && k.includes('query=TP53'),
        ).length,
    ),
  ).toBe(0);
  await dialog.getByRole('button', { name: 'Clear history' }).click();
  await expect(page.locator('#history-list')).toContainText('No searches or analyses yet.');
  await dialog.getByRole('button', { name: 'Delete all sessions' }).click();
  await expect(page.locator('#sessions-list')).toContainText('No saved sessions yet.');
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ps:session'))),
  ).toEqual([]);
  await dialog.getByRole('button', { name: 'Clear all cached data' }).click();
  await expect(dialog).toContainText('Nothing cached.');
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ps:cache:'))),
  ).toEqual([]);
});

test('rail: history entries have their own remove button and a Clear history link', async ({
  page,
}) => {
  await page.goto('/#/explorer/TP53');
  await expect(page.locator('.gene-title')).toHaveText('TP53');
  await page.goto('/#/explorer/BRCA1');
  await expect(page.locator('.gene-title')).toHaveText('BRCA1');
  const items = page.locator('#history-list li');
  await expect(items).toHaveCount(2);
  await page.getByRole('button', { name: 'Remove Gene BRCA1 from history' }).click();
  await expect(items).toHaveCount(1);
  await page.locator('#history-list').getByRole('button', { name: 'Clear history' }).click();
  await expect(page.locator('#history-list')).toContainText('No searches or analyses yet.');
});

test('Delete everything (web) asks for confirmation, then wipes history, sessions and cache and reloads', async ({
  page,
}) => {
  await runEnrichment(page, readFixture('gene-list-50.txt').split('\n').slice(0, 12).join('\n'));
  await page.getByRole('button', { name: 'Manage stored data' }).click();
  const dialog = page.locator('#data-dialog');
  await dialog.getByRole('button', { name: 'Delete everything…' }).click();
  await expect(dialog).toContainText('Really delete everything?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).filter((k) => k.startsWith('ps:session')).length,
    ),
  ).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Delete everything…' }).click();
  await dialog.getByRole('button', { name: 'Yes, delete everything' }).click();
  await page.waitForLoadState('load');
  await expect(page.locator('#history-list')).toContainText('No searches or analyses yet.');
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) => k.startsWith('ps:session') || k === 'ps:history' || k === 'ps:sessions:index',
      ),
    ),
  ).toEqual([]);
});

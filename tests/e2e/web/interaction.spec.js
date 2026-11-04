// Web e2e: selection sync, filtering, sorting, CSV export, and session save/open (live Reactome).
import fs from 'node:fs';
import { expect, expectFullResults, readFixture, runEnrichment, test } from '../support/collect.js';

const table = (page) => page.locator('.card[aria-label="Results table"]');

test.describe.configure({ mode: 'serial' });

test.describe('with a 50-gene analysis', () => {
  let sessionFile;

  test('selection sync: table row -> drawer, tree, chart; network gene -> flagged table rows', async ({
    page,
  }) => {
    await runEnrichment(page, readFixture('gene-list-50.txt'));
    await expectFullResults(page);
    const row = table(page).locator('tbody tr').nth(1);
    const stId = await row.getAttribute('data-stid');
    await row.click();
    await expect(page.locator('#drawer')).toBeVisible();
    await expect(table(page).locator('tr.selected')).toHaveAttribute('data-stid', stId);
    await expect(page.locator('#drawer h2')).not.toBeEmpty();
    await page.locator('#drawer-close').click();
    await expect(page.locator('#drawer')).toBeHidden();
    // gene selection through the accessible text version of the network
    await page.locator('details.fallback summary').click();
    const geneButton = page.locator('details.fallback .link-btn').first();
    const gene = (await geneButton.innerText()).trim();
    await geneButton.click();
    await expect(table(page).locator('tr.has-gene').first()).toBeVisible();
    await expect(table(page).locator('.gene-flag').first()).toContainText(`contains ${gene}`);
    // the pathway selection carries over to the tree in the Pathway Browser
    await page.getByRole('link', { name: /Pathway Browser/ }).click();
    await expect(page.locator(`.tree-row.selected[data-stid="${stId}"]`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('.detail-card h2')).not.toBeEmpty({ timeout: 30_000 });
  });

  test('table: name filter, sorting (numeric and text), FDR cutoff, pagination', async ({
    page,
  }) => {
    await runEnrichment(page, readFixture('gene-list-50.txt'));
    await expectFullResults(page);
    const rows = table(page).locator('tbody tr');
    const total = await rows.count();
    await table(page).getByLabel('Filter results by pathway name').fill('cell cycle');
    await expect.poll(() => rows.count()).toBeLessThan(total);
    for (const text of await table(page).locator('tbody tr td:first-child').allInnerTexts())
      expect(text.toLowerCase()).toContain('cell cycle');
    await table(page).getByLabel('Filter results by pathway name').fill('');
    // numeric sort: entities found, click twice for descending
    const foundHeader = table(page).getByRole('button', { name: /Entities found/ });
    await foundHeader.click();
    await foundHeader.click();
    await expect(table(page).locator('th[aria-sort="descending"]')).toContainText('Entities found');
    const found = (await table(page).locator('tbody tr td:nth-child(2)').allInnerTexts()).map((t) =>
      Number(t.split('/')[0]),
    );
    expect(found).toEqual([...found].sort((a, b) => b - a));
    // text sort
    const nameHeader = table(page).getByRole('button', { name: /^Pathway/ });
    await nameHeader.click();
    const names = (await table(page).locator('tbody tr td:first-child').allInnerTexts()).map((t) =>
      t
        .replace(/\s*R-HSA-\d+[\s\S]*$/, '')
        .trim()
        .toLowerCase(),
    );
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // FDR cutoff slider shrinks the list (display only)
    const info = table(page).locator('p[role=status]');
    const before = await info.innerText();
    await page.locator('#opt-fdr').fill('0.001');
    await expect(info).not.toHaveText(before);
    await expect(info).toContainText('FDR < 0.001');
    // pagination
    await page.locator('#opt-fdr').fill('0.2');
    await table(page).getByRole('button', { name: /Next/ }).click();
    await expect(table(page).locator('.pager')).toContainText('Page 2');
  });

  test('chart: bar/bubble toggle and top-N selection', async ({ page }) => {
    await runEnrichment(page, readFixture('gene-list-50.txt'));
    await expectFullResults(page);
    await page.getByRole('button', { name: 'Bubble chart' }).click();
    await expect(page.getByRole('button', { name: 'Bubble chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.chart-box canvas')).toHaveAttribute('aria-label', /Bubble chart/);
    await page.getByLabel('Number of pathways in the chart').selectOption('20');
    await page.getByRole('button', { name: 'Bar chart' }).click();
    await expect(page.locator('.chart-box canvas')).toHaveAttribute(
      'aria-label',
      /Bar chart of the top 20/,
    );
  });

  test('CSV export contains every result row with the labeled p-value and FDR columns', async ({
    page,
  }) => {
    await runEnrichment(page, readFixture('gene-list-50.txt'));
    await expectFullResults(page);
    const tested = Number(
      (await page.locator('.results .facts').innerText()).match(/computed over (\d+) pathways/)[1],
    );
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('pathwayscope-results.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Pathway ID,Pathway name,Entities found,Entities total,Ratio (found/total),"p-value (hypergeometric, uncorrected)",FDR (Benjamini-Hochberg),Significance,Found identifiers',
    );
    expect(lines.length - 1).toBe(tested);
    expect(lines[1]).toMatch(/^R-HSA-\d+,/);
  });

  test('session save -> reload the app -> open the file restores the analysis (unmapped list included)', async ({
    page,
  }) => {
    await runEnrichment(page, `${readFixture('gene-list-50.txt')}NOTAGENE\n`);
    await expectFullResults(page);
    const before = await page.locator('.results .facts').innerText();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Save session' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('pathwayscope-session.json');
    sessionFile = test.info().outputPath('session.json');
    await download.saveAs(sessionFile);
    const json = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    expect(json.format).toBe('pathwayscope-session');
    expect(json.session.unmappedIdentifiers).toEqual(['NOTAGENE']);
    expect(json.session.inputIdentifiers).toHaveLength(51);
    await page.goto('/?fresh=1#/enrichment');
    await expect(page.locator('.results .state.empty')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles(sessionFile);
    await expect(page.locator('.results .facts')).toBeVisible({ timeout: 90_000 });
    const after = await page.locator('.results .facts').innerText();
    expect(after).toMatch(/51 submitted · 50 of 51/);
    expect(after).toContain('1 of 51');
    expect(after.split('Reactome release')[0]).toBe(before.split('Reactome release')[0]);
    await expectFullResults(page);
  });

  test('opening a malformed session file shows a friendly message', async ({ page }) => {
    await page.goto('/#/enrichment');
    const bad = test.info().outputPath('bad.json');
    fs.writeFileSync(bad, '{"format":"nope"}');
    await page.locator('input[type=file]').setInputFiles(bad);
    await expect(page.locator('#toast')).toContainText(
      'Could not open that file: This is not a PathwayScope session file.',
    );
  });

  test('saved session appears in the rail and can be re-opened', async ({ page }) => {
    await runEnrichment(page, 'TP53\nATM\nCHEK2\nBRCA1');
    await expect(page.locator('#sessions-list .link-btn').first()).toContainText('4 identifiers');
    await page.goto('/#/explorer');
    await page.locator('#sessions-list .link-btn').first().click();
    await expect(page).toHaveURL(/#\/enrichment/);
    await expect(page.locator('.results .facts')).toBeVisible({ timeout: 60_000 });
  });
});

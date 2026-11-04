// Web e2e: Gene Explorer against the live Reactome / UniProt / NCBI services.
import { ALLOW_404, expect, test } from '../support/collect.js';

for (const gene of ['TP53', 'BRCA1', 'EGFR']) {
  test(`Gene Explorer: ${gene} shows a gene card, link-outs and grouped pathways`, async ({
    page,
  }) => {
    await page.goto(`/#/explorer/${gene}`);
    await expect(page.locator('.gene-title')).toHaveText(gene);
    await expect(page.locator('.gene-card')).toContainText(
      /UniProt accession: [A-Z0-9]+ \(human\)/,
    );
    await expect(page.locator('.gene-card')).toContainText(/Protein: .+/);
    await expect(page.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
      timeout: 30_000,
    });
    for (const label of ['ClinVar', 'AlphaFold DB', 'UniProt', 'gnomAD', 'Reactome']) {
      await expect(
        page.locator('.linkouts').getByRole('link', { name: label, exact: true }),
      ).toHaveAttribute('href', /^https:\/\//);
    }
    await expect(page.locator('.pathway-item').first()).toBeAttached();
    expect(await page.locator('.pathway-item').count()).toBeGreaterThan(5);
    expect(await page.locator('.group').count()).toBeGreaterThan(1);
    await expect(page.locator('.interactors')).toContainText(/total; top/, { timeout: 30_000 });
  });
}

test('Gene Explorer: NOTAGENE gives a friendly empty state (no crash)', async ({
  page,
  problems,
}) => {
  problems.allow(ALLOW_404);
  await page.goto('/#/explorer/NOTAGENE');
  await expect(page.locator('.state.empty')).toContainText('No human gene named "NOTAGENE"');
  await expect(page.locator('.gene-card')).toHaveCount(0);
});

test(
  'Gene Explorer: invalid characters are rejected without a request',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/#/explorer');
    await page.locator('#gene-input').fill('bad gene!');
    await page.getByRole('button', { name: 'Explore' }).click();
    await expect(page.locator('.state.empty')).toContainText('Please enter a gene symbol');
  },
);

test('Gene Explorer: alias HER2 is resolved and flagged; clicking a pathway opens the detail drawer with hierarchy context', async ({
  page,
}) => {
  await page.goto('/#/explorer/HER2');
  await expect(page.locator('.gene-title')).toHaveText('ERBB2');
  await expect(page.locator('.gene-card .note.warn')).toContainText('alias');
  await page.locator('.group summary').first().click();
  await page.locator('.pathway-item').first().click();
  await expect(page.locator('#drawer')).toBeVisible();
  await expect(page.locator('#drawer h2')).not.toBeEmpty();
  await expect(page.locator('.crumbs.card .breadcrumb').first()).toBeVisible();
  await expect(page.locator('#drawer table.data tbody tr').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('Gene Explorer: filter and sort controls change the list', async ({ page }) => {
  await page.goto('/#/explorer/TP53');
  await expect(page.locator('.pathway-item').first()).toBeAttached();
  const before = await page.locator('.pathway-item').count();
  await page.getByLabel('Filter pathways by name').fill('apoptosis');
  await expect.poll(() => page.locator('.pathway-item').count()).toBeLessThan(before);
  await page.getByLabel('Sort pathways').selectOption('size');
  await expect(page.locator('.pathway-item').first()).toBeAttached();
});

test('Global search: gene and pathway suggestions navigate', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search-input').fill('apoptosis');
  await expect(page.locator('#search-suggestions li').first()).toContainText('Gene: APOPTOSIS');
  await expect(page.locator('#search-suggestions li').nth(1)).toBeVisible({ timeout: 30_000 });
  await page.locator('#search-input').fill('TP53');
  await page.locator('#search-input').press('Enter');
  await expect(page).toHaveURL(/#\/explorer\/TP53/);
  await expect(page.locator('.gene-title')).toHaveText('TP53');
});

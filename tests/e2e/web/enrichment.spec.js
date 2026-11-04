// Web e2e: Enrichment Analysis input cases (live Reactome). Every run also checks that unmapped identifiers are shown.
import {
  expect,
  expectFullResults,
  factsText,
  readFixture,
  runEnrichment,
  test,
} from '../support/collect.js';

test('Enrichment: a real 50-gene list runs and every panel renders', async ({ page }) => {
  await runEnrichment(page, readFixture('gene-list-50.txt'));
  await expect(page.locator('#list-preview')).toContainText('50 identifiers');
  await expectFullResults(page);
  const facts = await factsText(page);
  expect(facts).toMatch(/50 submitted · 50 of 50 \(100\.0%\) mapped · 0 of 50 \(0\.0%\) unmapped/);
  expect(facts).toMatch(/Reactome release\s+\d+/);
  expect(facts).toContain('Benjamini-Hochberg');
  expect(facts).toContain('Background (universe)');
  expect(facts).toMatch(/p-value \(hypergeometric, uncorrected\)/);
  await expect(page.locator('.results').getByText('Show unmapped identifiers (0)')).toBeVisible();
  // the tree and the diagram render with this analysis active
  await page.getByRole('link', { name: /Pathway Browser/ }).click();
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tree .dot').first()).toBeVisible();
  await page.locator('.tree-card input[type=search]').fill('Cell Cycle Checkpoints');
  await page.locator('.tree-row', { hasText: 'Cell Cycle Checkpoints' }).first().click();
  await expect(page.locator('.detail-card svg.diagram-svg')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.detail-card tr.has-gene').first()).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.detail-card .note').filter({ hasText: 'Reactome' }).first(),
  ).toBeVisible();
});

test('Enrichment: duplicates, aliases, lowercase and quotes are cleaned and counted', async ({
  page,
}) => {
  await runEnrichment(page, 'TP53, tp53, "BRCA1"\nHER2; ERBB2\nP53\negfr\nATM\tCHEK2\nTP53');
  const preview = await page.locator('#list-preview').innerText();
  expect(preview).toMatch(/8 identifiers, 2 duplicates removed/); // TP53 x3 -> 1 (2 removed); aliases are distinct strings
  await expectFullResults(page);
  const facts = await factsText(page);
  expect(facts).toMatch(/8 submitted/);
  expect(facts).toMatch(/0 of 8 \(0\.0%\) unmapped/); // aliases (HER2, P53) and lowercase are mapped by Reactome
});

test('Enrichment: an empty list cannot be run', { tag: '@hermetic' }, async ({ page }) => {
  await page.goto('/#/enrichment');
  await expect(page.locator('#list-preview')).toContainText('Nothing pasted yet');
  await expect(page.getByRole('button', { name: 'Run enrichment analysis' })).toBeDisabled();
  await page.locator('#gene-list').fill('   \n\t  ');
  await expect(page.getByRole('button', { name: 'Run enrichment analysis' })).toBeDisabled();
});

test(
  'Enrichment: a list over the size cap is refused with a clear message',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/#/enrichment');
    const big = Array.from({ length: 5001 }, (_, i) => `GENE${i}`).join('\n');
    await page.locator('#gene-list').fill(big);
    await expect(page.locator('#list-preview')).toContainText('over the limit of 5,000', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Run enrichment analysis' })).toBeDisabled();
  },
);

test('Enrichment: a 100% unmapped list shows every unmapped id and no results, without errors', async ({
  page,
}) => {
  await runEnrichment(page, 'NOTAGENE\nFAKE123\nZZZZZ9');
  const facts = await factsText(page);
  expect(facts).toMatch(/3 submitted · 0 of 3 \(0\.0%\) mapped · 3 of 3 \(100\.0%\) unmapped/);
  await page.getByRole('button', { name: /Show unmapped identifiers \(3\)/ }).click();
  await expect(page.locator('.unmapped')).toContainText('NOTAGENE');
  await expect(page.locator('.unmapped')).toContainText('FAKE123');
  await expect(page.locator('.unmapped')).toContainText('ZZZZZ9');
  await expect(page.locator('.results .state.empty')).toContainText('no pathway');
  await expect(page.locator('.results .note.warn')).toContainText(
    '100% of your list could not be mapped',
  );
});

test('Enrichment: partly unmapped list lists the unmapped ids and warns above 20%', async ({
  page,
}) => {
  await runEnrichment(page, 'TP53\nBRCA1\nEGFR\nATM\nNOTAGENE\nFAKE123');
  await expect(page.locator('.results .note.warn')).toContainText(
    '33% of your list could not be mapped',
  );
  await page.getByRole('button', { name: /Show unmapped identifiers \(2\)/ }).click();
  await expect(page.locator('.unmapped')).toContainText('NOTAGENE');
  await expect(page.locator('.unmapped')).toContainText('FAKE123');
});

test('Enrichment: example lists are built live from real pathways and labeled with their source', async ({
  page,
}) => {
  await page.goto('/#/enrichment');
  await page.locator('.examples-box summary').click();
  const chips = page.locator('.examples .chip');
  await expect(chips.first()).toBeVisible({ timeout: 60_000 });
  expect(await chips.count()).toBe(3);
  await chips.first().click();
  await expect(
    page.locator('.note').filter({
      hasText: 'Source: Gene symbols of the proteins annotated in the Reactome pathway',
    }),
  ).toBeVisible();
  await expect(page.locator('#list-preview')).toContainText(/\d+ identifiers/);
});

test(
  'Enrichment: dropping a file onto the box loads it',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/#/enrichment');
    const data = 'Gene\nTP53\nBRCA1\nATM';
    const dt = await page.evaluateHandle((text) => {
      const d = new DataTransfer();
      d.items.add(new File([text], 'genes.csv', { type: 'text/csv' }));
      return d;
    }, data);
    await page.locator('.dropzone').dispatchEvent('drop', { dataTransfer: dt });
    await expect(page.locator('#list-preview')).toContainText('3 identifiers');
    await expect(page.locator('#list-preview')).toContainText('header row skipped');
  },
);

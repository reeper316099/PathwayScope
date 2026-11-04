// Web e2e: the Settings tab (sidebar, shortcut, theme, help links, stored data) and click-outside-to-close for pop-up dialogs.
// These tests need no live services (@hermetic).
import { expect, test } from '../support/collect.js';

test(
  'Settings is a tab in the left sidebar and holds Stored data, Appearance, Help and Shortcuts',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/#/explorer');
    const tab = page.locator('.rail a[data-mode=settings]');
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page).toHaveURL(/#\/settings/);
    await expect(tab).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-view=settings] h1')).toHaveText('Settings');
    for (const name of [
      'Appearance',
      'Stored data',
      'Help and information',
      'Keyboard shortcuts',
    ]) {
      await expect(
        page.locator(`[data-view=settings] section[aria-label="${name}"]`),
      ).toBeVisible();
    }
    const manager = page.locator('#data-manager');
    await expect(manager).toContainText('History (');
    await expect(manager).toContainText('Saved sessions (');
    await expect(manager).toContainText('Cached lookups (');
    await expect(manager).toContainText('Delete everything');
    await expect(manager).toContainText('ARE sent to the public Reactome, UniProt and NCBI');
    // there is no separate pop-up for stored data any more
    await expect(page.locator('#data-dialog')).toHaveCount(0);
  },
);

test(
  'Settings is reachable with Ctrl+4, the footer link and from every other tab',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/#/enrichment');
    await page.keyboard.press('Control+4');
    await expect(page).toHaveURL(/#\/settings/);
    await page.locator('.rail a[data-mode=explorer]').click();
    await expect(page).toHaveURL(/#\/explorer/);
    await page.getByRole('button', { name: 'Manage stored data' }).click();
    await expect(page).toHaveURL(/#\/settings/);
    await expect(page.locator('#data-manager')).toBeVisible();
  },
);

test(
  'Settings: the theme button and the top-bar toggle stay in sync',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/#/settings');
    const button = page.locator('[data-view=settings] section[aria-label="Appearance"] button');
    await expect(button).toContainText('Dark mode: off');
    await button.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(button).toContainText('Dark mode: on');
    await page.locator('#theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(button).toContainText('Dark mode: off');
  },
);

test(
  'pop-up dialogs close when you click outside them (and not when you click inside)',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/#/settings');
    for (const [button, dialogId] of [
      ['About PathwayScope', '#about-dialog'],
      ['Data sources', '#sources-dialog'],
    ]) {
      await page.getByRole('button', { name: button }).click();
      const dialog = page.locator(dialogId);
      await expect(dialog).toBeVisible();
      // clicking inside the dialog (on its heading) keeps it open
      await dialog.locator('h2').click();
      await expect(dialog).toBeVisible();
      // clicking on the dark area outside it closes it
      await page.mouse.click(5, 5);
      await expect(dialog).toBeHidden();
    }
    // Esc still works, and so does the Close button
    await page.getByRole('button', { name: 'About PathwayScope' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#about-dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Data sources' }).click();
    await page.locator('#sources-dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('#sources-dialog')).toBeHidden();
  },
);

test.describe('mobile viewport 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test(
    'four tabs fit in the bottom bar and Settings works',
    { tag: '@hermetic' },
    async ({ page }) => {
      await page.goto('/#/explorer');
      const tabs = page.locator('.rail .modes li:not([hidden]) a'); // the website has four tabs (Home is desktop-only)
      await expect(tabs).toHaveCount(4);
      for (const box of await tabs.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return [r.left, r.right];
        }),
      )) {
        expect(box[0]).toBeGreaterThanOrEqual(0);
        expect(box[1]).toBeLessThanOrEqual(390);
      }
      await tabs.nth(3).click();
      await expect(page.locator('#data-manager')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    },
  );
});

test(
  'the website has no Home page: the logo and the start page stay on Gene Explorer',
  { tag: '@hermetic' },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-view=explorer]')).toBeVisible();
    await expect(page.locator('a[data-mode=home]')).toBeHidden();
    await expect(page.locator('#brand-link')).toHaveAttribute('href', '#/explorer');
    await page.goto('/#/home'); // an unknown route falls back to the start page
    await page.reload();
    await expect(page.locator('[data-view=explorer]')).toBeVisible();
    await expect(page.locator('[data-view=home]')).toBeHidden();
    await page.locator('#brand-link').click();
    await expect(page).toHaveURL(/#\/explorer/);
  },
);

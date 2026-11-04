// Electron e2e: the Home page (Library): items grouped by what you looked up, sizes, pinning, nested folders, drag and drop,
// deleting one item without touching data other items use, and persistence. Disk contents are checked after every action.
import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { clickMenu, expect, launch, newUserData, runEnrichment } from './support.js';

const cacheDir = (userData) => path.join(userData, 'pathwayscope-data-cache');
// Reads every cached entry's description file from disk.
const metas = (userData) => {
  const dir = cacheDir(userData);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((name) => name.endsWith('.meta'))) {
    try {
      out.push({ key: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) });
    } catch {
      // The app deleted (or is rewriting) this file while we were reading: skip it.
    }
  }
  return out;
};
const pins = (userData) => {
  const file = path.join(cacheDir(userData), 'pins.state');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
};
// Same formatting as the app's formatBytes.
const fmt = (bytes) => {
  if (!(bytes > 0)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(3, Math.floor(Math.log10(bytes) / 3));
  return `${(bytes / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};
const card = (win, id) => win.locator(`.lib-card[data-id="${id}"]`);
const folderCard = (win, name) =>
  win.locator('.folder-card', { has: win.getByRole('button', { name, exact: true }) });
const modal = (win) => win.locator('dialog.modal[open]');

// Looks up a gene and waits until all of its background requests (card details, interactors) are done.
async function lookup(win, gene) {
  await win.evaluate((g) => {
    location.hash = `#/explorer/${g}`;
  }, gene);
  await expect(win.locator('.gene-title')).toHaveText(gene, { timeout: 60_000 });
  await expect(win.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 60_000,
  });
  await expect(win.locator('.interactors')).toContainText(/total; top|none listed/, {
    timeout: 60_000,
  });
  await win.waitForTimeout(600);
}
// Opens Home through the logo and waits for the cards.
async function goHome(win) {
  await win.click('#brand-link');
  await expect(win.locator('[data-view=home] h1')).toHaveText('Home');
  await expect(win.locator('[data-view=home] .card[aria-label="Library"]')).toBeVisible({
    timeout: 20_000,
  });
}
// Creates a folder through the "New folder" dialog.
async function newFolder(win, name) {
  await win.getByRole('button', { name: 'New folder', exact: true }).click();
  await modal(win).locator('#prompt-input').fill(name);
  await modal(win).getByRole('button', { name: 'Create' }).click();
}
const confirm = (win, label = 'Delete') =>
  modal(win).getByRole('button', { name: label, exact: true }).click();

test.describe.configure({ mode: 'serial' });

test('Home is the start page in the desktop app: logo, sidebar tab, menu entry and an honest empty state', async () => {
  const { app, win } = await launch(undefined, { home: true });
  await expect(win.locator('[data-view=home]')).toBeVisible();
  await expect(win.locator('a[data-mode=home]')).toHaveAttribute('aria-current', 'page');
  await expect(win.locator('#brand-link')).toHaveAttribute('href', '#/home');
  await expect(win.locator('[data-view=home] .state.empty')).toContainText('Nothing here yet');
  await win.click('a[data-mode=explorer]');
  await expect(win.locator('[data-view=home]')).toBeHidden();
  await win.click('#brand-link');
  await expect(win.locator('[data-view=home]')).toBeVisible();
  const accel = await app.evaluate(({ Menu }) => {
    const out = {};
    const walk = (items) =>
      items.forEach((i) => {
        if (i.accelerator) out[i.label] = i.accelerator;
        if (i.submenu) walk(i.submenu.items);
      });
    walk(Menu.getApplicationMenu().items);
    return out;
  });
  expect(accel.Home).toBe('CmdOrCtrl+Shift+H');
  await win.click('a[data-mode=settings]');
  await clickMenu(app, 'Home');
  await expect(win.locator('[data-view=home]')).toBeVisible();
  // quick start
  await win.locator('#home-gene').fill('TP53');
  await win.getByRole('button', { name: 'Look up gene' }).click();
  await expect(win.locator('.gene-title')).toHaveText('TP53', { timeout: 60_000 });
  await app.close();
});

test('every lookup is one card; its cached data is tagged on disk; shared data is separate; deleting one gene frees only its data', async () => {
  const userData = newUserData();
  const { app, win, errors } = await launch(userData);
  await lookup(win, 'TP53');
  await lookup(win, 'BRCA1');
  await goHome(win);
  await expect(card(win, 'gene:TP53')).toBeVisible();
  await expect(card(win, 'gene:BRCA1')).toBeVisible();
  await expect(card(win, 'gene:TP53').locator('.type-badge')).toHaveText('Gene');
  await expect(card(win, 'gene:TP53').locator('h3')).toHaveText('TP53');
  // on disk: each gene's lookups are tagged with it; the hierarchy and release info are "shared" and belong to nobody
  const all = metas(userData);
  const own = (g) => all.filter((m) => m.owners.length === 1 && m.owners[0] === `gene:${g}`);
  expect(own('TP53').length).toBeGreaterThanOrEqual(6);
  expect(own('BRCA1').length).toBeGreaterThanOrEqual(6);
  const shared = all.filter((m) => m.kind === 'shared');
  expect(shared.map((m) => m.label).sort()).toEqual([
    'Pathway hierarchy (all human pathways)',
    'Reactome release information',
  ]);
  // the size on the card equals what is on disk for that gene
  const tp53Bytes = own('TP53').reduce((n, m) => n + m.bytes, 0);
  await expect(card(win, 'gene:TP53')).toContainText(fmt(tp53Bytes));
  // storage summary adds up and names the shared group
  const storage = win.locator('[aria-label=Storage]');
  await expect(storage).toContainText(
    `Shared by every lookup: ${fmt(shared.reduce((n, m) => n + m.bytes, 0))}`,
  );
  await expect(storage).toContainText('for 2 items');
  // delete BRCA1: only its data goes
  const tp53Before = own('TP53').length;
  await win.getByRole('button', { name: 'Delete BRCA1' }).click();
  await expect(modal(win)).toContainText('This frees about');
  await confirm(win);
  await expect(card(win, 'gene:BRCA1')).toHaveCount(0);
  await expect
    .poll(() => metas(userData).filter((m) => m.owners.includes('gene:BRCA1')).length)
    .toBe(0);
  expect(
    metas(userData).filter((m) => m.owners.length === 1 && m.owners[0] === 'gene:TP53').length,
  ).toBe(tp53Before);
  expect(metas(userData).filter((m) => m.kind === 'shared').length).toBe(2);
  await expect(win.locator('#history-list')).not.toContainText('BRCA1');
  await expect(win.locator('#history-list')).toContainText('TP53');
  expect(errors).toEqual([]);
  await app.close();
});

test('data used by two items stays when one is deleted (and each card says it is shared)', async () => {
  const userData = newUserData();
  const { app, win } = await launch(userData);
  const stIds = async (gene) => {
    await lookup(win, gene);
    return win.locator('.pathway-item').evaluateAll((els) => els.map((e) => e.dataset.stid));
  };
  const a = await stIds('TP53');
  const b = await stIds('BRCA1');
  const common = a.find((id) => b.includes(id));
  test.skip(!common, 'TP53 and BRCA1 share no lowest-level pathway in this Reactome release');
  // open the common pathway in the drawer from each gene
  for (const gene of ['TP53', 'BRCA1']) {
    await lookup(win, gene);
    await win.evaluate((id) => {
      const btn = document.querySelector(`.pathway-item[data-stid="${id}"]`);
      btn.closest('details').open = true;
      btn.click();
    }, common);
    await expect(win.locator('#drawer h2')).not.toBeEmpty({ timeout: 60_000 });
    await expect(win.locator('#drawer table.data tbody tr').first()).toBeVisible({
      timeout: 60_000,
    });
    await win.waitForTimeout(800);
    await win.click('#drawer-close');
  }
  const details = () => metas(userData).find((m) => m.label === `Pathway details: ${common}`);
  expect(details().owners).toEqual(
    expect.arrayContaining([`pathway:${common}`, 'gene:TP53', 'gene:BRCA1']),
  );
  await goHome(win);
  await expect(card(win, 'gene:TP53')).toContainText('also used by other items');
  await win.getByRole('button', { name: 'Delete BRCA1' }).click();
  await confirm(win);
  await expect(card(win, 'gene:BRCA1')).toHaveCount(0);
  await expect.poll(() => details()?.owners.includes('gene:BRCA1')).toBe(false);
  expect(details().owners).toEqual(expect.arrayContaining([`pathway:${common}`, 'gene:TP53']));
  await expect(card(win, `pathway:${common}`)).toBeVisible(); // opening the pathway made it an item of its own
  await app.close();
});

test('pinning keeps an item, "Free up space" skips it, pins persist across restart and unpinning works', async () => {
  const userData = newUserData();
  let run = await launch(userData);
  await lookup(run.win, 'TP53');
  await lookup(run.win, 'BRCA1');
  await goHome(run.win);
  await run.win.getByRole('button', { name: 'Pin TP53' }).click();
  await expect(card(run.win, 'gene:TP53')).toContainText('Pinned');
  await expect(run.win.getByRole('button', { name: 'Unpin TP53' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => pins(userData)).toEqual(['gene:TP53']);
  const storage = run.win.locator('[aria-label=Storage]');
  await expect(storage).not.toContainText('Pinned items: 0 B');
  await run.win.getByRole('button', { name: 'Free up space…' }).click();
  await expect(modal(run.win)).toContainText('1 pinned item');
  await confirm(run.win, 'Delete unpinned items');
  await expect(card(run.win, 'gene:BRCA1')).toHaveCount(0);
  await expect(card(run.win, 'gene:TP53')).toBeVisible();
  expect(metas(userData).filter((m) => m.owners.includes('gene:BRCA1')).length).toBe(0);
  expect(metas(userData).filter((m) => m.owners.includes('gene:TP53')).length).toBeGreaterThan(5);
  await run.app.close();

  run = await launch(userData);
  await goHome(run.win);
  await expect(card(run.win, 'gene:TP53')).toContainText('Pinned');
  await run.win.getByRole('button', { name: 'Unpin TP53' }).click();
  await expect.poll(() => pins(userData)).toEqual([]);
  await expect(card(run.win, 'gene:TP53')).not.toContainText('Pinned');
  await run.app.close();
});

test('a pinned item is served as a frozen snapshot: it works with the network down and is never refetched', async () => {
  const userData = newUserData();
  let run = await launch(userData);
  await lookup(run.win, 'TP53');
  await goHome(run.win);
  await run.win.getByRole('button', { name: 'Pin TP53' }).click();
  await expect.poll(() => pins(userData)).toEqual(['gene:TP53']);
  // age every cached response of TP53 far past its 7-day lifetime
  const dir = cacheDir(userData);
  for (const m of metas(userData).filter((x) => x.owners.includes('gene:TP53'))) {
    const file = path.join(dir, `${m.key}.json`);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    entry.cachedAt = Date.now() - 400 * 24 * 3600 * 1000;
    fs.writeFileSync(file, JSON.stringify(entry));
  }
  await run.app.close();
  run = await launch(userData);
  // break the main process's network completely: any real request would fail
  await run.app.evaluate(() => {
    globalThis.fetch = async () => {
      throw new TypeError('network must not be used for a pinned snapshot');
    };
  });
  await lookup(run.win, 'TP53'); // expired by age, but pinned: served from the cache, and NOT flagged as stale/offline
  await expect(run.win.locator('.pathway-item').first()).toBeAttached();
  await expect(run.win.locator('#banner')).toBeHidden();
  await run.app.close();
});

test('folders: nested, drag and drop, one item in several folders, de-duplicated sizes, remove vs delete, validation and persistence', async () => {
  const userData = newUserData();
  let run = await launch(userData);
  const win = () => run.win;
  await lookup(win(), 'TP53');
  await lookup(win(), 'BRCA1');
  await lookup(win(), 'EGFR');
  await goHome(win());
  // create a folder and a nested one
  await newFolder(win(), 'Project A');
  await expect(folderCard(win(), 'Project A')).toBeVisible();
  await win().getByRole('button', { name: 'New folder', exact: true }).click();
  await modal(win()).locator('#prompt-input').fill('project a'); // duplicate (case-insensitive)
  await modal(win()).getByRole('button', { name: 'Create' }).click();
  await expect(modal(win()).locator('#prompt-error')).toContainText('already exists');
  await modal(win()).locator('#prompt-input').fill('   ');
  await modal(win()).getByRole('button', { name: 'Create' }).click();
  await expect(modal(win()).locator('#prompt-error')).toContainText('enter a folder name');
  await modal(win()).getByRole('button', { name: 'Cancel' }).click();
  await folderCard(win(), 'Project A').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(win().locator('[aria-label="Folder path"]')).toContainText('Project A');
  await newFolder(win(), 'DNA repair'); // created inside Project A
  await expect(folderCard(win(), 'DNA repair')).toBeVisible();
  await win()
    .locator('[aria-label="Folder path"]')
    .getByRole('button', { name: 'Library' })
    .click();
  await expect(folderCard(win(), 'DNA repair')).toHaveCount(0); // not at the top level
  // drag TP53 onto Project A
  await card(win(), 'gene:TP53').dragTo(folderCard(win(), 'Project A'));
  await expect(card(win(), 'gene:TP53')).toHaveCount(0); // filed, so no longer among the unfiled items
  await expect(folderCard(win(), 'Project A')).toContainText('1 item');
  // file BRCA1 in Project A AND a brand-new folder "Favorites" using the Folders dialog
  await win().getByRole('button', { name: 'Folders for BRCA1' }).click();
  await modal(win()).getByRole('checkbox').first().check(); // Project A (the DNA repair row comes after it)
  await modal(win()).getByLabel('New folder name').fill('Favorites');
  await modal(win()).getByRole('button', { name: 'Create and add' }).click();
  await modal(win()).getByRole('button', { name: 'Done' }).click();
  await expect(card(win(), 'gene:BRCA1')).toHaveCount(0); // it is filed now
  await expect(folderCard(win(), 'Project A')).toContainText('2 items');
  await expect(folderCard(win(), 'Favorites')).toContainText('1 item');
  // the folder's size is the de-duplicated sum of the stored data of its items
  const all = metas(userData);
  const ownedBy = (g) => all.filter((m) => m.owners.includes(`gene:${g}`) && m.kind !== 'shared');
  const union = new Map([...ownedBy('TP53'), ...ownedBy('BRCA1')].map((m) => [m.key, m.bytes]));
  await expect(folderCard(win(), 'Project A')).toContainText(
    fmt([...union.values()].reduce((n, b) => n + b, 0)),
  );
  // inside Project A: remove BRCA1 from this folder only (it stays in Favorites, and its data is untouched)
  await folderCard(win(), 'Project A').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(card(win(), 'gene:TP53')).toBeVisible();
  await expect(card(win(), 'gene:BRCA1')).toContainText(/In:\s*Project A\s*Favorites/);
  await win().getByRole('button', { name: 'Remove BRCA1 from this folder' }).click();
  await expect(card(win(), 'gene:BRCA1')).toHaveCount(0);
  expect(metas(userData).filter((m) => m.owners.includes('gene:BRCA1')).length).toBeGreaterThan(5);
  // persistence across restart
  await run.app.close();
  run = await launch(userData);
  await goHome(win());
  await expect(folderCard(win(), 'Favorites')).toContainText('1 item');
  await expect(folderCard(win(), 'Project A')).toContainText('1 item');
  // deleting a folder never deletes items or their data
  const before = metas(userData).length;
  await folderCard(win(), 'Project A')
    .getByRole('button', { name: 'Delete folder Project A' })
    .click();
  await expect(modal(win())).toContainText('will NOT be deleted');
  await expect(modal(win())).toContainText('1 sub-folder');
  await confirm(win(), 'Delete folder');
  await expect(folderCard(win(), 'Project A')).toHaveCount(0);
  await expect(card(win(), 'gene:TP53')).toBeVisible(); // unfiled again
  expect(metas(userData).length).toBe(before);
  await expect(card(win(), 'gene:EGFR')).toBeVisible();
  // search finds items and folders anywhere
  await win().getByLabel('Search your library').fill('fav');
  await expect(win().locator('[aria-label=Library] h2')).toHaveText('Search results');
  await expect(folderCard(win(), 'Favorites')).toBeVisible();
  await win().getByLabel('Search your library').fill('brca');
  await expect(card(win(), 'gene:BRCA1')).toBeVisible();
  await run.app.close();
});

test('analyses are library items too: size includes the saved results, deleting removes the session and its data', async () => {
  const userData = newUserData();
  const { app, win } = await launch(userData);
  await runEnrichment(win, 'TP53\nBRCA1\nATM\nCHEK2');
  await expect(win.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  });
  await win.waitForTimeout(1200);
  const id = await win.evaluate(() => JSON.parse(localStorage.getItem('ps:sessions:index'))[0].id);
  await goHome(win);
  const c = card(win, `analysis:${id}`);
  await expect(c.locator('.type-badge')).toHaveText('Analysis');
  await expect(c).toContainText('Analysis of 4 identifiers');
  const owned = metas(userData).filter((m) => m.owners.includes(`analysis:${id}`));
  expect(owned.length).toBeGreaterThan(3); // results pages, unmapped list, found genes, ...
  expect(owned.map((m) => m.kind)).toContain('analysis');
  await expect(win.locator('#sessions-list')).toContainText('4 identifiers');
  await win.getByRole('button', { name: 'Delete Analysis of 4 identifiers' }).click();
  await expect(modal(win)).toContainText('saved results of this analysis are deleted');
  await confirm(win);
  await expect(c).toHaveCount(0);
  await expect
    .poll(() => metas(userData).filter((m) => m.owners.includes(`analysis:${id}`)).length)
    .toBe(0);
  await expect(win.locator('#sessions-list')).toContainText('No saved sessions yet.');
  await app.close();
});

test('shared and unsorted data can be cleared; Settings "Delete everything" also clears the library and pins', async () => {
  const userData = newUserData();
  const { app, win } = await launch(userData);
  await lookup(win, 'TP53');
  await goHome(win);
  await newFolder(win, 'Keepers');
  await win.getByRole('button', { name: 'Pin TP53' }).click();
  await expect.poll(() => pins(userData)).toEqual(['gene:TP53']);
  // shared data (the pathway hierarchy) can be deleted on its own
  await win.locator('.other-data summary').click();
  await win.getByRole('button', { name: 'Delete shared data' }).click();
  await confirm(win);
  await expect.poll(() => metas(userData).filter((m) => m.kind === 'shared').length).toBe(0);
  expect(metas(userData).filter((m) => m.owners.includes('gene:TP53')).length).toBeGreaterThan(5);
  // everything: Settings -> Delete everything
  await win.click('a[data-mode=settings]');
  await win.getByRole('button', { name: 'Delete everything…' }).click();
  await win.getByRole('button', { name: 'Yes, delete everything' }).click();
  await win.waitForFunction(
    () => !document.getElementById('data-status').textContent.includes('loading'),
    null,
    { timeout: 60_000 },
  );
  expect(pins(userData)).toEqual([]);
  await goHome(win);
  await expect(win.locator('[data-view=home] .state.empty')).toContainText('Nothing here yet');
  await expect(folderCard(win, 'Keepers')).toHaveCount(0);
  await app.close();
});

// Electron e2e: window, security hardening, IPC fetch (GET + POST), persistence across restarts, offline mode.
import fs from 'node:fs';
import { test } from '@playwright/test';
import { cacheFiles, expect, goOffline, launch, newUserData, runEnrichment } from './support.js';

const list50 = fs.readFileSync(new URL('../../fixtures/gene-list-50.txt', import.meta.url), 'utf8');

test.describe.configure({ mode: 'serial' });

test('launches with the right title, size limits and an empty three-mode shell', async () => {
  const { app, win, errors } = await launch();
  expect(await win.title()).toBe('PathwayScope');
  expect(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize()),
  ).toEqual([1000, 700]);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  for (const mode of ['explorer', 'enrichment', 'browser']) {
    await win.click(`a[data-mode=${mode}]`);
    await expect(win.locator(`[data-view=${mode}]`)).toBeVisible();
  }
  expect(await win.locator('#data-status').innerText()).toMatch(/Reactome release: \d+/);
  expect(errors).toEqual([]);
  await app.close();
});

test('security: sandboxed renderer, no Node, strict CSP, blocked navigation/windows/permissions', async () => {
  const { app, win, errors } = await launch();
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
      sandbox: p.sandbox,
      webSecurity: p.webSecurity,
      webviewTag: p.webviewTag,
    };
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  });
  expect(
    await win.evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer]),
  ).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  // The exact list of functions the page can call (the whole attack surface of the preload bridge).
  expect(await win.evaluate(() => Object.keys(window.api).sort())).toEqual([
    'deleteCacheEntry',
    'fetchJson',
    'getAppInfo',
    'listCache',
    'onMenuAction',
    'openExternal',
    'saveFile',
  ]);
  // the CSP is present and eval is really blocked
  expect(
    await win.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    ),
  ).toContain("default-src 'none'");
  expect(
    await win.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
    ),
  ).toContain("connect-src 'self'");
  // The policy forbids unsafe-eval / unsafe-inline, and the browser really enforces it: an injected inline script does not run.
  // (A direct eval() probe is not possible from Playwright: DevTools evaluation is allowed to bypass the CSP's eval rule.)
  const csp = await win.evaluate(
    () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
  );
  expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|\*|https?:/);
  expect(csp).toContain("script-src 'self'");
  const injected = await win.evaluate(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      violations.push(e.violatedDirective),
    );
    const script = document.createElement('script');
    script.textContent = 'window.__injectedRan = true; eval("1")';
    document.head.append(script);
    await new Promise((r) => setTimeout(r, 300));
    return { ran: window.__injectedRan === true, violations };
  });
  expect(injected.ran).toBe(false);
  expect(injected.violations.some((v) => v.startsWith('script-src'))).toBe(true);
  // permission requests are denied
  expect(await win.evaluate(() => Notification.requestPermission())).toBe('denied');
  // navigation away is blocked
  const before = win.url();
  await win.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await win.waitForTimeout(1500);
  expect(win.url()).toBe(before);
  // a link click to an external site does not navigate either
  await win.evaluate(() => {
    const a = document.createElement('a');
    a.href = 'https://example.com/';
    a.id = 'evil';
    a.textContent = 'x';
    document.body.append(a);
    a.click();
  });
  await win.waitForTimeout(1000);
  expect(win.url()).toBe(before);
  // new windows are denied
  await win.evaluate(() => window.open('https://example.com'));
  await win.waitForTimeout(1000);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  // renderer has no direct network: no request to any https host came from the page
  expect(errors.filter((e) => !/Notification|CSP|Content Security Policy|eval/i.test(e))).toEqual(
    [],
  );
  await app.close();
});

test('security: the IPC fetch allowlist rejects bad hosts, schemes, methods, headers, bodies; openExternal is allowlisted too', async () => {
  const { app, win } = await launch();
  const call = (url, options) =>
    win.evaluate(([u, o]) => window.api.fetchJson(u, o), [url, options]);
  const ok = 'https://reactome.org/ContentService/data/database/info';
  expect(await call('https://example.com/')).toMatchObject({ ok: false, code: 'host-not-allowed' });
  expect(await call('https://reactome.org.evil.example/x')).toMatchObject({
    ok: false,
    code: 'host-not-allowed',
  });
  expect(await call('http://reactome.org/ContentService/data/database/info')).toMatchObject({
    ok: false,
    code: 'not-https',
  });
  expect(await call('file:///etc/passwd')).toMatchObject({ ok: false, code: 'not-https' });
  expect(await call(ok, { method: 'PUT' })).toMatchObject({
    ok: false,
    code: 'method-not-allowed',
  });
  expect(await call(ok, { method: 'DELETE' })).toMatchObject({
    ok: false,
    code: 'method-not-allowed',
  });
  expect(await call(ok, { headers: { Authorization: 'x' } })).toMatchObject({
    ok: false,
    code: 'header-not-allowed',
  });
  expect(
    await call('https://reactome.org/ContentService/x', { method: 'POST', body: 'a' }),
  ).toMatchObject({ ok: false, code: 'post-not-allowed' });
  expect(
    await call('https://reactome.org/AnalysisService/identifiers/projection', {
      method: 'POST',
      body: 'x'.repeat(1_000_001),
    }),
  ).toMatchObject({ ok: false, code: 'body-too-large' });
  expect(await call(ok, { body: 'GET with body' })).toMatchObject({ ok: false, code: 'bad-body' });
  expect(
    await win.evaluate(() => window.api.openExternal('https://evil.example.com')),
  ).toMatchObject({ ok: false, code: 'host-not-allowed' });
  expect(await win.evaluate(() => window.api.openExternal('http://reactome.org'))).toMatchObject({
    ok: false,
    code: 'not-https',
  });
  expect(
    await win.evaluate(() =>
      window.api.saveFile({ defaultName: '../../etc/passwd', content: 'x' }),
    ),
  ).toMatchObject({ ok: false, code: 'bad-save' });
  // and an allowed request works
  expect(await call(ok)).toMatchObject({ ok: true, status: 200 });
  await app.close();
});

test('gene search and enrichment work through the IPC path (GET and POST), with no renderer network traffic', async () => {
  const userData = newUserData();
  const { app, win, errors } = await launch(userData);
  const remoteRequests = [];
  win.on('request', (r) => /^https?:/.test(r.url()) && remoteRequests.push(r.url()));
  await win.fill('#gene-input', 'TP53');
  await win.click('.inline-form .btn');
  await expect(win.locator('.gene-title')).toHaveText('TP53', { timeout: 60_000 });
  await expect(win.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 60_000,
  });
  await expect(win.locator('.pathway-item').first()).toBeAttached();
  await runEnrichment(win, list50);
  await expect(win.locator('.results .facts')).toContainText('50 of 50 (100.0%) mapped');
  await expect(win.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  });
  await expect(win.locator('.chart-box canvas')).toBeVisible();
  expect(remoteRequests).toEqual([]);
  expect(cacheFiles(userData).length).toBeGreaterThan(5);
  // the POST itself is cached by body hash: repeating the same POST is answered from the disk cache
  const again = await win.evaluate(() =>
    window.api.fetchJson(
      'https://reactome.org/AnalysisService/identifiers/projection?interactors=false&pageSize=1&page=1&sortBy=ENTITIES_FDR&order=ASC&resource=TOTAL&species=9606',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'TP53\nBRCA1',
        cacheTtlSeconds: 60,
      },
    ),
  );
  expect(again.ok).toBe(true);
  const repeat = await win.evaluate(() =>
    window.api.fetchJson(
      'https://reactome.org/AnalysisService/identifiers/projection?interactors=false&pageSize=1&page=1&sortBy=ENTITIES_FDR&order=ASC&resource=TOTAL&species=9606',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'TP53\nBRCA1',
        cacheTtlSeconds: 60,
      },
    ),
  );
  expect(repeat).toMatchObject({ ok: true, fromCache: true });
  const different = await win.evaluate(() =>
    window.api.fetchJson(
      'https://reactome.org/AnalysisService/identifiers/projection?interactors=false&pageSize=1&page=1&sortBy=ENTITIES_FDR&order=ASC&resource=TOTAL&species=9606',
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'ATM\nCHEK2',
        cacheTtlSeconds: 60,
      },
    ),
  );
  expect(different.fromCache).toBe(false);
  expect(errors).toEqual([]);
  await app.close();
});

test('cache, history and saved sessions persist across restarts; the footer shows the cached label', async () => {
  const userData = newUserData();
  let run = await launch(userData);
  await run.win.fill('#gene-input', 'BRCA1');
  await run.win.click('.inline-form .btn');
  await expect(run.win.locator('.gene-title')).toHaveText('BRCA1', { timeout: 60_000 });
  await runEnrichment(run.win, 'TP53\nBRCA1\nATM\nCHEK2\nEGFR');
  const factsBefore = await run.win.locator('.results .facts').innerText();
  const filesBefore = cacheFiles(userData).length;
  expect(filesBefore).toBeGreaterThan(3);
  await run.win.waitForTimeout(1200); // session writes are debounced
  await run.app.close();

  run = await launch(userData);
  expect(cacheFiles(userData).length).toBeGreaterThanOrEqual(filesBefore);
  await expect(run.win.locator('#history-list')).toContainText('Gene BRCA1');
  await expect(run.win.locator('#history-list')).toContainText('Analysis of 5 identifiers');
  await expect(run.win.locator('#sessions-list .link-btn').first()).toContainText('5 identifiers');
  await expect(run.win.locator('#data-status')).toContainText(/cached/, { timeout: 30_000 });
  // re-open the saved session: same numbers
  await run.win.locator('#sessions-list .link-btn').first().click();
  await expect(run.win.locator('.results .facts')).toBeVisible({ timeout: 90_000 });
  const factsAfter = await run.win.locator('.results .facts').innerText();
  expect(factsAfter.split('Reactome release')[0]).toBe(factsBefore.split('Reactome release')[0]);
  await run.app.close();
});

test('offline mode: cached genes and saved sessions still work, with the Offline banner; uncached data fails politely', async () => {
  const userData = newUserData();
  let run = await launch(userData);
  await run.win.fill('#gene-input', 'TP53');
  await run.win.click('.inline-form .btn');
  await expect(run.win.locator('.gene-title')).toHaveText('TP53', { timeout: 60_000 });
  await expect(run.win.locator('.gene-card')).toContainText(/ClinVar: [\d,]+ records/, {
    timeout: 60_000,
  });
  await expect(run.win.locator('.interactors')).toContainText(/total; top/, { timeout: 60_000 });
  await run.win.locator('a[data-mode=browser]').click(); // caches the 3.9 MB hierarchy
  await expect(run.win.locator('.tree-row').first()).toBeVisible({ timeout: 60_000 });
  await runEnrichment(run.win, 'TP53\nBRCA1\nATM\nCHEK2\nEGFR');
  await expect(run.win.locator('.network-box + p')).toContainText(/pathways, .* genes/, {
    timeout: 60_000,
  });
  await run.win.waitForTimeout(1200);
  await run.app.close();

  run = await launch(userData);
  await goOffline(run.app);
  await expect(run.win.locator('#banner')).toContainText('Offline', { timeout: 15_000 });
  // a cached gene still loads
  await run.win.click('a[data-mode=explorer]');
  await run.win.fill('#gene-input', 'TP53');
  await run.win.click('.inline-form .btn');
  await expect(run.win.locator('.gene-title')).toHaveText('TP53', { timeout: 60_000 });
  await expect(run.win.locator('.pathway-item').first()).toBeAttached();
  await expect(run.win.locator('#banner')).toContainText(/Offline: showing cached data from /);
  // an uncached gene gives a friendly error, not a crash
  await run.win.fill('#gene-input', 'KRAS');
  await run.win.click('.inline-form .btn');
  await expect(run.win.locator('.explorer-result .state.error')).toContainText(
    'Could not reach the data source',
    { timeout: 60_000 },
  );
  // the saved session opens offline from its stored rows
  await run.win.locator('#sessions-list .link-btn').first().click();
  await expect(run.win.locator('.results .facts')).toBeVisible({ timeout: 60_000 });
  await expect(run.win.locator('.card[aria-label="Results table"] tbody tr').first()).toBeVisible();
  await expect(run.win.locator('#toast')).toContainText('Offline: showing the saved results');
  await run.app.close();
});

test('native menu: shortcuts target the right modes, About lists the version, Clear cache empties the cache folder', async () => {
  const userData = newUserData();
  const { app, win } = await launch(userData);
  const click = (label) =>
    app.evaluate(({ Menu }, l) => {
      const find = (items) => {
        for (const i of items) {
          if (i.label === l) return i;
          if (i.submenu) {
            const f = find(i.submenu.items);
            if (f) return f;
          }
        }
        return null;
      };
      find(Menu.getApplicationMenu().items).click();
    }, label);
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
  expect(accel).toMatchObject({
    'Focus Search': 'CmdOrCtrl+K',
    'Toggle Dark Mode': 'CmdOrCtrl+D',
    'Export CSV…': 'CmdOrCtrl+E',
    'Gene Explorer': 'CmdOrCtrl+1',
    'Enrichment Analysis': 'CmdOrCtrl+2',
    'Pathway Browser': 'CmdOrCtrl+3',
  });
  await click('Pathway Browser');
  await expect(win.locator('[data-view=browser]')).toBeVisible();
  await click('Focus Search');
  await expect(win.locator('#search-input')).toBeFocused();
  const theme = await win.locator('html').getAttribute('data-theme');
  await click('Toggle Dark Mode');
  await expect(win.locator('html')).not.toHaveAttribute('data-theme', theme);
  await click('About PathwayScope');
  await expect(win.locator('#about-version')).toContainText(/Version 0\.1\.0 · Electron \d+/);
  await win.keyboard.press('Escape');
  expect(cacheFiles(userData).length).toBeGreaterThan(0);
  await click('Clear Cache');
  await expect(win.locator('#toast')).toContainText('Cache cleared');
  await expect.poll(() => cacheFiles(userData).length, { timeout: 15_000 }).toBeLessThanOrEqual(1);
  await app.close();
});

test('single instance: a second launch with the same user-data folder does not open a second window', async () => {
  const userData = newUserData();
  const first = await launch(userData);
  const { _electron } = await import('@playwright/test');
  const second = await _electron
    .launch({
      args: ['.', `--user-data-dir=${userData}`],
      env: { ...process.env, PATHWAYSCOPE_BACKGROUND: '1' },
    })
    .catch(() => null);
  if (second) await second.close().catch(() => {});
  expect(
    await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
  ).toBe(1);
  await first.app.close();
});

// Playwright config: "web" project (browser build served by vite preview) and "electron" project (built desktop app).
// Locally use an installed Chrome:  PW_CHANNEL=chrome npm run test:e2e:web   (CI installs Playwright's Chromium instead).
import { defineConfig } from '@playwright/test';

const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1, // one at a time: be polite to Reactome's public servers and keep the live-data runs deterministic
  fullyParallel: false,
  retries: 2, // live public APIs can rate-limit (Cloudflare 429); any test that needs its retry is reported as "flaky"
  reporter: [['list']],
  projects: [
    {
      name: 'web',
      testMatch: /web\/.*\.spec\.js/,
      use: { baseURL: 'http://localhost:4173', channel, viewport: { width: 1400, height: 900 } },
    },
    { name: 'electron', testMatch: /electron\/.*\.spec\.js/ },
  ],
  webServer: {
    command:
      'npm run build:web:e2e && npx vite preview --outDir ../dist-web --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

// Vite config: one codebase, two builds (--mode web for GitHub Pages, --mode electron for the desktop app).
import { defineConfig } from 'vite';

// Hosts the browser build may talk to directly (the Electron build talks to nobody: its main process does).
const WEB_CONNECT =
  "'self' https://reactome.org https://rest.uniprot.org https://eutils.ncbi.nlm.nih.gov";

// Builds the Content-Security-Policy string for a given build mode.
function cspFor(mode) {
  const connect = mode === 'electron' ? "'self'" : WEB_CONNECT;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

// Vite plugin: injects the CSP <meta> into index.html for production builds only (dev needs Vite's HMR).
function cspPlugin(mode) {
  return {
    name: 'pathwayscope-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: cspFor(mode) },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => ({
  root: 'src',
  // Relative base works for file:// (Electron) AND for a GitHub Pages project sub-path.
  base: './',
  publicDir: false,
  plugins: [cspPlugin(mode)],
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: { port: 5173, strictPort: true },
  test: {
    root: '.',
    include: ['tests/unit/**/*.test.js'],
    coverage: { provider: 'v8', include: ['src/core/**'], reporter: ['text', 'html'] },
  },
}));

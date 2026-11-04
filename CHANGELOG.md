# Changelog

All notable changes to PathwayScope are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Home page (desktop app).** The app now opens on a library of everything you looked up. Each gene, pathway and analysis is one card with its size; shared data (like the 3.9 MB pathway hierarchy) is shown separately; a storage bar explains where the space goes. Reach it from the logo, the sidebar or the Go menu (Ctrl/Cmd+Shift+H).
- **Folders**, nested up to 8 levels, with drag and drop; an item can be in several folders; deleting a folder never deletes its items; search across the whole library.
- **Pin ("keep")**: a pinned item's stored data is served as a frozen snapshot (even when old or offline) and is skipped by "Free up space".
- **Delete an item and only its data**: cached responses are tagged with their owner, so deleting a gene frees what only it needs and keeps what other items still use. "Free up space" deletes all unpinned items.
- **Settings tab** in the sidebar with Appearance, Stored data (the former pop-up), Help links and a keyboard-shortcut reference. Pop-up windows now also close when you click outside them.

### Fixed

- Clicking the same pathway again after closing its detail drawer did nothing.
- Clicking a pathway in Gene Explorer collapsed every category you had opened.
- The browser's "can't reach this source" message now mentions possible rate limiting.

### Changed

- The page can now call nine functions (two new, narrow ones: remove an owner's cached data, pin or unpin an owner), each validated again in the main process.
- The weekly live-test workflow was removed; live tests can still be run by hand. CI runs only tests that need no live data.

### Tests

- 282 unit tests (about 98.5% line coverage of the data layer); 46 web and 20 desktop end-to-end tests, including tests that check the files on disk after every Home action.

## [0.1.0] - 2026-11-04

First release. PathwayScope is an interactive pathway explorer on top of the [Reactome](https://reactome.org) knowledgebase, shipped as a desktop app (Windows, macOS, Linux), a website (GitHub Pages) and plain source you run with `npm`.

### Highlights

- **Gene Explorer**: type a human gene symbol (aliases like HER2 resolve when unambiguous) and see every Reactome pathway it takes part in, grouped by top-level category, with Reactome's "lowest-level" pathways marked, hierarchy breadcrumbs, a gene card (UniProt protein name, ClinVar record count, Reactome interactors) and link-outs to ClinVar, AlphaFold DB, UniProt, gnomAD and Reactome.
- **Enrichment Analysis**: paste or drop a gene list (any delimiter, Excel columns, header rows, quotes) and run Reactome's over-representation analysis. Results show p-value **and** FDR (Benjamini-Hochberg) side by side, how many identifiers mapped and which did not, the Reactome release, the background and the method, a ranked table, bar and bubble charts, a gene-to-pathway network and a "What this means" panel built only from computed numbers. Example lists are built live from real Reactome pathways.
- **Pathway Browser**: the full human pathway tree with search and keyboard navigation, enrichment dots, and a detail panel with summary, sub-pathways, participants (your genes starred), literature references and the pathway diagram with your analysis highlighted (sanitized SVG, zoom and pan).
- **One codebase, three ways to run it**: Electron desktop installers (NSIS installer and portable for Windows, DMG for macOS arm64 and x64, AppImage and deb for Linux), a GitHub Pages site, and `npm run dev`.
- **Your data stays yours**: history, saved sessions and cached lookups live on your device, with a **Settings** tab in the sidebar whose "Stored data" section lets you delete items one by one or all at once. Pop-up windows close when you click outside them. Sessions can be saved to and opened from JSON files and re-run automatically if Reactome's result token has expired.
- **Works offline (desktop)**: cached genes, pathways and saved sessions open with an "Offline" banner.
- **Accessible and responsive**: light and dark themes, keyboard navigation, text versions of the network, shapes plus labels (never color alone), a mobile layout.

### Statistical honesty

- Always shows which p-value is which (uncorrected vs FDR), the background, the correction method and mapped vs unmapped counts. Unmapped identifiers are never hidden.
- Pathways that tie at Reactome's numerical precision floor (p ~ 1e-16) are shown as "< 1e-15" and flagged as not meaningfully ranked.
- No data is ever invented: missing values read "not available".

### Security

- Electron: context isolation, sandbox, no Node in the page, strict Content-Security-Policy, no `eval`, blocked navigation and new windows, denied permissions.
- All desktop network traffic goes through the main process: host allowlist, https only, GET/POST only, size caps, timeouts, per-host rate limiting, redirect re-checking. The page can call exactly seven functions (nine from the next release).

### Under the hood

- Verified every API shape with live requests rather than assumptions. Notable findings that shaped the app: Reactome's "ratio" is relative to the whole background (we compute found/total ourselves); FDR is not recomputed when filtering; p-values floor at ~1e-16; "lowest-level pathway" is Reactome's own flag, not simply "has no sub-pathways"; the interactors `count` is only the page size; malformed result tokens return HTTP 500; Reactome sits behind Cloudflare and rate-limits bursts (429), which browsers report as a CORS error.
- 253 unit tests (about 98% line coverage of the data layer) using real saved API responses as fixtures; 51 end-to-end tests against the live services (browser and Electron); a packaged-app test.
- CI/CD with GitHub Actions: CI on pull requests (lint, unit tests, build and hermetic end-to-end tests that need no live data), Pages deployment on `main`, and a tag-triggered release workflow that builds on all three operating systems and attaches SHA-256 checksums.

### Known limitations

- **Installers are unsigned and not notarized.** Windows will show SmartScreen and macOS will show a Gatekeeper prompt (see the README for how to open them). The macOS app carries a valid ad-hoc signature only.
- Tested end to end on macOS arm64 only. Windows, Linux and macOS x64 builds are produced by CI but were not run on those systems before release.
- The web version depends on the public APIs allowing browser (CORS) access and on not being rate-limited; the desktop app does not have the CORS limit.
- Human pathways only.
- Educational and research-exploration use only; not medical advice.

[0.1.0]: https://github.com/reeper316099/PathwayScope/releases/tag/v0.1.0

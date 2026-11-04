# PathwayScope

An interactive pathway explorer built on the [Reactome](https://reactome.org) knowledgebase. Look up a human gene to see every pathway it takes part in, paste a gene list to find which pathways are statistically enriched (with FDR-corrected p-values, charts and a gene-to-pathway network), and browse the full pathway hierarchy with diagrams. It ships three ways from one codebase: a desktop app (Windows, macOS, Linux), a website (GitHub Pages) and source you run with `npm`.

> **Educational and research-exploration use only. Not medical advice.** Pathway enrichment is hypothesis-generating, not proof.

- **Download:** [GitHub Releases](https://github.com/reeper316099/PathwayScope/releases) (installers are **unsigned**, see [Unsigned apps](#unsigned-apps-what-you-will-see-and-how-to-open-them))
- **Live demo:** https://reeper316099.github.io/PathwayScope/ (available after the first Pages deployment)

## Screenshots

| Gene Explorer                                            | Enrichment                                              | Pathway Browser                                           |
| -------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| ![Gene Explorer](docs/screenshots/electron-explorer.png) | ![Enrichment](docs/screenshots/electron-enrichment.png) | ![Pathway Browser](docs/screenshots/electron-browser.png) |

More (dark mode, mobile web, stored-data panel) are in [`docs/screenshots/`](docs/screenshots).

## What has actually been tested (and what has not)

This table is updated only with things that were really run. "UNTESTED LOCALLY, verified only by CI" stays until a real GitHub Actions run passes.

| Target                                              | Built locally                           | Run locally                                                   | Status                                    |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| Web app (Chrome)                                    | yes                                     | yes: 37 end-to-end tests against live Reactome                | **ran and passed**                        |
| macOS arm64 desktop app                             | yes (`.dmg`, ad-hoc signed)             | yes: packaged app ran a gene search and a 50-gene enrichment  | **ran and passed**                        |
| Desktop app via `electron .` (macOS arm64)          | n/a                                     | yes: 8 end-to-end tests (security, IPC, persistence, offline) | **ran and passed**                        |
| macOS x64 `.dmg`                                    | yes (cross-built on arm64)              | no                                                            | **UNTESTED LOCALLY, verified only by CI** |
| Windows x64 installer + portable                    | yes (cross-built on macOS, config only) | no                                                            | **UNTESTED LOCALLY, verified only by CI** |
| Linux x64 AppImage + `.deb`                         | yes (cross-built on macOS, config only) | no                                                            | **UNTESTED LOCALLY, verified only by CI** |
| GitHub Actions workflows (`ci`, `release`, `pages`) | n/a                                     | no: checked only as valid YAML and reviewed                   | **not run**                               |

## How it works

```
                    ┌────────────────────────── renderer (src/, vanilla JS) ──────────────────────────┐
 you ─ UI modules ─►│ core/reactomeContent.js   core/reactomeAnalysis.js   core/geneInfo.js           │
                    │                     └──────────────┬───────────────────┘                        │
                    │                         core/http.js  getJson(url, {method, body, ttl})         │
                    └──────────────┬─────────────────────┴───────────────────────┬────────────────────┘
                     in Electron   │                                             │   in a browser (web)
                                   ▼                                             ▼
        window.api.fetchJson ──IPC──► main process                       fetch() + throttle + retry
        (contextBridge, 7 functions)   host allowlist · https only        (needs the API to allow CORS)
                                       GET/POST only · size caps
                                       per-host rate limit · disk cache
                                                │
                                                ▼
        reactome.org (Content + Analysis Services) · rest.uniprot.org · eutils.ncbi.nlm.nih.gov
```

Enrichment flow: your gene list is parsed and cleaned (`geneList.js`) → POSTed as plain text to Reactome's Analysis Service (`/identifiers/projection`) → Reactome returns a **token** and per-pathway counts, p-values and FDR → the app pages through the results, loads the unmapped identifiers, and fetches "which of my genes are in this pathway" lazily. Tokens expire (about 7 days), so every saved session stores your gene list and the results, and re-runs itself if the token is gone.

## Run it

Requires Node.js 22.12 or newer.

```bash
npm ci
npm run dev               # web version at http://localhost:5173
npm run dev:electron      # desktop app against the dev server
npm run dev:electron:bg   # same, but the window does not steal focus
```

## Test

```bash
npm test                                   # unit tests (Vitest)
npm run test:coverage                      # with coverage of src/core
PW_CHANNEL=chrome npm run test:e2e         # end-to-end: web + Electron (uses your installed Chrome)
npm run test:e2e:web                       # web only (needs Playwright's Chromium: npx playwright install chromium)
npm run lint && npx prettier --check .
```

The end-to-end tests call the live public Reactome, UniProt and NCBI services. Those can rate-limit (HTTP 429), so Playwright retries failed tests twice and reports retried tests as "flaky". If a run flakes, wait a minute and run again.

## Build installers

```bash
npm run dist       # installers for the OS you are on, into ./release
npm run dist:dir   # just the unpacked app (faster)
```

> **macOS tip:** if your project folder is inside iCloud Drive (for example `~/Desktop` or `~/Documents`), `codesign` fails with "resource fork, Finder information, or similar detritus not allowed", because iCloud adds attributes to folders. Build outside it:
> `npm run dist -- --config.directories.output="$HOME/pathwayscope-release"`

To run the end-to-end test against the packaged app:

```bash
PS_PACKAGED_APP="$HOME/pathwayscope-release/mac-arm64/PathwayScope.app/Contents/MacOS/PathwayScope" npm run test:e2e:packaged
```

## Releases and automation (GitHub Actions)

| Workflow      | When                                  | What it does                                                                                                                                                                           |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`      | every pull request and push to `main` | `npm ci`, lint, format check, unit tests, web build, web end-to-end tests                                                                                                              |
| `pages.yml`   | push to `main`                        | builds the web version and deploys it to GitHub Pages                                                                                                                                  |
| `release.yml` | push of a tag like `v0.1.0`           | checks the tag matches `package.json`, creates a draft release, builds on Ubuntu, Windows and macOS runners, uploads the installers, adds `SHA256SUMS.txt`, then publishes the release |

Only official `actions/*` actions and the preinstalled GitHub CLI are used, pinned to the current major versions (checkout v7, setup-node v7, upload-artifact v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5; verified against the GitHub API when the workflows were written). The release job uses the built-in `GITHUB_TOKEN` with `contents: write` only for the jobs that upload.

Release artifacts: `PathwayScope-Setup-<version>-win-x64.exe`, `PathwayScope-Portable-<version>-win-x64.exe`, `PathwayScope-<version>-mac-arm64.dmg`, `PathwayScope-<version>-mac-x64.dmg`, `PathwayScope-<version>-linux-x86_64.AppImage`, `PathwayScope-<version>-linux-amd64.deb`, and `SHA256SUMS.txt`.

## Unsigned apps: what you will see and how to open them

The installers are **not code-signed and not notarized** (that needs paid developer certificates). Signing, notarization and auto-update are on the stretch list. The app is safe to inspect: the source is in this repository, and `SHA256SUMS.txt` lets you check your download.

**Windows (SmartScreen):** you will likely see "Windows protected your PC / unknown publisher". Click **More info**, then **Run anyway**.

**macOS (Gatekeeper):** the app has a valid _ad-hoc_ signature but no Apple Developer ID, so macOS will say it cannot verify the developer. Typical ways to open it:

1. Open the `.dmg`, drag PathwayScope to Applications, try to open it once.
2. Go to **System Settings → Privacy & Security**, scroll to the message about PathwayScope, click **Open Anyway** (on older macOS: right-click the app, choose **Open**, then **Open**).
3. Or, in Terminal: `xattr -dr com.apple.quarantine /Applications/PathwayScope.app`

(The exact wording depends on your macOS version. These steps were not tested on a downloaded copy.)

**Linux:** make the AppImage executable (`chmod +x PathwayScope-*.AppImage`) and run it, or install the `.deb` with `sudo apt install ./PathwayScope-*.deb`. On Ubuntu 22.04 and newer the AppImage may need `sudo apt install libfuse2`. On Ubuntu 24.04 and newer, AppArmor can block Electron's sandbox for AppImages; the `.deb` sets up the sandbox helper itself. (Linux builds are untested locally.)

## Security notes

- Electron windows use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict Content-Security-Policy (`default-src 'none'`, scripts and styles only from the app itself, no `eval`, no inline scripts), no remote code, denied permission requests, blocked navigation and blocked new windows.
- The page can call exactly seven functions (`fetchJson`, `saveFile`, `openExternal`, `getAppInfo`, `listCache`, `deleteCacheEntry`, `onMenuAction`). All arguments are validated again in the main process.
- Network access: the main process only talks to `reactome.org`, `rest.uniprot.org` and `eutils.ncbi.nlm.nih.gov` over https, GET and POST only (POST only to the Analysis Service), with size caps, timeouts, rate limiting and redirect re-checking. Links open in your browser only for an allowlist of hosts.
- Reactome's diagrams are SVG; they are sanitized (DOMPurify plus extra rules: no scripts, no foreign content, only embedded PNG data URLs) before being inlined.
- Your data stays on your device (see **Manage stored data** in the app). Gene symbols and lists you enter are sent to the public Reactome, UniProt and NCBI services to look them up, and nowhere else.

---

_Data attribution, "What I learned", and the full limitations write-up are completed in Phase 7._

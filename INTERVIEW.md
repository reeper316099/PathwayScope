# Interview talking points: PathwayScope

First-person, plain-language notes I can say out loud. Each one has a short version and the detail I can go into if asked.

## 1. What it does (30 seconds)

"PathwayScope answers one question: _given these genes, what biological processes are they part of, and how sure are we it isn't just chance?_ You can look up one gene and see every Reactome pathway it is in, paste a list of genes (say, the ones that changed in an experiment) and get a ranked list of enriched pathways with proper statistics, or browse the whole pathway tree and see diagrams with your genes highlighted. It runs as a desktop app, as a website, or from source, all from one codebase. It uses only public APIs, no keys, no server of mine."

## 2. What "over-representation analysis" means, and why FDR matters

"Imagine a pathway has 100 genes out of 16,000 in the background. If I drew 50 genes at random, I'd expect about 0.3 of them to land in that pathway. If 17 of my genes land there, that's a big surprise, and the p-value is how surprising it is. But I'm testing hundreds of pathways at once, so some will look surprising just by luck, like flipping many coins and being impressed when one lands heads ten times. FDR, the false discovery rate, corrects for that: it estimates the share of false hits among the ones I call significant. That's why the app shows both the raw p-value and the FDR, and labels which is which, and bases the significance badges on the FDR. And it's hypothesis-generating: it tells you where to look, not what is true."

## 3. The hardest problem: identifiers and being honest about what didn't map

"The hardest part wasn't the charts, it was the messy truth about gene identifiers. Reactome resolves aliases and lowercase symbols (HER2 becomes ERBB2), but it does _not_ resolve everything: when I tested Entrez IDs, 7157 (TP53) came back unmapped while the other three worked. Quotes and byte-order marks from Excel silently break the first gene. Histone genes like H2BC21 look exactly like UniProt accession numbers, so my type detector once warned 'mixed identifier types' on a pure symbol list. So I built a parser that cleans input, a type detector that handles that collision, and a results header that always says 'N submitted, M mapped, K unmapped' with the unmapped list one click away, and warns when more than 20% is unmapped. The rule I held myself to: never hide a gene you couldn't map, and never invent data."

## 4. Why the Electron main process does the network requests

"Four reasons. CORS: a browser can only call an API that allows it, but the main process can call any server. Rate limiting: I discovered the hard way that Reactome sits behind Cloudflare and answers bursts with HTTP 429, so one central place that spaces requests per host and retries politely is much better than every part of the UI fending for itself. Caching: the main process keeps a disk cache keyed by the request, including a hash of the POST body, so repeat lookups and offline mode work. And security: the page runs sandboxed with no Node access and a strict Content-Security-Policy, so the only way out is seven small functions I wrote, and the main process re-validates everything: https only, a short allowlist of hosts, GET and POST only, size limits. If the page were ever compromised, it still couldn't talk to arbitrary servers."

## 5. The CI/CD pipeline

"There are three GitHub Actions workflows. CI runs on every pull request: install, lint, format check, unit tests, build, and the browser end-to-end tests. A Pages workflow deploys the website on every push to main. And a release workflow runs when I push a tag like v0.1.0: it checks the tag matches package.json, creates a draft release, builds installers in parallel on Linux, Windows and macOS runners, uploads them, computes SHA-256 checksums, and publishes. I used only official `actions/*` actions, pinned to major versions that I looked up rather than guessed, and the token has the minimum permissions. One honest caveat: the installers are unsigned because signing certificates cost money, so I documented exactly what users will see and how to open them."

## 6. Trade-offs I made

"Vanilla JavaScript with small modules instead of a framework: less magic, easier to explain every line, and a smaller bundle. SVG diagrams instead of Reactome's official widget: the widget loads scripts from reactome.org at runtime, which breaks a strict CSP and my rule that the page has no network, so I fetch the SVG through the main process and sanitize it. A hand-rolled browser cache and a tiny hyperscript helper instead of more libraries. Computing the 'found / total' ratio myself because Reactome's own ratio means something different. I chose correctness and transparency over cleverness every time."

## 7. Honest limitations

"It's enrichment, not causation. The background is all human Reactome entities, not just the genes someone measured, which can matter. Reactome's p-values bottom out around 1e-16, so many top pathways tie and their order means nothing, and the app says so. Counts are proteins, not genes, so paralogs can make 'found' smaller than your gene count. It's human only. The web version depends on the APIs allowing browsers and not rate-limiting them. And I've only run it end to end on macOS; Windows and Linux builds come from CI and are untested by me until a real release runs."

## 8. How I tested it, and what the tests caught

"Three layers. Unit tests for the data layer, using _real saved API responses_ as fixtures, never made-up data. End-to-end tests with Playwright against the live services, in a browser and in the actual Electron app, including blocked services, slow networks, offline mode and restarts. And a spot-check against Reactome's own website for the same analysis: 12 of 12 pathways matched on counts and FDR. The tests caught real bugs: Cytoscape injecting a style tag that my security policy blocked, a selection bug where picking a gene un-picked the pathway, an option whitelist silently dropping a new field, and Cloudflare rate limits that looked like CORS errors. I also learned not to trust a green run from my own machine: on GitHub's first CI run, the live-API tests failed because Reactome's CDN rate-limits GitHub's shared runner IPs. So I split the suite: a small hermetic set that needs no live data runs on every pull request (I proved it by blocking the live hosts and watching it still pass), and the live tests run weekly and on demand, reported separately."

## 9. Designing for statistical honesty

"I treated the UI as a place where it's easy to mislead. So every table shows the raw p-value and the FDR, labeled; the header states the background, the test, and that FDR is computed before filters; values at Reactome's precision floor are shown as 'less than 1e-15' instead of a fake precise number; the 'What this means' text is generated only from computed numbers with fixed templates, so it can't make biological claims; and missing data says 'not available'. Colors always come with a shape and a label, so it's readable for color-blind users."

## 10. Security and privacy

"The desktop window is sandboxed with context isolation and no Node in the page, a Content-Security-Policy with no inline scripts and no `eval`, blocked navigation and new windows, and denied permission requests. Reactome's SVG diagrams are sanitized before I show them, and only embedded PNG images are allowed. For privacy, everything is stored locally, there's a 'Manage stored data' panel where you can delete items one by one or everything at once, and the app tells you plainly that the genes you type are sent to Reactome, UniProt and NCBI to look them up, and nowhere else."

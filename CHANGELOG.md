# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-28

First beta release (Chrome Web Store, unlisted).

### Added
- PDF support: a bundled pdf.js viewer with the same highlights, notes and re-anchoring. The viewer keeps the basics of Chrome's: links (references and other internal links jump to their target and Back returns, web links open in a new tab, mailto: opens your mail app), zoom (buttons, Ctrl/⌘ +/−/0, Ctrl+wheel; annotations stay attached), page number and go-to-page, table of contents, download and print. Chrome's PDF viewer shows an "Open in WWM" prompt; PDFs you have annotated reopen in WWM automatically.
- English / Korean UI (`_locales`), following the browser language.
- Privacy policy (`PRIVACY.md`, en/ko), store screenshots & promo tiles generated from the real extension.
- CI workflow (type-check, tests, production build).
- MV3 extension: content script toolbar & popover, service worker, side panel.
- Core: URL normalization, DOM text index, W3C selectors, tiered re-anchoring (position → exact quote → fuzzy).
- Rendering with the CSS Custom Highlight API (4 highlight colors, underline, bold, notes).
- Re-anchoring regression fixtures (v1 → v2 page pairs) and an e2e smoke test.

### Fixed
- Short, unique quotes were labelled "moved" when only a neighbouring paragraph changed.
- Fuzzy matches could start or end in the middle of a word.

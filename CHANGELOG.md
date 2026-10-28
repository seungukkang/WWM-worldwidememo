# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
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

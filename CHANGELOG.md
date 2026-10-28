# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-28

First public beta (Chrome Web Store, unlisted).

### Added
- Labels for annotated pages: create them from the current page or the All tab, put several on a page, and filter the All tab by label chips. Rename, recolor, reorder and delete labels (delete can be undone).
- Search in the All tab across page titles, addresses, quotes and notes, plus built-in filters: with notes, needs attention, PDF.
- Rename pages in the All tab (✎); the name is kept when the page's own title changes, is searchable, and is shown on the This page tab. Clearing it restores the page's title.
- Clicking a page in the All tab switches to it if it is already open in the window, instead of opening it again.
- JSON export includes labels (format version 2).
- The annotation popover and the note editor can be dragged by their ⋮⋮ handle, like the selection toolbar; a dragged popover stays put when you change the style.

### Fixed
- After WWM is updated or reloaded, tabs that were already open no longer show a toolbar that silently does nothing: they show a "refresh this page" notice instead.

### Changed
- Storage schema version 2. Existing data is migrated once on update, after a local backup.

## [0.1.0] - 2026-10-28

Submitted to the Chrome Web Store, then replaced by 0.2.0 before it was published.

### Added
- PDF support: a bundled pdf.js viewer with the same highlights, notes and re-anchoring. The viewer keeps the basics of Chrome's: links (references and other internal links jump to their target and Back returns, web links open in a new tab, mailto: opens your mail app), zoom (buttons, Ctrl/⌘ +/−/0, Ctrl+wheel; annotations stay attached), page number and go-to-page, table of contents, download and print. Chrome's PDF viewer shows an "Open in WWM" prompt; PDFs you have annotated reopen in WWM automatically.
- English / Korean UI (`_locales`), following the browser language.
- Privacy policy (`PRIVACY.md`, en/ko), store screenshots & promo tiles generated from the real extension.
- CI workflow (type-check, tests, production build).
- MV3 extension: content script toolbar & popover, service worker, side panel.
- Core: URL normalization, DOM text index, W3C selectors, tiered re-anchoring (position → exact quote → fuzzy).
- Rendering with the CSS Custom Highlight API (4 highlight colors, underline, bold, notes).
- Re-anchoring regression fixtures (v1 → v2 page pairs) and an e2e smoke test.

### Added (editing)
- Click an annotation to change it: switch or remove the highlight color and toggle underline/bold (combinations allowed); "Add note" / "Edit note".
- Deleting an annotation shows an "Undo" toast.
- Toolbar options in the side panel (⚙): floating toolbar, a small icon that expands into it, or side panel only; above or below the selection; opacity. The page toolbar can be dragged by its ⋮⋮ handle (it reopens at its usual place), and Esc closes it.
- Style bar at the top of the side panel: highlight, underline, bold or add a note to the text selected on the page.
- Undo / redo in the side panel (↶ ↷, or ⌘Z / ⇧⌘Z while the panel has focus) for your edits on the current page: create, delete, style, note (recover an overwritten note) and confirm position. Kept until the browser closes.

### Changed
- Re-anchoring follows long highlights through typical edits (a few words replaced, a phrase added) automatically when the surrounding text is unchanged.
- Short highlights (a word or short phrase) are never moved automatically: they are restored only where their neighbouring text confirms it, otherwise you are asked or they are kept under "not found". Fixes highlights jumping between messages in chat apps.

### Fixed
- Changing toolbar settings now applies to text that is already selected, not only to the next selection.
- The side panel could list a new annotation twice (e.g. the first highlight in a PDF opened while the panel was open).
- Short, unique quotes were labelled "moved" when only a neighbouring paragraph changed.
- Fuzzy matches could start or end in the middle of a word.

# Chrome Web Store assets

Generated from the real extension on the demo article in `demo/` (no third-party content):
`npm run build && npm run store-assets` (see the script header for rendering the English set on macOS).

| File | Size | Use |
| --- | --- | --- |
| `icon-128.png` | 128×128 (96×96 artwork + 16px padding) | Store icon |
| `global/screenshot-1..4.png` | 1280×800 | Screenshots for all languages (English UI) |
| `en/`, `ko/` `screenshot-1..4.png` | 1280×800 | Localized screenshots |
| `en/`, `ko/` `promo-small.png` | 440×280 | Small promo tile |

1. A site update: annotations restored, followed, flagged for review or kept as not found; popover and side panel.
2. Selection toolbar with its drag handle; side panel style bar and toolbar settings.
3. A PDF in the WWM viewer with annotations.
4. Annotated pages organized with labels, search and filters (side panel, All tab).

Check the [image requirements](https://developer.chrome.com/docs/webstore/images) again before submitting.

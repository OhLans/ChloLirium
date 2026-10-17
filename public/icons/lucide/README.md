# ChloLirium icons

Selected SVGs from `lucide-static@1.58.0`, https://lucide.dev.
The original ISC and Feather/MIT notices are in [LICENSE](LICENSE).
SVG artwork is copied unchanged from the official npm package.

Package integrity: `sha512-VFE2ZEq3yEwjBH0El9CA9lHgDWKKXPKgKxFzX+/JN1FPa4maQbtl/pT4B62aJkUEpODT5octDsyGy7tPVE2svQ==`.

`src/chlolirium/lucide-map.json` maps existing `fa-*` classes to Lucide names.
Keeping those classes preserves extension selectors, state changes, saved Quick Reply icons,
and native click handlers. Font Awesome remains a fallback for brand logos and unmapped icons
supplied by other extensions. No font files need to be replaced.

Run `node src/chlolirium/build-icons.mjs` to regenerate the stylesheet and picker catalog.
Use `--check` to verify committed outputs. The stylesheet embeds only this selected subset;
it needs no icon CDN, JavaScript renderer, DOM scan, or new runtime dependency.

New controls can use `class="cl-icon cl-icon-settings"` (with an accessible label on the control).
The Moonlit Courtyard Suit compatibility rules change masks only and retain portrait-first controls.

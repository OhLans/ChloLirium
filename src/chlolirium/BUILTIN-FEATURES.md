# Built-in interface features

ChloLirium bundles Moonlit Echoes, Moonlit Courtyard Suit, Identity Switch,
Chat Completion Tabs, Emoji Picker, and Quick Persona as system modules in
`public/scripts/extensions/chlo-*`. They are maintained and updated with the
fork. They keep SillyTavern's existing module lifecycle, per-module enable
switches, native drawer elements, and original settings panels.

## Existing installations

Run `UpdateAndStart.bat` from the installation tracking this fork's `staging`
branch, then hard-refresh the browser. The integration does not relocate or
replace chats, characters, personas, lorebooks, API profiles, or theme files.

`public/scripts/chlolirium-builtins.js` filters matching standalone copies
before their scripts or styles execute. It recognizes the known repository
folder names and manifest display names. A disabled standalone component
starts disabled as a built-in; this is migrated once per component so later
choices made through the built-in switches persist. Standalone folders are
left untouched and can be removed after checking the update. They are not
needed for the built-in features to work.

Settings remain in their original locations:

| Component | Preserved state |
| --- | --- |
| Moonlit Echoes | `extension_settings.SillyTavernMoonlitEchoesTheme`, all 59 controls, named/active presets, raw CSS, original-avatar preference |
| Courtyard | `extension_settings.moonlitCourtyardSuit` and existing Navigator/browser view preferences |
| Identity Switch | `extension_settings.identitySwitch`, with existing `charSwitch`/`charSwitchx` preferences as fallbacks |
| Completion tabs | `extension_settings.ChatCompletionTabs` and `openai-active-tab` browser preference |
| Emoji picker | Emoji Mart's existing browser storage for frequent emoji and skin tone |
| Quick Persona | SillyTavern's native persona, avatar, title, and default-persona data |

The former custom `em-emoji-picker` positioning/color snippet is included in
the built-in picker and can be removed from custom CSS. The built-in CSS
also tolerates that snippet remaining during the transition.

## Integration changes

- Identity's two portraits share size, crop, and visible-circle geometry in
  both toolbar layouts. Navigator uses the same size with vertical clearance.
  Removed the character-only fractional inset and translation, and restricted
  the character-only geometry animation to opacity.
- Emoji Mart's runtime and native Unicode data load locally on first use.
  The picker stays mounted for subsequent opens. Selection preserves the
  composing caret and leaves the panel open; the close button and Escape
  close it. Only the emoji button toggles the panel. No outside-click handler
  is installed. Manual popover anchoring escapes the transformed page root,
  with a positioning fallback and visual-viewport handling for phone keyboards.
- Quick Persona handles overlapping open/close requests and observes native
  persona changes. Identity discards stale asynchronous character portraits.
- The translation observer tolerates an attribute removed before its queued
  mutation is processed.
- Lucide aliases cover the bundled components; unknown extension and brand
  icons still use the existing Font Awesome fallback.

## Sources and maintenance

Exact upstream revisions and the supplied Identity archive's SHA-256 are
recorded in `builtin-sources.json`. Source authorship and AGPL licenses are
retained in each component. Emoji Mart 5.6.0 and `@emoji-mart/data` 1.2.1 are
MIT-licensed and bundled with their license texts. Courtyard's existing
MingCute icon assets retain their Apache 2.0 attribution/license; shared
interface rendering uses the fork's Lucide mappings.

Emoji Mart's vendored ESM runtime was minified with Terser (`module: true`,
`compress: true`, `mangle: true`, no source map) from the npm package's
`dist/module.js`; native data is `@emoji-mart/data/sets/15/native.json`.
No additional npm install or CDN is needed at runtime.

When updating a component, retain its original settings keys, rebase external
relative imports for its built-in location, update `builtin-sources.json`,
and run the focused settings/migration/browser checks as well as repository
lint and unit tests. Keep the character/persona drawer DOM in its native
parent; Navigator repositions the toggles without moving the drawer panels.

```sh
npm run lint
npm run test:unit --prefix tests -- --runInBand
npm exec --prefix tests -- playwright test --config tests/playwright.config.js ChloLiriumBuiltins.e2e.js ChloLiriumIcons.e2e.js --workers=1
node src/chlolirium/build-icons.mjs --check
```

Browser checks use isolated temporary data and make no paid model requests.
They cover settings/preset preservation and persistence, duplicate prevention,
portrait geometry at several scales, native drawers and selection, prompt
tabs, repeated emoji insertion, retained picker instances, legacy CSS, and
phone viewport bounds. Actual Windows and iPhone hardware remain separate
manual validation targets.

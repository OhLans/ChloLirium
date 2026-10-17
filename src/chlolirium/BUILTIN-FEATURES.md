# Native ChloLirium interface

Moonlit Echoes, Courtyard's Navigator and character/persona panels, Identity
Switch, Chat Completion Tabs, Emoji Picker and Quick Persona are integrated
into core startup. Their source lives in `public/scripts/chlolirium/`, outside
the extension directories. They have no extension manifests, registration,
loader enable flags or entries in extension management.

`public/script.js` calls `initChloLirium()` after settings load, whether or not
extensions are enabled in the server configuration. Startup explicitly calls
each feature's initializer once. The core page owns the composer buttons and
native setting locations; `public/css/chlolirium-interface.css` owns the shared
styles. Theme styles remain switchable with the appearance setting.

## Settings and controls

- **User Settings → Moonlit Echoes Theme** holds all 59 appearance controls,
  named presets, custom CSS, theme enable switch and original-image preference.
  The existing sidebar shortcut and popout remain available. A Customize
  Moonlit appearance shortcut beside UI Theme opens the same controls.
- **User Settings → Navigation portraits** holds character/persona visibility
  and character-switcher favorite/count preferences.
- **Chat Completion Presets** in the API settings panel holds the switch for
  separating Parameters and Prompts into tabs. Changing API and presets uses
  native events, with no polling timer.
- The persona selector and emoji button belong to the chat composer. The emoji
  picker loads local Emoji Mart/data on first use and stays open while typing
  and selecting multiple emojis. Close and Escape dismiss it.

Historical storage keys are retained for compatibility; their names do not
imply extension loading:

| Feature | Preserved settings |
| --- | --- |
| Moonlit appearance | `extension_settings.SillyTavernMoonlitEchoesTheme`, all controls, named/active presets, raw CSS, original-avatar preference |
| Courtyard | `extension_settings.moonlitCourtyardSuit` and existing Navigator/browser view preferences |
| Identity | `extension_settings.identitySwitch`, with `charSwitch`/`charSwitchx` fallbacks; `showPersonaAvatar` defaults to true |
| Completion tabs | `extension_settings.ChatCompletionTabs` and `openai-active-tab` browser preference |
| Emoji | Emoji Mart browser storage for frequent emoji and skin tone |
| Quick Persona | Native persona, avatar, title and default-persona data |

## Updating an existing installation

Run `UpdateAndStart.bat` on this fork's `staging` branch and hard-refresh the
browser. Chats, characters, personas, lorebooks, API profiles, theme files and
standalone extension folders are not relocated or deleted.

`legacy-extensions.js` excludes known standalone copies and stale `chlo-*`
bundles before scripts, styles or update checks can run. This prevents duplicate
implementations; original standalone files remain available as backups. The
six obsolete bundle manifests and tracked extension files are removed by Git.

Unchecked standalone-extension boxes do not disable native features. Migration
removes only obsolete `chlo-*` disabled flags and the previous bundle migration
marker. It preserves original third-party checkbox choices and feature-level
preferences, including a deliberately disabled Moonlit theme or completion
tabs. Old standalone folders may be removed after verifying the native UI.

The former `em-emoji-picker` positioning/color snippet is included and can be
removed from custom CSS. The core picker also tolerates it remaining during
the transition.

## Retained fixes and maintenance

- Portraits share size, crop, visible-circle geometry and vertical clearance in
  both toolbar layouts. Fractional character-only positioning and geometry
  animations remain removed. Narrow toolbar observers and native events
  replace Identity's polling interval.
- Emoji Mart/data remain local and load on demand. The picker instance is
  reused; insertion respects the caret and keeps the picker open. Manual
  popover positioning handles transformed page roots and phone keyboards.
- Quick Persona retains asynchronous menu safeguards and native persona events.
  Identity discards stale asynchronous character portraits.
- Theme presets, color/alpha controls, checkbox CSS rules and avatar settings
  retain their original keys. Core live bindings replace the extension API
  global. Original authorship, licenses and translation files are retained.

Exact source revisions and the supplied Identity archive hash are recorded in
`builtin-sources.json`. Emoji Mart 5.6.0 and `@emoji-mart/data` 1.2.1 are
MIT-licensed. Courtyard's original MingCute assets retain Apache 2.0 attribution;
shared icons use the fork's Lucide mappings. No CDN or new package install is
required at runtime.

```sh
npm run lint
npm run test:unit --prefix tests -- --runInBand
npm exec --prefix tests -- playwright test --config tests/playwright.config.js ChloLiriumBuiltins.e2e.js ChloLiriumIcons.e2e.js --workers=1
node src/chlolirium/build-icons.mjs --check
```

Browser tests use isolated data and make no paid model requests. They cover
migration from unchecked bundles/originals, no duplicate loading, initialization
without the extension system, theme settings/presets, native setting locations,
portrait geometry/preferences, emoji behavior, persona/character selection,
API tabs and phone viewport bounds. Actual Windows and iPhone hardware remain
separate manual validation targets.

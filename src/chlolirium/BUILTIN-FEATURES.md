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

## Preset Library and shared generation settings

The book button in Navigator opens the collection first. Without Navigator,
use **Preset Library** in the Chat Completion settings panel. The same window
contains Presets, Blocks and Parameters. Parameters defaults to a resizable
dock; on desktop the chat occupies the space beside it. The workspace uses a
manual popover on supported browsers so transformed phone layouts cannot move
it out of the viewport. Chat input remains accessible while the dock is open.

- Selecting a collection item previews it; **Use** activates it. Search,
  favorites and recent presets work with the existing collection. Favorite and
  recent preferences use `extension_settings.chloPresetLibrary`.
- Blocks edit native ST prompts: identifiers, marker flags, all character
  orders, roles, content, injection position/depth/order, generation triggers,
  character overrides and embedded extension data are retained. Numbered rows
  follow the real prompt order; category labels never reorder generation.
  Unused blocks remain visible and can be enabled. The preview is prompt text,
  not a claim to display resolved per-generation lorebook or macro output.
- Edits stay in a draft until **Save preset** or **Use in chat**. Closing or
  navigating away asks before discarding changes; failed saves keep the draft.
  Saving the active preset also persists its current settings before reporting
  success, so an immediate reload retains the edits. New input arriving during
  a save remains an unsaved draft instead of being replaced by the response.
- Covers and descriptions are optional preset metadata under `chlo_preset`;
  category labels are `chlo_category` on individual blocks. Cover files are
  resized and stored locally in the preset, with no external image service.
- Import reviews ST chat-completion JSON, prompt-manager exports and legacy
  `main_prompt`/`nsfw_prompt`/`jailbreak_prompt` JSON as a draft before writing.
  This does not implement the LumiVerse Loom engine or `.loom` conversion.

`presets/model.js` explicitly separates prompt fields from shared generation
and connection settings. All chat-completion preset selection paths, including
the native selector, `/preset` and character bindings, apply only prompt fields.
Context, response length, samplers, streaming, reasoning/tool settings, API,
model, endpoint and credentials remain current. Connection profiles retain
their own API/model/URL commands. Text-completion preset behavior is unchanged.

Saving a prompt preset writes prompt fields only. Existing legacy files remain
in place and their embedded generation values are ignored when selecting them;
they are replaced with prompt-only data when explicitly saved. Native legacy
prompt migrations may still rewrite the migrated preset as before. Export a
copy before saving if the original combined parameter values are needed in
another frontend. The obsolete bind-preset-to-connection switch is hidden;
the setting key and node remain for older integrations.

The Parameters view temporarily moves the original controls with their IDs and
handlers intact, using comment anchors to restore their exact positions. Native
theme colors remain live. Advanced message formatting is still prompt content;
editing those controls updates an open draft of the active prompt as well.

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

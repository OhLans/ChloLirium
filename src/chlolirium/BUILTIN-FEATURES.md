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
- **Parameters → Panel layout** holds the existing switch for separating the
  collection, parameters and prompts into pages. Changing API and presets uses
  native events, with no polling timer.
- The persona selector and emoji button belong to the chat composer. The emoji
  picker loads local Emoji Mart/data on first use and stays open while typing
  and selecting multiple emojis. Close and Escape dismiss it.

## Native preset panel and shared generation settings

The existing AI Configuration drawer keeps its native position, width, pin
behavior and theme settings. With the existing tab layout enabled, its opening
page shows the native preset select's options as a vertical stack of cards.
Use applies a card through that select's normal change handler while staying in
the collection, so Export/Delete can target it there. Edit or the title opens Prompts.
Parameters is another page in the same narrow drawer.

Import, Export and Delete are on the collection page, with the active preset
named beneath them. Save, Rename and Save as are beside the open preset's name
on the Prompts page. The duplicate native toolbar is replaced while this layout
is active. These are the actual native control nodes, moved with their IDs and
handlers intact; disabling the layout restores their original positions.

Import, export, save, save-as, rename, delete, prompt creation, prompt toggles,
drag ordering, token counts and editing all use their original ST controls and
handlers. The real edit/inspect form is mounted in the Prompts page while the
layout is active, then restored to its original location when the layout is
disabled or the API changes. The editor keeps native roles, depth, triggers,
override controls and macro autocomplete.

The separate workspace, additional Navigator button, chat reflow, favorites,
recent filters, previews and draft system remain removed. All of this fits the
native left drawer; it does not change the drawer or chat geometry.

Prompt section headings label consecutive runs of native blocks as Core
instructions, Character & persona, World & memory and Conversation. An explicit
`chlo_category` from an earlier saved preset or Loom conversion takes precedence.
Headings never regroup/reorder blocks, contribute prompt text or appear in the
sortable data. Editing, disabling, dragging and saving still use PromptManager.

Cards show existing raster/HTTP cover images instead of the book tile. Clicking
the tile lets the user upload, replace or remove a cover. Uploaded images are
resized to at most 384×384 and embedded as JPEG in `chlo_preset.cover`; they travel
with native saves, rename, save-as, export and backups. This saves the preset
file immediately, including current prompt edits when it is the active preset;
it never selects an inactive preset or changes shared generation parameters.
Cancel leaves the file unchanged. SVG uploads and active URL schemes are rejected.

Two original examples, **Chlo - Loom example** and **Chlo - Legacy example**, are
seeded through the normal content index on startup. Existing files are not
overwritten and the active preset is not switched. The source fixtures are in
`tests/fixtures/chlolirium`; tests compare the installed examples with actual
conversion results. Deleted examples stay deleted after later starts, as with
other bundled content.

The existing Import action also accepts JSON `.loom` files. `presets/import.js`
converts a limited Loom subset to native ST prompts: text blocks, categories,
enabled state, system/user/assistant roles, known ST content markers, ordered or
in-history placement, depth, generation triggers and portable prompt formatting.
Empty category headers remain presentation metadata; category content is kept
as a real prompt, because presets can use it to initialize variables. Imported
absolute blocks receive distinct native priorities to preserve interleaved roles.
Files that need dynamic repositioning around Chat History are rejected with an
explanation rather than silently changing visible order. Samplers and connection
settings stay shared. This is not a complete Loom runtime: block-variable definitions/placement bindings,
append roles, radio categories, protected blocks, character-tag conditions,
custom request bodies, unknown markers and nonportable macros are rejected
before import writes or changes selection. The current supported macro subset
is explicit in the adapter. Legacy ST text fields and native prompt-manager
exports also import through this same action. Existing native extension data
is retained. No unsupported block is silently dropped.

For newly converted Loom presets (`chlo_preset.loom_compat: 1`), an isolated
resolver evaluates enabled prompts in native order. It supports identity/card
macros, comments, trim/noop/newline/space, inline and scoped setvar/setchatvar,
getvar/getchatvar, nested if/else with truthiness/negation, weighted random lists,
numeric random ranges and NdS dice. Local variables reset for each collection;
chat variables live in `chat_metadata.chlo_loom_variables` and use the normal
chat save. Disabled and untriggered blocks have no side effects. Unchosen
conditional branches are not evaluated. Native presets and ST's macro-engine
preference are unchanged. Group nudges resolve groupOthers without the user or
focused character. This subset does not support Loom expression conditions,
macro flags, JSON/iteration macros or other advanced services.

Portable regex rules are converted once into native preset-scoped scripts,
retaining sort order, disabled state, flags, targets, edit behavior and depths.
Identical root/embedded collections are not installed twice. Native permission
and Regex enable controls still apply. Converted scripts retain Loom's `none`
or `escaped` replacement semantics, including JS captures; captured chat prose
is never evaluated as a macro. Only persisted chat-variable and identity reads
are supported in escaped regex templates. Other modes/actions/scopes abort
import before any write. The native regex editor retains compatibility when
previewing and saving; unsupported Raw substitution and capture trimming are
disabled for converted rules. Ordinary native regex editing is unchanged.
The supplied Sola preset is used only for local QA;
the repository contains original neutral fixtures, not that preset's content.

The importer accepts portable Loom JSON, not database/API records. Format
reference: LumiVerse's portable `LoomPreset` / `PromptBlock` definitions
and ST marker map at commit
[`3ca135a`](https://github.com/prolix-oc/Lumiverse/tree/3ca135a20a31f4ba18c8e96b24724cd73ad7c8eb/frontend/src/lib/loom).
This fork uses its own small conversion adapter, not LumiVerse's runtime.

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

The original tab manager places the live parameter controls in their page.
Native theme colors remain live. Advanced message formatting remains prompt
content and uses its existing native controls.

Historical storage keys are retained for compatibility; their names do not
imply extension loading:

| Feature | Preserved settings |
| --- | --- |
| Moonlit appearance | `extension_settings.SillyTavernMoonlitEchoesTheme`, all controls, named/active presets, raw CSS, original-avatar preference |
| Courtyard | `extension_settings.moonlitCourtyardSuit` and existing Navigator/browser view preferences |
| Identity | `extension_settings.identitySwitch`, with `charSwitch`/`charSwitchx` fallbacks; `showPersonaAvatar` defaults to true |
| Completion tabs | `extension_settings.ChatCompletionTabs`; the opening page defaults to Presets |
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

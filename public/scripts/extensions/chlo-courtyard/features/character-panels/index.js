import { getContext, createFrameTask, createObserverRegistry, onSillyTavernEvents, setText, setAttribute, setHidden, toggleClass } from '../../core/runtime.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const observers = createObserverRegistry();
const subscriptions = [];
const scheduleRefresh = createFrameTask(refreshVisiblePanels);
const scheduleEditorChrome = createFrameTask(() => {
    syncEditorHero();
    syncEditorChrome();
});
const moved = new Map();

function rememberAndMove(node, target) {
    if (!node || !target) return;
    if (!moved.has(node)) {
        const placeholder = document.createComment(`rcp-placeholder:${node.id || node.className || node.tagName}`);
        node.parentNode?.insertBefore(placeholder, node);
        moved.set(node, placeholder);
    }
    if (node.parentNode !== target) target.appendChild(node);
}

function restoreNode(node) {
    const placeholder = moved.get(node);
    if (!placeholder?.parentNode) return;
    placeholder.parentNode.insertBefore(node, placeholder);
    placeholder.remove();
    moved.delete(node);
}

function getListGroupPanel(groupOrId) {
    const id = typeof groupOrId === 'string' ? groupOrId : groupOrId?.id;
    if (!id) return null;
    return document.querySelector(`.rcp-group-panel[data-rcp-owner="${id}"]`);
}

function getListUtilityTray() {
    return $('#rcp-list-utility-tray');
}

function syncListUtilityTray() {
    const tray = getListUtilityTray();
    if (!tray) return;

    const anyOpen = $$('.rcp-group').some(group => group.classList.contains('open'));
    setHidden(tray, !anyOpen);
    setAttribute(tray, 'aria-hidden', String(!anyOpen));
}

function makeGroup(id, title, iconClass) {
    const wrap = document.createElement('div');
    wrap.className = 'rcp-group';
    wrap.id = id;
    wrap.innerHTML = `
        <button class="rcp-group-toggle" type="button" title="${title}" aria-expanded="false">
            <i class="${iconClass}" aria-hidden="true"></i>
            <span>${title}</span>
        </button>
        <div class="rcp-group-panel" data-rcp-owner="${id}" role="group" aria-label="${title}"></div>
    `;

    const toggle = $('.rcp-group-toggle', wrap);
    const panel = $('.rcp-group-panel', wrap);

    toggle.addEventListener('click', (event) => {
        event.stopPropagation();

        // Persistent Rivelle submenu: this button is the sole owner of this
        // group's open/closed state. Clicking elsewhere (including another
        // group) must not collapse it.
        const opening = !wrap.classList.contains('open');
        wrap.classList.toggle('open', opening);
        toggle.setAttribute('aria-expanded', String(opening));
        panel?.classList.toggle('rcp-panel-open', opening);
        syncListUtilityTray();
    });

    panel?.addEventListener('click', event => event.stopPropagation());
    return wrap;
}

/* =========================================================
   CHARACTER LIST
   ========================================================= */
function suppressNativeCharacterTooltip(card) {
    if (!card) return;

    // SillyTavern puts a native browser tooltip like
    // "[Character] Name / File: avatar.png" on character avatars.
    // It is informational only, so keep the value in data-* and remove the
    // title attribute to prevent the intrusive browser tooltip.
    const targets = [
        card.querySelector(':scope > .avatar'),
        card.querySelector(':scope > .avatar img'),
    ].filter(Boolean);

    for (const node of targets) {
        if (!node.hasAttribute('title')) continue;
        node.dataset.rcpNativeTitle = node.getAttribute('title') || '';
        node.removeAttribute('title');
    }
}

function decorateCharacterCards(cards) {
    for (const card of cards) {
        if (!card.matches?.('.character_select, .group_select, .bogus_folder_select')) continue;
        if (!card.classList.contains('rcp-character-card')) card.classList.add('rcp-character-card');
        suppressNativeCharacterTooltip(card);
    }
}

function isCharacterListVisible(block = $('#rm_characters_block')) {
    if (!block) return false;
    return getComputedStyle(block).display !== 'none';
}

function isCharacterEditorVisible(editor = $('#rm_ch_create_block')) {
    if (!editor) return false;
    return getComputedStyle(editor).display !== 'none';
}

function syncCharacterListChrome(block = $('#rm_characters_block')) {
    const active = isCharacterListVisible(block);
    toggleClass(document.body, 'rcp-character-list-active', active);

    const shell = $('#rcp-list-toolbar');
    if (shell) {
        setHidden(shell, !active);
        setAttribute(shell, 'aria-hidden', String(!active));
    }

    // The all-characters view deliberately has no character/name header.
    // If an older build injected its temporary fallback label, clear it.
    const nativeTitle = $('#rm_button_selected_ch h2');
    if (active && nativeTitle?.dataset?.rcpFallbackTitle === 'true') {
        nativeTitle.textContent = '';
        delete nativeTitle.dataset.rcpFallbackTitle;
    }
}

function ensureCharacterListShell() {
    const block = $('#rm_characters_block');
    const fixedTop = $('#charListFixedTop');
    const list = $('#rm_print_characters_block');
    const nativeTop = $('#CharListButtonAndHotSwaps');
    if (!block || !fixedTop || !list) return;

    toggleClass(block, 'rcp-list-mode', true);

    let shell = $('#rcp-list-toolbar');
    if (!shell) {
        shell = document.createElement('div');
        shell.id = 'rcp-list-toolbar';
        shell.innerHTML = `
            <div id="rcp-list-mainline">
                <div id="rcp-search-slot"></div>
                <div id="rcp-sort-slot"></div>
            </div>
            <div id="rcp-list-groups"></div>
        `;

        const groups = $('#rcp-list-groups', shell);
        groups.append(
            makeGroup('rcp-actions-group', 'Actions', 'fa-solid fa-plus'),
            makeGroup('rcp-filters-group', 'Filters', 'fa-solid fa-filter'),
            makeGroup('rcp-view-group', 'View', 'fa-solid fa-sliders'),
        );
    }

    // The right-panel header already has the persistent panel lock at its
    // left edge. Put the complete character-list toolbar directly beside it
    // instead of wasting another full row below the character name.
    // Rivelle Navigator hides the native HotSwapWrapper visually while keeping
    // it alive for SillyTavern, so this slot remains clean and stable.
    if (nativeTop && shell.parentNode !== nativeTop) {
        const hotSwap = $('#HotSwapWrapper', nativeTop);
        nativeTop.insertBefore(shell, hotSwap || null);
    } else if (!nativeTop && shell.parentNode !== fixedTop) {
        fixedTop.prepend(shell);
    }

    toggleClass(fixedTop, 'rcp-toolbar-relocated', true);

    const searchForm = $('#form_character_search_form');
    const sort = $('#character_sort_order');
    const searchToggle = $('#rm_button_search');
    if (searchForm) rememberAndMove(searchForm, $('#rcp-search-slot'));
    if (sort) rememberAndMove(sort, $('#rcp-sort-slot'));
    if (searchToggle) rememberAndMove(searchToggle, $('#rcp-search-slot'));

    // The three grouped menus share one inline expansion tray directly above
    // the cards. This keeps them out of the way of character portraits while
    // preserving SillyTavern's expected DOM ancestry for filters/actions/view.
    let tray = $('#rcp-list-utility-tray');
    if (!tray) {
        tray = document.createElement('div');
        tray.id = 'rcp-list-utility-tray';
        tray.hidden = true;
        tray.setAttribute('aria-hidden', 'true');
        block.insertBefore(tray, list);
    } else if (tray.parentNode !== block) {
        block.insertBefore(tray, list);
    }

    for (const id of ['rcp-actions-group', 'rcp-filters-group', 'rcp-view-group']) {
        const group = $(`#${id}`);
        const panel = getListGroupPanel(id);
        if (group && panel && panel.parentNode !== tray) {
            tray.appendChild(panel);
            panel.classList.remove('rcp-detached-panel');
            panel.style.removeProperty('top');
            panel.style.removeProperty('right');
        }
        panel?.classList.toggle('rcp-panel-open', !!group?.classList.contains('open'));
    }
    syncListUtilityTray();

    const actionsPanel = getListGroupPanel('rcp-actions-group');
    [
        $('#rm_button_create'),
        $('#character_import_button'),
        $('#external_import_button'),
        $('#rm_button_group_chats'),
        $('#rm_buttons_container'),
    ].filter(Boolean).forEach(node => rememberAndMove(node, actionsPanel));

    const filterPanel = getListGroupPanel('rcp-filters-group');
    const tagControls = $('#rm_characters_block .rm_tag_controls');
    if (tagControls) rememberAndMove(tagControls, filterPanel);

    const viewPanel = getListGroupPanel('rcp-view-group');
    const pagination = $('#rm_print_characters_pagination');
    if (pagination) rememberAndMove(pagination, viewPanel);


    syncCharacterListChrome(block);
}

/* =========================================================
   CHARACTER EDITOR
   ========================================================= */
function getContextCharacter() {
    const ctx = getContext();
    const id = ctx?.characterId;
    return id === undefined || id === null ? null : ctx?.characters?.[id] || null;
}

function isCreatingCharacter() {
    return $('#form_create')?.getAttribute('actiontype') === 'createcharacter';
}

function fullCharacterImage() {
    // In create mode SillyTavern intentionally keeps the previously selected
    // character as global chat context. The editor, however, is a NEW card.
    // Always trust the create form preview there, not the chat context.
    if (isCreatingCharacter()) {
        return $('#avatar_load_preview')?.src || '';
    }

    const char = getContextCharacter();
    if (char?.avatar && char.avatar !== 'none') {
        return `/characters/${encodeURIComponent(char.avatar)}`;
    }
    return $('#avatar_load_preview')?.src || '';
}

function currentCharacterName() {
    const inputName = $('#character_name_pole')?.value?.trim();

    if (isCreatingCharacter()) {
        return inputName || 'New Character';
    }

    return inputName
        || getContextCharacter()?.name
        || $('#rm_button_selected_ch h2')?.textContent?.trim()
        || 'Character';
}

function ensureEditorShell(editor) {
    let shell = $('#rcp-character-shell', editor);
    if (shell) return shell;

    shell = document.createElement('section');
    shell.id = 'rcp-character-shell';
    shell.dataset.rcpPane = 'description';
    shell.innerHTML = `
        <section id="rcp-character-hero">
            <div class="rcp-hero-image"></div>
            <div class="rcp-hero-gradient"></div>
            <div class="rcp-hero-bottom">
                <button id="rcp-avatar-proxy" type="button" title="Change character avatar">
                    <img alt="Character avatar">
                </button>
            </div>
        </section>

        <div id="rcp-character-name-row">
            <span id="rcp-character-name"></span>
            <div id="rcp-name-slot" hidden></div>
        </div>

        <section id="rcp-actions-zone">
            <div id="rcp-primary-controls">
                <div id="rcp-back-slot"></div>
                <button id="rcp-actions-toggle" type="button" aria-expanded="false">
                    <span>Actions</span>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
                <button id="rcp-usage-toggle" type="button" aria-expanded="false">
                    <span>Usage</span>
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </button>
                <div id="rcp-eye-slot"></div>
            </div>
            <div id="rcp-actions-panel"></div>
            <div id="rcp-usage-panel">
                <div id="rcp-usage-token-slot"></div>
                <div id="rcp-usage-stats-slot"></div>
            </div>
        </section>

        <div class="rcp-divider" aria-hidden="true"></div>

        <nav id="rcp-section-nav" aria-label="Character editor sections">
            <button class="rcp-section-tab active" type="button" data-rcp-pane="description">Description</button>
            <button class="rcp-section-tab rcp-notes-tab" type="button" data-rcp-pane="creator-notes">Creator Notes</button>
            <button class="rcp-section-tab" type="button" data-rcp-pane="tags">Tags</button>
        </nav>

        <div class="rcp-divider rcp-divider-bottom" aria-hidden="true"></div>

        <section id="rcp-content-panes">
            <div class="rcp-content-pane active" data-rcp-pane="description"></div>
            <div class="rcp-content-pane" data-rcp-pane="creator-notes"></div>
            <div class="rcp-content-pane" data-rcp-pane="tags"></div>
        </section>
    `;
    const form = $('#form_create', editor);
    (form || editor).prepend(shell);

    $('#rcp-avatar-proxy', shell)?.addEventListener('click', () => {
        $('#add_avatar_button')?.click();
    });

    const actionsToggle = $('#rcp-actions-toggle', shell);
    const usageToggle = $('#rcp-usage-toggle', shell);

    actionsToggle?.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = !shell.classList.contains('rcp-actions-open');

        // Persistent drawer: only the Actions button toggles Actions.
        shell.classList.toggle('rcp-actions-open', opening);
        actionsToggle.setAttribute('aria-expanded', String(opening));
    });

    usageToggle?.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = !shell.classList.contains('rcp-usage-open');

        // Persistent drawer: only the Usage button toggles Usage.
        shell.classList.toggle('rcp-usage-open', opening);
        usageToggle.setAttribute('aria-expanded', String(opening));
    });


    $$('.rcp-section-tab', shell).forEach(tab => {
        tab.addEventListener('click', () => {
            // Switching to Tags should only reveal the native tags panel.
            // Do not focus the search input here: focusing it makes
            // SillyTavern immediately open its tag suggestion dropdown.
            activateEditorPane(tab.dataset.rcpPane);
        });
    });

    return shell;
}

function activateEditorPane(key) {
    const shell = $('#rcp-character-shell');
    if (!shell) return;
    shell.dataset.rcpPane = key;

    $$('#rcp-section-nav .rcp-section-tab', shell).forEach(tab => {
        tab.classList.toggle('active', tab.dataset.rcpPane === key);
    });
    $$('#rcp-content-panes .rcp-content-pane', shell).forEach(pane => {
        pane.classList.toggle('active', pane.dataset.rcpPane === key);
    });
}


function ensureAdvancedDefinitionsInline(editor, descriptionPane) {
    if (!descriptionPane) return;

    let section = $('#rcp-advanced-inline', descriptionPane);
    if (!section) {
        section = document.createElement('section');
        section.id = 'rcp-advanced-inline';
        section.dataset.rcpUserToggled = 'false';
        section.classList.add('rcp-collapsed');
        section.innerHTML = `
            <div class="rcp-advanced-header" role="button" tabindex="0"
                 title="Collapse / expand Advanced Definitions" aria-expanded="false">
                <span class="rcp-advanced-title" data-i18n="Advanced Definitions">Advanced Definitions</span>
                <span id="rcp-advanced-toggle" aria-hidden="true">
                    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                </span>
            </div>
            <div id="rcp-advanced-body"></div>
        `;
        descriptionPane.appendChild(section);

        // Advanced Definitions starts CLOSED. The whole header row toggles it.
        const header = $('.rcp-advanced-header', section);
        header?.setAttribute('aria-expanded', 'false');

        const toggleAdvanced = (event) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            section.dataset.rcpUserToggled = 'true';
            const collapsed = section.classList.toggle('rcp-collapsed');
            header?.setAttribute('aria-expanded', String(!collapsed));
        };

        header?.addEventListener('click', toggleAdvanced);
        header?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            toggleAdvanced(event);
        });

        const body = $('#rcp-advanced-body', section);

        // SillyTavern originally listens for input events bubbling through
        // #character_popup to refresh token counts. The real Advanced
        // Definition controls are moved inline, so forward that signal back
        // to the still-hidden native popup container.
        body?.addEventListener('input', () => {
            const popup = $('#character_popup');
            popup?.dispatchEvent(new Event('input', { bubbles: false }));
        });

        // Some themes/extensions interfere with the small "expand editor"
        // buttons after the Advanced Definition fields are moved out of their
        // original popup. Route those clicks through a temporary native
        // .editor_maximize proxy so SillyTavern's own document-level handler
        // opens its normal large editor popup.
        body?.addEventListener('click', (event) => {
            const maximize = event.target.closest?.('.editor_maximize');
            if (!maximize || !body.contains(maximize)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();

            const targetId = maximize.getAttribute('data-for');
            if (!targetId) return;

            const proxy = document.createElement('i');
            proxy.className = 'editor_maximize';
            proxy.setAttribute('data-for', targetId);

            const tabMode = maximize.getAttribute('data-tab');
            if (tabMode !== null) proxy.setAttribute('data-tab', tabMode);

            proxy.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;';
            document.body.appendChild(proxy);
            proxy.click();
            proxy.remove();
        }, true);
    }

    const popup = $('#character_popup');
    const body = $('#rcp-advanced-body', section);
    if (!popup || !body) return;

    // Each character starts with Advanced Definitions closed.
    // After that, preserve whatever state the user chose for the current character.
    const characterKey = isCreatingCharacter() ? 'create' : getContextCharacter()?.avatar || currentCharacterName();
    if (section.dataset.rcpCharacterKey !== String(characterKey || '')) {
        section.dataset.rcpCharacterKey = String(characterKey || '');
        section.dataset.rcpUserToggled = 'false';
        section.classList.add('rcp-collapsed');
        $('.rcp-advanced-header', section)?.setAttribute('aria-expanded', 'false');
    }

    // Keep SillyTavern's actual Advanced Definition controls and event
    // handlers. Only the old popup chrome stays behind in #character_popup.
    const movable = Array.from(popup.children).filter(child => {
        if (child.id === 'character_popup_text') return false;
        if (child.id === 'character_cross') return false;
        if (child.id === 'character_popup_ok') return false;
        if (child.tagName === 'HR' && child.classList.contains('margin-bot-10px')) return false;
        return true;
    });

    movable.forEach(node => rememberAndMove(node, body));

    // The separate book button is now redundant, but leaving the native node
    // alive (just hidden) is safer for upstream/extensions that query it.
    const advancedButton = $('#advanced_div');
    if (advancedButton) {
        advancedButton.classList.add('rcp-native-advanced-hidden');
        advancedButton.setAttribute('aria-hidden', 'true');
        advancedButton.setAttribute('tabindex', '-1');
    }
}

function isNativeCharacterVisualVisible() {
    const originalHeader = $('#avatar-and-name-block');
    if (!originalHeader) return true;
    return getComputedStyle(originalHeader).display !== 'none';
}

function syncExternalFormAssociation(container, form, enabled) {
    if (!container || !form?.id) return;

    // The custom fixed name row lives outside #form_create. Native HTML form
    // controls stop belonging to a form when they are moved outside it unless
    // they explicitly reference that form by id. Preserve each control's
    // original `form` attribute and temporarily associate it with #form_create
    // while the native name row is mounted in our external header.
    $$('input, select, textarea, button', container).forEach(control => {
        if (enabled) {
            if (control.dataset.rcpOriginalFormCaptured !== 'true') {
                control.dataset.rcpOriginalFormCaptured = 'true';
                control.dataset.rcpOriginalForm = control.getAttribute('form') ?? '';
            }
            setAttribute(control, 'form', form.id);
            return;
        }

        if (control.dataset.rcpOriginalFormCaptured === 'true') {
            const original = control.dataset.rcpOriginalForm || '';
            if (original) control.setAttribute('form', original);
            else control.removeAttribute('form');
            delete control.dataset.rcpOriginalForm;
            delete control.dataset.rcpOriginalFormCaptured;
        }
    });
}

function syncCharacterNameControl(editor = $('#rm_ch_create_block'), shell = $('#rcp-character-shell')) {
    if (!editor || !shell) return;

    const creating = isCreatingCharacter();
    const nameDiv = $('#name_div');

    // The whole name row is intentionally moved out of #rcp-character-shell
    // and mounted directly under the hero banner so it does not scroll with
    // the editor body. Do NOT scope these lookups to `shell`: after that move
    // they are no longer descendants of the shell. v0.5.12 did exactly that,
    // so create mode was detected correctly but the real native name input
    // could never be moved into the visible row.
    const nameSlot = $('#rcp-name-slot');
    const displayName = $('#rcp-character-name');

    // During initial card creation the native #character_name_pole is not just
    // decorative: SillyTavern requires it before the card can be submitted.
    // Keep the REAL native input and its listeners, but surface it inside our
    // custom fixed name row instead of leaving it trapped inside the visually
    // hidden native avatar/name shell.
    const form = $('#form_create');
    if (creating && nameDiv && nameSlot) {
        rememberAndMove(nameDiv, nameSlot);
        syncExternalFormAssociation(nameDiv, form, true);
    } else if (!creating && nameDiv) {
        syncExternalFormAssociation(nameDiv, form, false);
        if (moved.has(nameDiv)) restoreNode(nameDiv);
    }

    if (nameSlot) {
        setHidden(nameSlot, !creating);
        setAttribute(nameSlot, 'aria-hidden', String(!creating));
    }

    if (displayName) {
        setHidden(displayName, creating);
        setAttribute(displayName, 'aria-hidden', String(creating));
    }
}

function syncEditorChrome(editor = $('#rm_ch_create_block'), shell = $('#rcp-character-shell')) {
    const active = isCharacterEditorVisible(editor);
    toggleClass(document.body, 'rcp-character-editor-active', active);

    syncCharacterNameControl(editor, shell);

    // The display-only name row lives outside the scrolling editor body so it
    // stays attached to the banner while Description / First Message / etc.
    // scroll underneath it.
    const nameRow = $('#rcp-character-name-row');
    const name = $('#rcp-character-name');
    setText(name, currentCharacterName());
    if (nameRow) {
        setHidden(nameRow, !active);
        setAttribute(nameRow, 'aria-hidden', String(!active));
    }

    const hero = $('#rcp-character-hero');
    if (hero) {
        const visible = active && isNativeCharacterVisualVisible();
        setHidden(hero, !visible);
        setAttribute(hero, 'aria-hidden', String(!visible));
    }
}

function mountHeroAtPanelTop(editor, shell) {
    const hero = $('#rcp-character-hero');
    const nameRow = $('#rcp-character-name-row');
    const panel = $('#right-nav-panel');
    const nativeTop = $('#CharListButtonAndHotSwaps', panel);

    if (!hero || !nameRow || !panel || !nativeTop) return;

    // Banner + display name form the non-scrolling visual header.
    // The actual editor shell remains in #rm_ch_create_block and is free to
    // scroll independently below them.
    if (hero.parentNode !== panel || hero.nextElementSibling !== nameRow) {
        panel.insertBefore(hero, nativeTop);
        panel.insertBefore(nameRow, nativeTop);
    } else if (nameRow.nextElementSibling !== nativeTop) {
        panel.insertBefore(nameRow, nativeTop);
    }

    // Visibility and form association are synchronized once by syncEditorChrome.
}

function syncCreateButtonVisibility() {
    const creating = isCreatingCharacter();
    const label = $('#create_button_label');

    // In SillyTavern this submit control finalizes a brand-new character.
    // Existing characters auto-save through the editor, so showing the same
    // button there is misleading (and was exposed by our moved Actions row).
    if (label) {
        label.classList.toggle('rcp-create-submit-hidden', !creating);
        setAttribute(label, 'aria-hidden', String(!creating));
        label.toggleAttribute('inert', !creating);
    }

    // A few native edit-only actions have no useful target until the new card
    // has actually been created. Keep the real SillyTavern nodes alive, but
    // suppress them only while actiontype=createcharacter. They automatically
    // return as soon as ST switches the form back to edit mode.
    toggleClass(document.body, 'rcp-creating-character', creating);
}

function mountExactEditorControls(editor) {
    const shell = $('#rcp-character-shell', editor);
    if (!shell) return;

    // Move the native "back to full character manager" arrow beside our
    // Actions button. It remains the real ST control and keeps its behavior.
    const backButton = $('#rm_button_back');
    if (backButton) rememberAndMove(backButton, $('#rcp-back-slot', shell));

    // Hide the redundant native Character Manager button that normally sits
    // beside the panel lock. We keep the node alive for upstream compatibility.
    const managerButton = $('#rm_button_characters');
    if (managerButton) {
        managerButton.classList.add('rcp-native-manager-hidden');
        managerButton.setAttribute('aria-hidden', 'true');
        managerButton.setAttribute('tabindex', '-1');
    }

    // Every remaining native global character action goes under one centered
    // Actions button. "More..." stays native and gets its own row via CSS.
    const avatarControls = $('#avatar_controls');
    if (avatarControls) rememberAndMove(avatarControls, $('#rcp-actions-panel', shell));
    syncCreateButtonVisibility();

    // Usage owns ST's live token counter and the real stats control.
    const resultText = $('#result_info_text');
    if (resultText) rememberAndMove(resultText, $('#rcp-usage-token-slot', shell));

    // Keep ST's token-limit warning functional alongside the Usage counter.
    const tokenWarning = $('#chartokenwarning');
    if (tokenWarning) rememberAndMove(tokenWarning, $('#rcp-usage-token-slot', shell));

    const statsButton = $('.rm_stats_button');
    if (statsButton) {
        rememberAndMove(statsButton, $('#rcp-usage-stats-slot', shell));
        statsButton.classList.remove('fa-solid', 'fa-ranking-star');
        statsButton.classList.add('rcp-show-stats');
        statsButton.removeAttribute('data-i18n');
        statsButton.title = 'Show Stats';
        setText(statsButton, 'Show Stats');
    }

    // Move the REAL native eye button to the right of Back / Actions / Usage.
    // SillyTavern's own click handler still toggles #avatar-and-name-block.
    // We mirror that state to our banner/avatar so the native behavior remains
    // meaningful after the visual header was moved.
    const eyeButton = $('#hideCharPanelAvatarButton');
    if (eyeButton) {
        rememberAndMove(eyeButton, $('#rcp-eye-slot', shell));

        if (!eyeButton.dataset.rcpHeroMirrorBound) {
            eyeButton.dataset.rcpHeroMirrorBound = 'true';
            eyeButton.addEventListener('click', () => {
                scheduleEditorChrome();
            });
        }
    }

    // Description pane intentionally contains BOTH Description and First Message.
    const descriptionPane = $('.rcp-content-pane[data-rcp-pane="description"]', shell);
    const description = $('#descriptionWrapper');
    const firstMessage = $('#firstMessageWrapper');
    if (description) rememberAndMove(description, descriptionPane);
    if (firstMessage) rememberAndMove(firstMessage, descriptionPane);

    // Move the two field-level utility buttons out of their headers and into
    // one small row directly under First Message. These are still the real
    // SillyTavern controls, so their native behavior is preserved.
    let fieldActions = $('#rcp-field-actions', descriptionPane);
    if (!fieldActions) {
        fieldActions = document.createElement('div');
        fieldActions.id = 'rcp-field-actions';
        if (firstMessage?.nextSibling) {
            descriptionPane.insertBefore(fieldActions, firstMessage.nextSibling);
        } else {
            descriptionPane.appendChild(fieldActions);
        }
    }

    const extMedia = $('#character_open_media_overrides');
    if (extMedia) {
        extMedia.classList.add('rcp-field-action');
        rememberAndMove(extMedia, fieldActions);
    }

    const altGreetings = $('.open_alternate_greetings');
    if (altGreetings) {
        altGreetings.classList.add('rcp-field-action');
        rememberAndMove(altGreetings, fieldActions);
    }

    // Advanced Definitions now lives at the bottom of the Description pane.
    ensureAdvancedDefinitionsInline(editor, descriptionPane);

    // Tags and Creator's Notes each get their own navigation button/pane.
    const tags = $('#tags_div');
    if (tags) rememberAndMove(tags, $('.rcp-content-pane[data-rcp-pane="tags"]', shell));

    const creatorNotes = $('#spoiler_free_desc');
    if (creatorNotes) rememberAndMove(creatorNotes, $('.rcp-content-pane[data-rcp-pane="creator-notes"]', shell));
}

function syncEditorHero() {
    const hero = $('#rcp-character-hero');
    if (!hero) return;

    const image = fullCharacterImage();
    const heroImg = $('#rcp-avatar-proxy img', hero);
    if (heroImg && image) {
        const resolved = new URL(image, location.href).href;
        if (heroImg.getAttribute('src') !== image && heroImg.src !== resolved) heroImg.src = image;
    }
    const background = image ? `url("${image.replace(/"/g, '\\"')}")` : 'none';
    if (hero.style.getPropertyValue('--rcp-hero-image') !== background) {
        hero.style.setProperty('--rcp-hero-image', background);
    }
}

function ensureCharacterEditorShell() {
    const editor = $('#rm_ch_create_block');
    if (!editor) return;

    toggleClass(editor, 'rcp-editor-mode', true);
    const shell = ensureEditorShell(editor);
    mountExactEditorControls(editor);
    mountHeroAtPanelTop(editor, shell);
    syncEditorHero();
    syncEditorChrome(editor, shell);

    const originalShell = $('#avatar-and-name-block');
    if (originalShell) toggleClass(originalShell, 'rcp-original-header-shell', true);
}

function refreshVisiblePanels() {
    const listBlock = $('#rm_characters_block');
    const editor = $('#rm_ch_create_block');

    // Only touch the panel that is actually visible. The old implementation
    // rebuilt BOTH shells after virtually every mutation anywhere in <body>.
    // That was the main source of UI hitching during scrolling/animations.
    if (listBlock) {
        const listVisible = isCharacterListVisible(listBlock);
        if (listVisible) ensureCharacterListShell();
        else syncCharacterListChrome(listBlock);
    }

    if (editor) {
        if (isCharacterEditorVisible(editor)) {
            ensureCharacterEditorShell();
        } else {
            syncEditorChrome(editor, $('#rcp-character-shell'));
        }
    }
}

function observeState(key, node, attributes, callback) {
    observers.observe(key, node, { attributes: true, attributeFilter: attributes }, callback);
}

function observeDisplay(key, node) {
    // jQuery fades/slides mutate opacity and dimensions every animation tick.
    // Only a display change switches which panel/header needs updating.
    let display = node?.style.display;
    observeState(key, node, ['style'], () => {
        const next = node.style.display;
        if (next === display) return;
        display = next;
        scheduleRefresh();
    });
}

function bindSillyTavernEvents() {
    subscriptions.push(onSillyTavernEvents(['CHARACTER_PAGE_LOADED', 'CHARACTER_EDITOR_OPENED'], scheduleRefresh));
    subscriptions.push(onSillyTavernEvents(['CHAT_CHANGED', 'CHARACTER_EDITED', 'CHARACTER_RENAMED'], scheduleEditorChrome));
}

function setupTargetedObservers() {
    const list = $('#rm_print_characters_block');
    observers.observe('character-list', list, { childList: true }, mutations => {
        for (const mutation of mutations) {
            decorateCharacterCards([...mutation.addedNodes].filter(node => node.parentNode === list));
        }
    });
    observeDisplay('list-display', $('#rm_characters_block'));
    observeDisplay('editor-display', $('#rm_ch_create_block'));
    observeDisplay('avatar-display', $('#avatar-and-name-block'));
    observeState('avatar-preview', $('#avatar_load_preview'), ['src'], scheduleEditorChrome);
    observeState('create-mode', $('#form_create'), ['actiontype'], scheduleRefresh);
}

function onNameInput(event) {
    if (event.target?.matches?.('#character_name_pole')) scheduleEditorChrome();
}

export function refresh() {
    setupTargetedObservers();
    decorateCharacterCards($('#rm_print_characters_block')?.children || []);
    refreshVisiblePanels();
}

export function init() {
    document.body.classList.add('rivelle-character-panels');
    ensureCharacterListShell();
    ensureCharacterEditorShell();
    bindSillyTavernEvents();
    setupTargetedObservers();
    decorateCharacterCards($('#rm_print_characters_block')?.children || []);
    document.addEventListener('input', onNameInput);
}

export function cleanup() {
    observers.disconnect();
    subscriptions.forEach(unsubscribe => unsubscribe());
    scheduleRefresh.cancel();
    scheduleEditorChrome.cancel();
    document.removeEventListener('input', onNameInput);
    document.body.classList.remove('rivelle-character-panels', 'rcp-character-editor-active', 'rcp-character-list-active', 'rcp-creating-character');
    [...moved.keys()].forEach(restoreNode);
    $('#rcp-list-toolbar')?.remove();
    $('#rcp-list-utility-tray')?.remove();
    $('#rcp-character-hero')?.remove();
    $('#rcp-character-name-row')?.remove();
    $('#rcp-character-shell')?.remove();
}

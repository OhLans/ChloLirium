import { getContext as context, createFrameTask, createObserverRegistry, onSillyTavernEvents, setText, setAttribute, setHidden, toggleClass } from '../../core/runtime.js';

const DESKTOP_MIN = 1050;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const AI_CONFIG = {
    key: 'aiconfig',
    title: 'AI Response Configuration',
    click: '#ai-config-button > .drawer-toggle',
    icon: '#leftNavDrawerIcon',
    panel: '#left-nav-panel',
};

const LEFT_NAV = [
    {
        key: 'presets',
        title: 'Preset Library',
        click: '#chlo-preset-library-button',
        icon: '#chlo-preset-library-button > i',
        panel: '#chlo-preset-workspace',
        optional: true,
    },
    {
        key: 'api',
        title: 'API Connections',
        click: '#sys-settings-button > .drawer-toggle',
        icon: '#API-status-top',
        panel: '#rm_api_block',
    },
    {
        key: 'formatting',
        title: 'AI Response Formatting',
        click: '#advanced-formatting-button > .drawer-toggle',
        icon: '#advanced-formatting-button > .drawer-toggle .drawer-icon',
        panel: '#AdvancedFormatting',
    },
    {
        key: 'worldinfo',
        title: 'World Info',
        click: '#WI-SP-button > .drawer-toggle',
        icon: '#WIDrawerIcon',
        panel: '#WorldInfo',
    },
    {
        key: 'usersettings',
        title: 'User Settings',
        click: '#user-settings-button > .drawer-toggle',
        icon: '#user-settings-button > .drawer-toggle .drawer-icon',
        panel: '#user-settings-block',
    },
    {
        key: 'backgrounds',
        title: 'Backgrounds',
        click: '#backgrounds-drawer-toggle',
        icon: '#backgrounds-drawer-toggle .drawer-icon',
        panel: '#Backgrounds',
    },
    {
        key: 'extensions',
        title: 'Extensions',
        click: '#extensions-settings-button > .drawer-toggle',
        icon: '#extensions-settings-button > .drawer-toggle .drawer-icon',
        panel: '#extensions_settings',
    },
    {
        key: 'quickreplies',
        title: 'Quick Replies',
        click: '#stqrd--qrDrawer > .drawer-toggle',
        icon: '#stqrd--qrDrawer > .drawer-toggle .drawer-icon',
        panel: '#stqrd--drawer-v2',
        optional: true,
    },
];

const LEFT_MANAGER_DUPLICATES = [
    {
        key: 'characters',
        title: 'Character Management',
        nativeToggle: '#rightNavHolder > .drawer-toggle',
        fallbackIcon: 'fa-address-card',
    },
    {
        key: 'personas',
        title: 'Persona Management',
        nativeToggle: '#persona-management-button > .drawer-toggle',
        fallbackIcon: 'fa-face-smile',
    },
];

const ALL_ITEMS = [AI_CONFIG, ...LEFT_NAV];

const observers = createObserverRegistry();
const subscriptions = [];
const iconTasks = new Map(ALL_ITEMS.map(item => [item.key, createFrameTask(() => mirrorOneIcon(item))]));
const scheduleManagerSync = createFrameTask(syncManagerDuplicates);
const scheduleIdentitySync = createFrameTask(renderIdentity);
const scheduleHotSwapSync = createFrameTask(syncHotSwapRail);
const scheduleResize = createFrameTask(applyDesktopState);
let lastNoHotSwap = null;
let identitySignature = '';

function activeCharacter() {
    const ctx = context();
    if (!ctx || ctx.characterId === undefined || ctx.characterId === null) return null;
    return ctx.characters?.[ctx.characterId] ?? null;
}

function avatarUrl(avatar) {
    return avatar ? `/characters/${encodeURIComponent(avatar)}` : '';
}

function nativeClick(selector) {
    const element = $(selector);
    if (!element) {
        console.warn('[Rivelle Navigator] Native control not found:', selector);
        return;
    }
    element.click();
}

function makeButton(item, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.rnKey = item.key;
    button.title = item.title;
    button.innerHTML = '<span class="rn-icon-host" aria-hidden="true"></span>';
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        nativeClick(item.click);
    });
    return button;
}

function stopNativeOutsideClick(event) {
    // Prevent SillyTavern's global outside-click handler from closing a drawer
    // before our second click reaches its native toggle.
    event.stopPropagation();
}


let worldInfoInfoMount = null;

function mountWorldInfoInfoTrigger() {
    const host = $('#rn-top-worldinfo');
    if (!host) return;

    const trigger = $('.stwii--trigger');
    if (!trigger) return;

    if (trigger.parentNode === host) return;

    // If WorldInfo Info recreated its trigger, discard the stale mount record.
    if (worldInfoInfoMount?.trigger && worldInfoInfoMount.trigger !== trigger) {
        worldInfoInfoMount.placeholder?.remove();
        worldInfoInfoMount = null;
    }

    if (!worldInfoInfoMount) {
        const placeholder = document.createComment('rn-worldinfo-info-placeholder');
        trigger.parentNode?.insertBefore(placeholder, trigger);
        worldInfoInfoMount = { trigger, placeholder };
    }

    host.appendChild(trigger);
    trigger.dataset.rnMounted = 'worldinfo-info';
}

function restoreWorldInfoInfoTrigger() {
    const record = worldInfoInfoMount;
    if (!record?.trigger || !record?.placeholder?.parentNode) return;

    if (record.placeholder.nextSibling !== record.trigger) {
        record.placeholder.parentNode.insertBefore(record.trigger, record.placeholder.nextSibling);
    }
    delete record.trigger.dataset.rnMounted;
}

function syncWorldInfoInfoIntegration() {
    const enabled = document.body.classList.contains('rivelle-navigator-enabled');

    if (enabled) {
        mountWorldInfoInfoTrigger();
    } else {
        restoreWorldInfoInfoTrigger();
    }
}


function makeManagerDuplicate(item) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rn-manager-duplicate';
    button.dataset.rnManagerDuplicate = item.key;
    button.title = item.title;
    button.innerHTML = `
        <span class="rn-manager-fallback">
            <i class="fa-solid ${item.fallbackIcon}"></i>
        </span>
    `;

    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        const nativeToggle = $(item.nativeToggle);
        nativeToggle?.click();
    });

    return button;
}

function buildManagerDuplicates() {
    const host = $('#rn-manager-duplicate-buttons');
    if (!host || host.children.length) return;

    LEFT_MANAGER_DUPLICATES.forEach(item => {
        host.appendChild(makeManagerDuplicate(item));
    });
}

function syncManagerDuplicate(item) {
    const source = $(item.nativeToggle);
    const target = $(`[data-rn-manager-duplicate="${item.key}"]`);
    if (!source || !target) return;

    const avatar = source.classList.contains('stcs--char')
        ? getComputedStyle(source).getPropertyValue('--stcs--avatar').trim()
        : '';

    const hasPortrait = Boolean(source.classList.contains('stcs--char') && avatar && avatar !== 'none');

    toggleClass(target, 'stcs--char', hasPortrait);

    if (hasPortrait) {
        if (target.style.getPropertyValue('--rn-manager-avatar') !== avatar) {
            target.style.setProperty('--rn-manager-avatar', avatar);
        }
    } else if (target.style.getPropertyValue('--rn-manager-avatar')) {
        target.style.removeProperty('--rn-manager-avatar');
    }

    // Keep the duplicate's active/open state in sync with the real toggle.
    const nativeIcon = source.querySelector('.drawer-icon');
    const isOpen = Boolean(
        nativeIcon?.classList.contains('openIcon') ||
        nativeIcon?.classList.contains('drawerPinnedOpen'),
    );
    toggleClass(target, 'active', isOpen);
}

function syncManagerDuplicates() {
    LEFT_MANAGER_DUPLICATES.forEach(syncManagerDuplicate);
}


/*
 * Native Characters Hotswap mirror
 * --------------------------------
 * SillyTavern must keep its real .hotswap inside #right-nav-panel because
 * favsToHotswap() explicitly renders into that DOM location. Moving the native
 * element would break future refreshes.
 *
 * Instead, Rivelle Navigator mirrors the native hotswap visuals into the left
 * rail and proxies clicks back to the CURRENT native item. This preserves:
 * - SillyTavern's own character/group selection behavior
 * - Favorites-driven membership
 * - The User Settings "Characters Hotswap" enable/disable toggle
 * - Future native re-renders of the hotswap list
 */
let hotSwapSignature = '';

function nativeHotSwapItems() {
    return $$('#right-nav-panel .hotswap > .avatar');
}

function hotSwapItemKey(item, index = 0) {
    const type = item.dataset.type || '';
    const chid = item.dataset.chid || '';
    const grid = item.dataset.grid || '';
    const pid = item.dataset.pid || '';
    const title = item.getAttribute('title') || '';
    return `${type}|${chid}|${grid}|${pid}|${title}|${index}`;
}

function hotSwapItemSignature(item, index) {
    const images = [...item.querySelectorAll('img')]
        .map(img => img.getAttribute('src') || '')
        .join(',');
    return `${hotSwapItemKey(item, index)}|${images}`;
}

function findCurrentNativeHotSwapItem(key) {
    return nativeHotSwapItems().find((item, index) => hotSwapItemKey(item, index) === key) || null;
}

function makeHotSwapRailItem(source, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rn-hotswap-item';
    button.dataset.rnHotswapKey = hotSwapItemKey(source, index);
    button.title = source.getAttribute('title') || source.querySelector('img')?.alt || 'Favorite character';
    button.setAttribute('aria-label', source.querySelector('img')?.alt || button.title || 'Favorite character');

    const images = [...source.querySelectorAll('img')];
    const isGroup = !!source.dataset.grid || source.classList.contains('avatar_collage') || images.length > 1;

    if (!isGroup && images[0]?.src) {
        // Keep the native Hotswap item as the behavior/data source, but render
        // a clean portrait ourselves. This avoids inherited native avatar
        // borders/shadows and keeps the portrait perfectly circular at zoom.
        button.classList.add('rn-hotswap-character');
        button.style.setProperty(
            '--rn-hotswap-avatar',
            `url("${images[0].src.replace(/"/g, '\\"')}")`,
        );
    } else {
        // Groups can use composite/collage avatars, so retain their native
        // visual composition while stripping interactive/native chrome.
        const visual = source.cloneNode(true);
        visual.classList.remove('interactable', 'character_select', 'group_select');
        visual.classList.add('rn-hotswap-group-visual');
        visual.removeAttribute('id');
        visual.removeAttribute('data-chid');
        visual.removeAttribute('data-grid');
        visual.removeAttribute('data-pid');
        visual.removeAttribute('data-type');
        visual.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        visual.querySelectorAll('input, button, select, textarea').forEach(node => node.remove());
        visual.setAttribute('aria-hidden', 'true');
        button.appendChild(visual);
    }

    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        // Resolve the CURRENT native item at click time because SillyTavern can
        // rebuild its Hotswap list after favorites/groups change.
        findCurrentNativeHotSwapItem(button.dataset.rnHotswapKey)?.click();
    });

    return button;
}

function syncHotSwapRail() {
    const rail = $('#rn-left-rail');
    const divider = $('#rn-hotswap-divider');
    const section = $('#rn-hotswap-section');
    const list = $('#rn-hotswap-list');
    if (!rail || !section || !list) return;

    // SillyTavern's own setting is represented by body.no-hotswap.
    // Respect it exactly rather than maintaining a second preference.
    const settingDisabled = document.body.classList.contains('no-hotswap');
    const items = settingDisabled ? [] : nativeHotSwapItems();
    const active = !settingDisabled && items.length > 0;

    if (divider) {
        setHidden(divider, !active);
        setAttribute(divider, 'aria-hidden', String(!active));
    }
    setHidden(section, !active);
    setAttribute(section, 'aria-hidden', String(!active));
    toggleClass(rail, 'rn-hotswap-active', active);

    if (!active) {
        if (list.childElementCount) list.replaceChildren();
        hotSwapSignature = '';
        return;
    }

    const signature = items.map(hotSwapItemSignature).join('||');

    if (signature !== hotSwapSignature) {
        hotSwapSignature = signature;
        const scrollTop = section.scrollTop;
        list.replaceChildren(...items.map(makeHotSwapRailItem));
        section.scrollTop = scrollTop;
    }

    // Soft active-state hint for the currently selected character. This does
    // not alter native behavior; it only mirrors current selection visually.
    const ctx = context();
    const activeCharacterId = ctx?.characterId;
    $$('.rn-hotswap-item', list).forEach((button, index) => {
        const source = items[index];
        const sourceChid = source?.dataset?.chid;
        toggleClass(button,
            'active',
            sourceChid !== undefined &&
            sourceChid !== '' &&
            String(sourceChid) === String(activeCharacterId),
        );
    });
}

function build() {
    if ($('#rn-shell')) return;

    const shell = document.createElement('div');
    shell.id = 'rn-shell';

    const rail = document.createElement('nav');
    rail.id = 'rn-left-rail';
    rail.setAttribute('aria-label', 'SillyTavern navigator');

    rail.innerHTML = `
        <div id="rn-primary-action"></div>
        <div class="rn-divider"></div>
        <div id="rn-left-actions"></div>

        <div id="rn-manager-duplicates">
            <div class="rn-manager-divider" aria-hidden="true"></div>
            <div id="rn-manager-duplicate-buttons"></div>
        </div>

        <div id="rn-hotswap-divider" class="rn-manager-divider rn-hotswap-divider" hidden aria-hidden="true"></div>
        <div id="rn-hotswap-section" hidden aria-label="Favorite character hot swaps">
            <div id="rn-hotswap-list"></div>
        </div>

        <div class="rn-spacer"></div>
        <button id="rn-collapse" class="rn-nav-button rn-collapse-button" title="Hide navigator">
            <i class="fa-solid fa-angles-left"></i>
        </button>
    `;

    // AI Response Configuration occupies the old "brain" position.
    $('#rn-primary-action', rail).appendChild(makeButton(AI_CONFIG, 'rn-nav-button rn-primary-button'));

    const leftActions = $('#rn-left-actions', rail);
    LEFT_NAV.forEach(item => leftActions.appendChild(makeButton(item, 'rn-nav-button')));

    const top = document.createElement('header');
    top.id = 'rn-top-bar';
    top.innerHTML = `
        <div id="rn-top-worldinfo" aria-label="Active World Info"></div>

        <div id="rn-chat-identity">
            <div id="rn-chat-avatar"></div>
            <div id="rn-chat-name">No character selected</div>
            <div id="rn-chat-subtitle"></div>
        </div>

        <div id="rn-top-actions"></div>
    `;

    // Character Management and Persona Management use their actual native
    // drawer containers here, not mirrored buttons. This preserves companion
    // extensions such as Char Switch / Persona Switch verbatim.

    const reopen = document.createElement('button');
    reopen.id = 'rn-reopen';
    reopen.title = 'Show navigator';
    reopen.innerHTML = '<i class="fa-solid fa-angle-right"></i>';

    shell.append(rail, top, reopen);
    document.body.appendChild(shell);

    buildManagerDuplicates();
    syncManagerDuplicates();
    syncHotSwapRail();

    for (const eventName of ['mousedown', 'touchstart', 'pointerdown']) {
        rail.addEventListener(eventName, stopNativeOutsideClick);
        top.addEventListener(eventName, stopNativeOutsideClick);
        reopen.addEventListener(eventName, stopNativeOutsideClick);
    }

    $('#rn-collapse')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.body.classList.add('rn-collapsed');
    });

    $('#rn-reopen')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.body.classList.remove('rn-collapsed');
    });

    window.addEventListener('resize', scheduleResize, { passive: true });
    applyDesktopState();
}

function applyDesktopState() {
    const enabled = window.innerWidth >= DESKTOP_MIN;
    toggleClass(document.body, 'rivelle-navigator-enabled', enabled);
    syncWorldInfoInfoIntegration();
}

function renderIdentity() {
    const character = activeCharacter();
    const avatar = $('#rn-chat-avatar');
    const name = $('#rn-chat-name');
    const subtitle = $('#rn-chat-subtitle');
    if (!avatar || !name || !subtitle) return;

    const ctx = context();
    const chatName = ctx?.chatId || character?.chat || '';
    const signature = JSON.stringify([character?.avatar, character?.name, chatName]);
    if (signature === identitySignature) return;
    identitySignature = signature;

    const visual = document.createElement(character?.avatar ? 'img' : character ? 'span' : 'i');
    if (character?.avatar) {
        visual.src = avatarUrl(character.avatar);
        visual.alt = '';
    } else if (character) {
        visual.textContent = (character.name || '?').slice(0, 1);
    } else {
        visual.className = 'fa-regular fa-circle-user';
    }
    avatar.replaceChildren(visual);
    setText(name, character ? character.name || 'Character' : 'No character selected');
    setText(subtitle, character && chatName && chatName !== character.name ? String(chatName) : '');
}


function decodeCssContent(content) {
    if (!content || content === 'none' || content === 'normal') return '';
    let value = content.trim();

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
    }

    value = value.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ''; }
    });

    return value
        .replace(/\\"/g, '"')
        .replace(/\\'/g, '\'')
        .replace(/\\\\/g, '\\');
}

function mirrorOneIcon(item) {
    const source = $(item.icon);
    const host = $(`[data-rn-key="${item.key}"] .rn-icon-host`);
    if (!source || !host) return;

    let visual = $('.rn-native-visual', host);
    if (!visual) {
        visual = document.createElement('span');
        visual.className = 'rn-native-visual';
        host.replaceChildren(visual);
    }

    // Keep native icon classes so Navigator has a faithful fallback when no
    // separate icon pack is installed.
    const nativeClasses = [...source.classList]
        .filter(cls => !['openIcon', 'closedIcon', 'drawerPinnedOpen'].includes(cls));
    const className = ['rn-native-visual', ...nativeClasses].join(' ');
    if (visual.className !== className) visual.className = className;

    // The bundled SVG masks replace this glyph. Skip its style/layout read
    // when Icons is enabled; retain the native fallback for Navigator alone.
    if (!document.body.classList.contains('rivelle-navigator-icons-enabled')) {
        const content = decodeCssContent(getComputedStyle(source, '::before').content);
        setAttribute(visual, 'data-rn-content', content);
    }
}

function mirrorIcons() {
    ALL_ITEMS.forEach(mirrorOneIcon);
}

function syncOptionalIntegrations() {
    for (const item of LEFT_NAV) {
        if (!item.optional) continue;

        const button = $(`[data-rn-key="${item.key}"]`);
        if (!button) continue;

        const available = Boolean($(item.click) && $(item.icon) && $(item.panel));
        toggleClass(button, 'rn-integration-missing', !available);
        button.setAttribute('aria-hidden', available ? 'false' : 'true');
        button.tabIndex = available ? 0 : -1;
    }
}

function panelIsOpen(item) {
    const panel = $(item.panel);
    if (!panel) return false;

    // Pinning prevents outside-click dismissal; it survives manually closing
    // the drawer, so it must not be treated as an open state.
    return panel.classList.contains('openDrawer') || panel.classList.contains('open');
}

function syncActiveStates() {
    ALL_ITEMS.forEach(syncOneActiveState);
}


function syncOneActiveState(item) {
    const open = panelIsOpen(item);
    const button = $(`[data-rn-key="${item.key}"]`);
    if (button) toggleClass(button, 'active', open);
    if (item === AI_CONFIG) {
        // Reuse the native panel observer: no click-derived state, DOM moves,
        // layout reads, or extra observers are needed for the header shift.
        toggleClass(document.body, 'rn-ai-config-open', open);
    }
}

function setupNativeObservers() {
    // Character/persona portrait duplicates only need to react when their
    // actual native toggles change. No reason to poll them twice per second.
    for (const item of LEFT_MANAGER_DUPLICATES) {
        const source = $(item.nativeToggle);
        observers.observe(`manager:${item.key}`, source, {
            attributes: true,
            subtree: true,
            attributeFilter: ['class', 'style'],
        }, scheduleManagerSync);
    }

    // Hotswap membership/images change only inside the native hotswap list.
    const hotswap = $('#right-nav-panel .hotswap');
    observers.observe('hotswap', hotswap, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'title', 'class'],
    }, scheduleHotSwapSync);

    // Active drawer states are class changes on a small fixed set of panels.
    for (const item of ALL_ITEMS) {
        const panel = $(item.panel);
        observers.observe(`panel:${item.key}`, panel, {
            attributes: true,
            attributeFilter: ['class'],
        }, () => syncOneActiveState(item));

        const icon = $(item.icon);
        observers.observe(`icon:${item.key}`, icon, {
            attributes: true,
            attributeFilter: ['class'],
        }, iconTasks.get(item.key));
    }

    // The native Characters Hotswap setting is expressed as body.no-hotswap.
    if (lastNoHotSwap === null) lastNoHotSwap = document.body.classList.contains('no-hotswap');
    observers.observe('hotswap-setting', document.body, {
        attributes: true,
        attributeFilter: ['class'],
    }, () => {
        const next = document.body.classList.contains('no-hotswap');
        if (next !== lastNoHotSwap) {
            lastNoHotSwap = next;
            scheduleHotSwapSync();
        }
    });
}

function bindSillyTavernEvents() {
    subscriptions.push(onSillyTavernEvents([
        'CHAT_CHANGED', 'CHARACTER_EDITED', 'CHARACTER_RENAMED',
        'CHARACTER_DELETED', 'CHARACTER_DUPLICATED', 'CHARACTER_PAGE_LOADED',
        'GROUP_UPDATED',
    ], () => {
        scheduleIdentitySync();
        scheduleHotSwapSync();
    }));
    subscriptions.push(onSillyTavernEvents(['CHAT_CHANGED', 'PERSONA_CHANGED'], scheduleManagerSync));
    subscriptions.push(onSillyTavernEvents(['SETTINGS_UPDATED'], () => {
        syncOptionalIntegrations();
        scheduleHotSwapSync();
    }));
}

export function refresh() {
    setupNativeObservers();
    protectNativeTopToggles();
    syncOptionalIntegrations();
    syncWorldInfoInfoIntegration();
    syncManagerDuplicates();
    syncHotSwapRail();
    mirrorIcons();
    syncActiveStates();
}

export function cleanup() {
    observers.disconnect();
    subscriptions.forEach(unsubscribe => unsubscribe());
    scheduleIdentitySync.cancel();
    scheduleHotSwapSync.cancel();
    scheduleResize.cancel();
    iconTasks.forEach(task => task.cancel());
    scheduleManagerSync.cancel();
    window.removeEventListener('resize', scheduleResize);
}

function protectNativeTopToggles() {
    const selectors = [
        '#rightNavHolder > .drawer-toggle',
        '#persona-management-button > .drawer-toggle',
    ];

    for (const selector of selectors) {
        const toggle = $(selector);
        if (!toggle || toggle.dataset.rnPointerGuard === '1') continue;

        toggle.dataset.rnPointerGuard = '1';

        /*
         * SillyTavern has a page-wide mousedown/touchstart handler that closes
         * open drawers before the toggle's click fires. With portrait switch
         * extensions the click target is the .drawer-toggle itself, not the
         * nested .drawer-icon, so ST mistakes it for an outside click:
         *
         *   mousedown -> closes drawer
         *   click     -> native toggle opens drawer again
         *
         * Stop only the pre-click pointer event here. The actual click is left
         * untouched, so SillyTavern's own doNavbarIconClick still opens/closes
         * the drawer normally.
         */
        for (const eventName of ['mousedown', 'touchstart']) {
            toggle.addEventListener(eventName, event => {
                event.stopPropagation();
            });
        }
    }
}

export function init() {
    build();
    bindSillyTavernEvents();
    renderIdentity();
    refresh();
}

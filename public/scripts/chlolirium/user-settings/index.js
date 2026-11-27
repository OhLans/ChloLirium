import { eventSource, event_types } from '../../../script.js';
import { power_user } from '../../power-user.js';
import { appearancePages, populateAppearance } from './appearance.js';
import { button, element, icon } from './components.js';
import { initCssSnippets } from './snippets.js';
import { themeDisplayName } from './theme-data.js';

const byId = id => document.getElementById(id);

const categories = [
    ['interface', 'Interface', 'Theme, avatars, layout, CSS', 'desktop'],
    ['chat', 'Chat & Messages', 'Sending, editing, streaming', 'comment'],
    ['general', 'General', 'Language, account, imports', 'user'],
    ['advanced', 'Advanced', 'Macros, scripts, diagnostics', 'code'],
];

function section(title) {
    const group = element('section', 'chlo-settings-section');
    group.append(element('h4', '', title));
    return group;
}

function appendExisting(container, ...nodes) {
    nodes.filter(Boolean).forEach(node => container.append(node));
}

function labeledControl(id) {
    const setting = byId(id);
    return setting?.closest('label') ?? document.querySelector(`label[for="${id}"]`) ?? setting?.parentElement;
}

function regroupSettings(pages) {
    const { chat, general, advanced } = pages;
    const misc = document.querySelector('[name="MiscellaneousToggles"]');
    const chatControls = document.querySelector('[name="ChatMessageHandlingToggles"]');
    const character = document.querySelector('[name="CharacterHandlingToggles"]');

    const account = section('Account and language');
    appendExisting(account, byId('account_controls'), byId('UI-language-block'), byId('version_display'));
    appendExisting(general, account, character);
    appendExisting(character, labeledControl('world_import_dialog'));

    appendExisting(chat, chatControls);
    const writing = section('Composer and streaming');
    for (const id of ['smooth_streaming', 'smooth_streaming_no_think', 'enable_auto_select_input', 'enable_md_hotkeys', 'restore_user_input', 'click_to_edit']) {
        appendExisting(writing, labeledControl(id));
    }
    appendExisting(writing, byId('smooth_streaming_speed_control'));
    appendExisting(chat, writing);

    const diagnostics = section('Diagnostics and scripting');
    for (const id of ['experimental_macro_engine', 'console_log_prompts', 'request_token_probabilities', 'relaxed_api_urls', 'enableLabMode']) {
        appendExisting(diagnostics, labeledControl(id));
    }
    const autocomplete = document.querySelector('[name="AutoCompleteToggle"]');
    const autocompleteLook = section('Autocomplete appearance');
    for (const id of ['stscript_autocomplete_style', 'stscript_autocomplete_font_scale', 'stscript_autocomplete_width_left']) {
        const control = byId(id);
        const row = id.endsWith('_left') ? control?.closest('.doubleRangeContainer')?.parentElement : control?.closest('[title]');
        if (row && autocomplete?.contains(row) && row !== autocomplete) appendExisting(autocompleteLook, row);
    }
    appendExisting(byId('chlo-appearance-more') ?? pages['appearance-advanced'], autocompleteLook);
    misc?.querySelector('h4')?.remove();
    appendExisting(diagnostics, misc);
    appendExisting(advanced, diagnostics, autocomplete, document.querySelector('[name="STscriptToggles"]'));

    for (const id of ['fast_ui_mode', 'noShadowsmode', 'enableZenSliders', 'zoomed_avatar_magnification']) {
        labeledControl(id)?.classList.add('chlo-settings-retired');
    }
}

function controlName(node) {
    if (node.dataset.settingLabel) return node.dataset.settingLabel;
    const labels = [...(node.labels ?? [])].map(item => item.textContent.trim()).filter(Boolean);
    const separate = node.id ? document.querySelector(`label[for="${CSS.escape(node.id)}"]`) : null;
    const row = node.closest('[title]')?.getAttribute('title');
    return (node.getAttribute('aria-label') || labels[0] || separate?.textContent || node.getAttribute('title')
        || (node.matches('button, .menu_button') ? node.textContent : '') || row || '').trim();
}

function expandParents(node, page) {
    for (let parent = node.parentElement; parent && parent !== page; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
        if (parent.classList.contains('inline-drawer-content') && getComputedStyle(parent).display === 'none') {
            parent.parentElement.querySelector(':scope > .inline-drawer-toggle')?.click();
        }
    }
}

export function initUserSettings() {
    const drawer = byId('user-settings-block');
    if (!drawer || drawer.classList.contains('chlo-user-settings')) return;
    const railToggle = document.querySelector('#user-settings-button > .drawer-toggle');
    drawer.classList.add('chlo-user-settings', 'fillLeft');
    drawer.setAttribute('aria-labelledby', 'chlo-settings-heading');
    railToggle?.setAttribute('aria-controls', drawer.id);

    const bounds = element('div', 'chlo-settings-shell');
    const top = element('header', 'chlo-settings-header');
    const back = button('Back', () => openPage(trail.pop() ?? 'home'), 'arrow-left');
    const heading = element('h3', '', 'User Settings');
    heading.id = 'chlo-settings-heading';
    heading.tabIndex = -1;
    const close = button('Close User Settings', () => railToggle?.click(), 'xmark');
    const searchRow = element('label', 'chlo-settings-search-row');
    const query = element('input');
    query.type = 'search';
    query.placeholder = 'Search settings';
    query.setAttribute('aria-label', 'Search settings');
    searchRow.append(icon('magnifying-glass'), query);
    top.append(back, heading, close);
    const scroll = element('div', 'chlo-settings-scroll');
    const home = element('div', 'chlo-settings-home');
    const results = element('div', 'chlo-settings-results');
    const allPages = [...categories, ...appearancePages, ['snippets', 'CSS Snippets']];
    const pages = Object.fromEntries(allPages.map(([id]) => [id, element('div', 'chlo-settings-page')]));
    for (const [id, page] of Object.entries(pages)) page.dataset.settingsPage = id;
    for (const [id] of appearancePages) pages[id].classList.add('chlo-appearance-page');
    pages.snippets.classList.add('chlo-snippets');
    const themeLabel = element('span', 'chlo-settings-badge');
    const names = Object.fromEntries(allPages.map(([id, name]) => [id, name]));
    const trail = [];
    let current = 'home';
    let wasOpen = false;

    function showDrawer() {
        if (!drawer.classList.contains('openDrawer')) railToggle?.click();
    }

    function openPage(id, { focus = true } = {}) {
        current = id;
        heading.textContent = names[id] ?? 'User Settings';
        home.hidden = id !== 'home';
        results.hidden = id !== 'search';
        searchRow.hidden = id !== 'home' && id !== 'search';
        back.hidden = id === 'home' || id === 'search';
        for (const [key, page] of Object.entries(pages)) page.hidden = key !== id;
        themeLabel.textContent = themeDisplayName(power_user.theme) || 'Themes';
        scroll.scrollTop = 0;
        if (focus) heading.focus({ preventScroll: true });
    }

    function navigate(id, options) {
        if (current !== id) trail.push(current);
        openPage(id, options);
    }

    function reveal(node, page) {
        navigate(page, { focus: false });
        expandParents(node, pages[page]);
        if (node.tagName === 'SUMMARY' && node.parentElement.tagName === 'DETAILS') node.parentElement.open = true;
        node.focus({ preventScroll: true });
        node.scrollIntoView({ block: 'nearest' });
    }

    function navRow(title, handler, subtitle, glyph, badge) {
        const row = button(title, handler);
        row.classList.add(subtitle ? 'chlo-settings-category' : 'chlo-settings-link');
        const copy = element('span', 'chlo-settings-category-copy');
        copy.append(element('strong', '', title));
        if (subtitle) copy.append(element('small', '', subtitle));
        row.replaceChildren();
        if (glyph) row.append(icon(glyph));
        row.append(copy);
        if (badge) row.append(badge);
        row.append(icon('chevron-right'));
        return row;
    }

    for (const [id, name] of [['ui_language_select', 'Language'], ['customCSS', 'Custom CSS']]) {
        const node = byId(id);
        if (node) node.dataset.settingLabel = name;
    }

    function renderSearch() {
        const term = query.value.trim().toLowerCase();
        trail.length = 0;
        if (!term) { openPage('home', { focus: false }); return; }
        openPage('search', { focus: false });
        results.replaceChildren();
        const seen = new Set();
        for (const [page, root] of Object.entries(pages)) {
            if (page === 'snippets') continue;
            if (names[page].toLowerCase().includes(term)) {
                results.append(navRow(names[page], () => navigate(page)));
            }
            for (const node of root.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea, button, summary, [id].menu_button')) {
                const hidden = node.closest('.chlo-settings-retired, [hidden], .displayNone');
                if ((hidden && hidden !== root) || node.hasAttribute('data-for') || node.dataset.settingsSearch === 'ignore') continue;
                const name = controlName(node) || (node.tagName === 'SUMMARY' ? node.textContent.trim() : '');
                const keywords = [name, node.dataset.settingAliases].filter(Boolean).join(' ').toLowerCase();
                if (!name || seen.has(name) || !keywords.includes(term)) continue;
                seen.add(name);
                results.append(navRow(name, () => {
                    if (node.id === 'chlo-css-snippets-link') navigate('snippets');
                    else reveal(node, page);
                }, names[page]));
            }
        }
        if (!results.childElementCount) results.append(element('p', 'chlo-settings-empty', 'No matching settings.'));
    }

    scroll.append(home, results, ...Object.values(pages));
    bounds.append(top, searchRow, scroll);
    drawer.append(bounds);
    populateAppearance(pages, navRow, navigate);
    regroupSettings(pages);
    initCssSnippets(pages.snippets, () => {
        query.value = '';
        showDrawer();
        trail.splice(0, trail.length, 'home', 'interface', 'appearance-advanced', 'appearance-css');
        openPage('snippets');
    });

    eventSource.on(event_types.UI_THEME_CHANGED, () => {
        themeLabel.textContent = themeDisplayName(power_user.theme) || 'Themes';
    });
    for (const [key, name, detail, glyph] of categories) {
        const row = navRow(name, () => navigate(key), detail, glyph, key === 'interface' ? themeLabel : null);
        if (key === 'interface') row.classList.add('chlo-settings-category-primary');
        home.append(row);
    }
    query.addEventListener('input', renderSearch);
    drawer.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (current === 'home') close.click();
        else if (current === 'search') { query.value = ''; renderSearch(); } else back.click();
    });
    new MutationObserver(() => {
        const open = drawer.classList.contains('openDrawer');
        if (open && !wasOpen) themeLabel.textContent = themeDisplayName(power_user.theme) || 'Themes';
        railToggle?.setAttribute('aria-expanded', String(open));
        if (!open && wasOpen) {
            query.value = '';
            trail.length = 0;
            openPage('home', { focus: false });
        }
        wasOpen = open;
    }).observe(drawer, { attributes: true, attributeFilter: ['class'] });
    openPage('home', { focus: false });
}

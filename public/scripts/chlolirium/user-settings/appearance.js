import { eventSource, event_types } from '../../../script.js';
import { power_user } from '../../power-user.js';
import { byId, button, check, element, group, icon, labelInput, move, nativeRange, selectRow } from './components.js';
import { themeDisplayName } from './theme-data.js';

export const appearancePages = [
    ['appearance-colors', 'Theme & Colors', 'Themes, accents, and message colors', 'palette'],
    ['appearance-chat', 'Chat & Text', 'Chat style, text, and avatars', 'comment'],
    ['appearance-layout', 'Layout & Background', 'Chat width, wallpaper, and blur', 'image'],
    ['appearance-advanced', 'Advanced Appearance', 'Mobile, fine tuning, and CSS', 'sliders'],
    ['appearance-css', 'CSS & Snippets'],
];

function fold(root, title, className = '') {
    const details = element('details', `chlo-appearance-fold ${className}`);
    const summary = element('summary', 'chlo-appearance-summary', title);
    summary.append(icon('chevron-down'));
    const body = element('div', 'chlo-appearance-fold-body');
    details.append(summary, body);
    root.append(details);
    return { body, summary, details };
}

function swatch(color) {
    const node = element('span', 'chlo-appearance-swatch');
    node.style.setProperty('--swatch', `var(--${color})`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

export function appearancePreview() {
    const palette = element('span', 'chlo-appearance-preview');
    palette.setAttribute('aria-hidden', 'true');
    palette.append(...['customThemeColor', 'customThemeColor2'].map(swatch));
    return palette;
}

function compact(row, title = row.dataset.settingName) {
    const original = row.dataset.settingName;
    const label = row.querySelector('label');
    if (label && title) label.textContent = title;
    if (title) {
        row.dataset.settingName = title;
        const input = row.querySelector('input:not([type=number]), select, textarea');
        labelInput(input, title);
        if (input && original !== title) input.dataset.settingAliases = original;
        for (const number of row.querySelectorAll('input[type=number]')) number.setAttribute('aria-label', `${title} value`);
    }
    return row;
}

function friendlyValue(root, row, title, choices) {
    if (!row) return;
    const exact = row.querySelector('input[type=text]');
    const picker = element('select');
    picker.id = `${exact.id}-friendly`;
    const label = element('label', '', title);
    label.htmlFor = picker.id;
    labelInput(picker, title);
    picker.dataset.settingAliases = row.dataset.settingName;
    exact.dataset.settingsSearch = 'ignore';
    exact.setAttribute('aria-label', `${title} · exact CSS value`);
    for (const [name, value] of choices) picker.add(new Option(name, value));
    const custom = '__custom__';
    picker.add(new Option('Custom…', custom));

    const wrapper = element('div', 'chlo-appearance-friendly');
    const choice = element('div', 'chlo-appearance-choice');
    choice.append(label, picker);
    row.classList.add('chlo-appearance-exact');
    const editExact = button('Edit exact value', () => {
        row.hidden = false;
        editExact.hidden = true;
        exact.focus();
    });
    editExact.classList.add('chlo-appearance-exact-link');
    editExact.dataset.settingsSearch = 'ignore';
    wrapper.append(choice, editExact, row);
    root.append(wrapper);

    function sync() {
        const known = choices.some(([, value]) => value === exact.value);
        picker.value = known ? exact.value : custom;
        row.hidden = true;
        editExact.hidden = known;
    }
    picker.addEventListener('change', () => {
        if (picker.value === custom) {
            row.hidden = false;
            editExact.hidden = true;
            exact.focus();
        } else {
            exact.value = picker.value;
            exact.dispatchEvent(new Event('change', { bubbles: true }));
            sync();
        }
    });
    // Re-read from the original control after a theme has updated its editors.
    eventSource.on(event_types.UI_THEME_CHANGED, sync);
    exact.addEventListener('change', () => {
        const known = choices.some(([, value]) => value === exact.value);
        picker.value = known ? exact.value : custom;
    });
    sync();
}

function manageThemes(root) {
    const source = byId('UI-presets-block');
    const themeSelect = byId('themes');
    const importFile = byId('ui_preset_import_file');
    if (!source || !themeSelect) return;
    const row = element('div', 'chlo-appearance-manage');
    const actions = fold(row, 'Theme actions', 'chlo-appearance-actions');
    const options = [
        ['ui-preset-update-button', 'Save changes'],
        ['ui-preset-save-button', 'Save as new theme'],
        ['ui_preset_import_button', 'Import theme'],
        ['ui_preset_export_button', 'Export theme'],
        ['ui-preset-delete-button', 'Delete theme'],
    ];
    for (const [id, title] of options) {
        const original = byId(id);
        if (!original) continue;
        const action = button(title, () => {
            actions.details.open = false;
            original.click();
        });
        actions.body.append(action);
    }
    labelInput(themeSelect, 'Theme preset');
    row.prepend(themeSelect);
    root.append(row);
    // Preserve the original actions and their handlers, including the file chooser.
    if (importFile) source.append(importFile);
}

function nativeColor(root, id, name) {
    const picker = byId(id);
    if (!picker) return;
    const row = element('div', 'chlo-appearance-native-color');
    const trigger = button(name, () => {
        const control = picker.shadowRoot?.querySelector('button');
        control?.focus({ preventScroll: true });
        control?.click();
    });
    trigger.classList.add('chlo-appearance-color-proxy');
    trigger.dataset.settingLabel = name;
    trigger.dataset.settingAliases = picker.nextElementSibling?.textContent.trim() ?? '';
    picker.setAttribute('button-width', '24px');
    picker.setAttribute('button-height', '24px');
    picker.setAttribute('popup-position', 'right');
    picker.setAttribute('aria-label', name);
    row.append(trigger, picker);
    root.append(row);
}

function editableColor(root, row, title) {
    if (!row) return;
    const { body, summary, details } = fold(root, title, 'chlo-appearance-color');
    details.setAttribute('name', 'chlo-theme-color');
    summary.prepend(swatch(row.dataset.appearanceSetting));
    summary.dataset.settingLabel = title;
    summary.dataset.settingAliases = row.dataset.settingName;
    row.classList.add('chlo-appearance-color-editor');
    for (const input of row.querySelectorAll('input')) {
        input.dataset.settingsSearch = 'ignore';
        const kind = input.type === 'range' ? 'opacity' : input.type === 'color' ? 'color' : 'hex value';
        input.setAttribute('aria-label', `${title} · ${kind}`);
    }
    body.append(row);
}

export function populateAppearance(pages, navRow, navigate) {
    const source = byId('chlo-theme-settings');
    const overview = pages.interface;
    const colors = pages['appearance-colors'];
    const chat = pages['appearance-chat'];
    const layout = pages['appearance-layout'];
    const advanced = pages['appearance-advanced'];
    const css = pages['appearance-css'];
    const rows = new Map(Array.from(source.children, row => [row.dataset.appearanceSetting, row]));
    const take = key => {
        const row = rows.get(key);
        rows.delete(key);
        return row;
    };
    const add = (root, key, title) => {
        const row = take(key);
        if (row) root.append(compact(row, title));
    };
    const addByCategory = (root, ...categories) => {
        for (const [key, row] of rows) {
            if (categories.includes(row.dataset.appearanceCategory)) add(root, key);
        }
    };

    for (const [key, title, detail, glyph] of appearancePages.slice(0, 4)) {
        const row = navRow(title === 'Advanced Appearance' ? 'Advanced' : title, () => navigate(key), detail, glyph,
            key === 'appearance-colors' ? appearancePreview() : null);
        row.dataset.settingsSearch = 'ignore';
        if (key === 'appearance-colors') {
            row.classList.add('chlo-settings-category-primary');
            const subtitle = row.querySelector('small');
            const refresh = () => { subtitle.textContent = `${themeDisplayName(power_user.theme) || 'Default'} · Active theme`; };
            eventSource.on(event_types.UI_THEME_CHANGED, refresh);
            refresh();
        }
        overview.append(row);
    }

    manageThemes(group(colors, 'Active theme'));
    const accent = group(colors, 'Accents');
    editableColor(accent, take('customThemeColor'), 'Primary accent');
    editableColor(accent, take('customThemeColor2'), 'Secondary accent');
    editableColor(accent, take('Drawer-iconColor'), 'Menu icons');
    editableColor(accent, take('customScrollbarColor'), 'Scrollbar');
    const surfaces = group(colors, 'Backgrounds');
    editableColor(surfaces, take('customBgColor1'), 'Main panels');
    editableColor(surfaces, take('customBgColor2'), 'Secondary panels');
    editableColor(surfaces, take('customTopBarColor'), 'Top bar');
    editableColor(surfaces, take('sheldBackgroundColor'), 'Chat panel');
    for (const [id, name] of [
        ['chat-tint', 'Chat tint'],
        ['blur-tint', 'Menu tint'],
        ['border', 'Borders'],
    ]) nativeColor(surfaces, `${id}-color-picker`, name);
    const text = group(colors, 'Text & Messages');
    for (const [id, name] of [
        ['main-text', 'Main text'],
        ['quote', 'Quotes'],
        ['italics', 'Italics'],
        ['underline', 'Underlines'],
        ['shadow', 'Text shadow'],
        ['user-mes-blur-tint', 'Your messages'],
        ['bot-mes-blur-tint', 'Character messages'],
    ]) nativeColor(text, `${id}-color-picker`, name);

    const reading = group(chat, 'Reading');
    selectRow(reading, 'chat_display', 'Chat style');
    friendlyValue(reading, take('messageTextFontSize'), 'Message text size', [
        ['Small', '13px'], ['Medium', '15px'], ['Large', '17px'], ['Extra large', '20px'],
    ]);
    friendlyValue(reading, take('messageLineHeight'), 'Line spacing', [
        ['Tight', '1.35em'], ['Default', 'calc(var(--mainFontSize) + .5rem)'], ['Roomy', '1.7em'],
    ]);
    const paragraphs = fold(reading, 'Paragraph spacing').body;
    friendlyValue(paragraphs, take('mesParagraphSpacingTop'), 'Above paragraphs', [
        ['Tight', '0.2em'], ['Default', '0.4em'], ['Roomy', '0.8em'],
    ]);
    friendlyValue(paragraphs, take('mesParagraphSpacingBottom'), 'Below paragraphs', [
        ['Tight', '0.3em'], ['Default', '0.6em'], ['Roomy', '1em'],
    ]);
    const avatars = group(chat, 'Avatars');
    selectRow(avatars, 'avatar_style', 'Avatar shape');
    move(avatars, check('hideChatAvatarsEnabled'));
    const avatarDetails = fold(avatars, 'More avatar options').body;
    move(avatarDetails, source.querySelector(':scope > label'));
    add(avatarDetails, 'hideAvatarBorder');
    friendlyValue(avatarDetails, take('custom-ChatAvatar'), 'Avatar size', [
        ['Small', '32px'], ['Medium', '40px'], ['Large', '56px'],
    ]);
    const messages = fold(chat, 'Message details & layout').body;
    selectRow(messages, 'media_display', 'Media style');
    move(messages, ...['waifuMode', 'expandMessageActions', 'messageTimerEnabled', 'messageTimestampsEnabled', 'messageModelIconEnabled', 'mesIDDisplayEnabled', 'messageTokensEnabled', 'show_swipe_num_all_messages', 'quick_continue', 'quick_impersonate', 'show_group_chat_queue', 'stream_fade_in'].map(check));
    addByCategory(messages, 'chat-general', 'visual-novel');
    const layouts = fold(chat, 'Chat layout details').body;
    for (const [category, title] of [
        ['chat-echo', 'Echo layout'], ['chat-whisper', 'Whisper layout'], ['chat-ripple', 'Ripple layout'],
    ]) addByCategory(fold(layouts, title).body, category);
    addByCategory(fold(chat, 'Exact typography').body, 'chat-style');

    const size = group(layout, 'Size');
    nativeRange(size, 'chat_width_slider', 'Chat width');
    nativeRange(size, 'font_scale', 'Interface text scale');
    const background = group(layout, 'Background');
    add(background, 'customCSS-bg-opacity', 'Wallpaper opacity');
    add(background, 'customCSS-bg-blur', 'Wallpaper blur');
    add(background, 'sheldBlurStrength', 'Chat panel blur');
    nativeRange(background, 'blur_strength', 'Menu blur');
    const phone = fold(layout, 'On phones').body;
    add(phone, 'mobileSheldBlurStrength', 'Mobile chat panel blur');
    move(phone, check('compact_input_area'));
    const navigation = fold(layout, 'Navigation & portraits').body;
    move(navigation, byId('chlo-identity-settings'));
    selectRow(navigation, 'aux_field', 'Character list subtitle');
    move(navigation, ...['hotswapEnabled', 'show_card_avatar_urls', 'bogus_folders', 'background_thumbnails_animation'].map(check));
    const notifications = fold(layout, 'Notifications & accessibility').body;
    selectRow(notifications, 'toastr_position', 'Notification position');
    move(notifications, ...['reduced_motion', 'play_message_sound', 'play_sound_unfocused'].map(check));

    const cssLink = navRow('CSS & Snippets', () => navigate('appearance-css'), 'Custom styles and reusable rules', 'code');
    cssLink.dataset.settingsSearch = 'ignore';
    advanced.append(cssLink);
    const behavior = fold(advanced, 'Menus & windows').body;
    move(behavior, byId('movingUIModeCheckBlock')?.parentElement, byId('MovingUI-presets-block'));
    addByCategory(behavior, 'theme-extras');
    const device = fold(advanced, 'Mobile & tablet options').body;
    addByCategory(device, 'mobile-global-settings', 'mobile-detailed-settings');
    const other = fold(advanced, 'Other appearance options').body;
    other.id = 'chlo-appearance-more';
    nativeRange(other, 'shadow_width', 'Text shadow width');

    const snippets = navRow('CSS Snippets', () => navigate('snippets'), 'Create and manage reusable CSS rules', 'code');
    snippets.id = 'chlo-css-snippets-link';
    snippets.dataset.settingLabel = 'CSS Snippets';
    css.append(snippets);
    const standardCss = fold(css, 'Custom CSS').body;
    const originalEditor = byId('CustomCSS-block');
    originalEditor?.querySelector('h4 > span')?.setAttribute('hidden', '');
    standardCss.append(element('p', 'chlo-appearance-note', 'Styles for the whole interface.'));
    move(standardCss, originalEditor);
    const override = fold(css, 'Override CSS', 'chlo-appearance-override').body;
    override.append(element('p', 'chlo-appearance-note', 'Applies after the built-in appearance rules.'));
    add(override, 'rawCustomCss', 'Override CSS');
    const custom = fold(advanced, 'Additional controls');
    custom.details.hidden = true;
    const appendCustom = row => {
        if (!row.dataset.appearanceSetting) return;
        custom.details.hidden = false;
        custom.body.append(compact(row));
    };
    for (const row of rows.values()) appendCustom(row);
    source.addEventListener('chlo:appearance-control-added', event => appendCustom(event.detail));
}

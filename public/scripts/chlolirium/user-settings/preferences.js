import { byId, check, element, group, labelInput, move, nativeRange, selectRow } from './components.js';

const sections = {
    chat: [
        ['chat-composer', 'Composer', 'Sending, drafts, and keyboard shortcuts', 'pen'],
        ['chat-history', 'History & Editing', 'Loading, swipes, and message editing', 'clock-rotate-left'],
        ['chat-streaming', 'Streaming', 'How new replies appear', 'wave-square'],
        ['chat-automation', 'Auto-replies', 'Auto-continue and auto-swipe', 'arrows-rotate'],
    ],
    general: [
        ['general-account', 'Account & Language', 'Profile, language, and app version', 'user'],
        ['general-characters', 'Characters', 'Search, card prompts, and spoilers', 'address-card'],
        ['general-imports', 'Imports', 'Card tags, avatars, and lorebooks', 'file-import'],
    ],
    advanced: [
        ['advanced-scripts', 'Macros & Scripts', 'Macro engine and STscript behavior', 'code'],
        ['advanced-autocomplete', 'Autocomplete', 'Suggestions for macros and slash commands', 'keyboard'],
        ['advanced-tools', 'Diagnostics & Tools', 'Debugging, cleanup, and compatibility', 'screwdriver-wrench'],
    ],
};

export const preferencePages = Object.values(sections).flat();

function switches(root, ...ids) {
    move(root, ...ids.map(check));
}

function renamedSwitches(root, names) {
    for (const [id, title] of Object.entries(names)) {
        const input = byId(id);
        const label = check(id);
        if (!input || !label) continue;
        const copy = label.querySelector('small');
        input.dataset.settingAliases = copy?.textContent.trim() ?? '';
        labelInput(input, title);
        if (copy) {
            copy.removeAttribute('data-i18n');
            copy.textContent = title;
        }
        root.append(label);
    }
}

function field(root, id, name) {
    const input = byId(id);
    if (!input) return;
    const label = element('label', '', name);
    label.htmlFor = id;
    labelInput(input, name);
    const row = element('div', 'chlo-preference-field');
    row.append(label, input);
    root.append(row);
}

function enableActionKeys(ids) {
    for (const id of ids) {
        const action = byId(id);
        if (!action) continue;
        action.setAttribute('role', 'button');
        action.tabIndex = 0;
        action.addEventListener('keydown', event => {
            if (event.target !== action || event.repeat || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            action.click();
        });
    }
}

function populateChat(pages) {
    const composer = group(pages['chat-composer'], 'Sending');
    selectRow(composer, 'send_on_enter', 'Enter to send');
    renamedSwitches(composer, { continue_on_send: 'Continue with an empty Send' });
    const writing = group(pages['chat-composer'], 'While typing');
    switches(writing, 'restore_user_input', 'enable_md_hotkeys', 'enable_auto_select_input');

    const history = group(pages['chat-history'], 'Opening a chat');
    nativeRange(history, 'chat_truncation', 'Messages to load');
    history.append(element('p', 'chlo-appearance-note', 'Set to 0 to load the entire chat.'));
    switches(history, 'auto-load-chat-checkbox', 'auto_scroll_chat_to_bottom');

    const editing = group(pages['chat-history'], 'Editing messages');
    switches(editing, 'click_to_edit', 'auto_save_msg_edits', 'confirm_message_delete', 'auto_fix_generated_markdown');

    const swipes = group(pages['chat-history'], 'Swipes');
    selectRow(swipes, 'image_overswipe', 'When swiping past the last image');
    renamedSwitches(swipes, {
        'swipes-checkbox': 'Show swipe arrows',
        'gestures-checkbox': 'Swipe gestures on mobile',
    });

    const replies = group(pages['chat-history'], 'Message display');
    renamedSwitches(replies, {
        forbid_external_media: 'Block external media',
        allow_name2_display: 'Keep character name prefixes in replies',
        allow_name1_display: 'Keep your name prefix in replies',
        encode_tags: 'Allow HTML formatting in replies',
        pin_styles: 'Keep styling from the greeting',
    });

    // Keep the smoothing controls as siblings so the existing dependency rules apply.
    const streaming = group(pages['chat-streaming'], 'Live text');
    nativeRange(streaming, 'streaming_fps', 'Streaming refresh rate (FPS)');
    switches(streaming, 'smooth_streaming');
    renamedSwitches(streaming, { smooth_streaming_no_think: 'Skip smoothing in reasoning blocks' });
    labelInput(byId('smooth_streaming_speed'), 'Smooth streaming speed');
    move(streaming, byId('smooth_streaming_speed_control'));

    const autoContinue = group(pages['chat-automation'], 'Auto-continue');
    renamedSwitches(autoContinue, {
        auto_continue_enabled: 'Enable auto-continue',
        auto_continue_allow_chat_completions: 'Allow for Chat Completion APIs',
    });
    field(autoContinue, 'auto_continue_target_length', 'Target length (tokens)');

    const autoSwipe = group(pages['chat-automation'], 'Auto-swipe');
    renamedSwitches(autoSwipe, { auto_swipe: 'Enable auto-swipe' });
    field(autoSwipe, 'auto_swipe_minimum_length', 'Minimum reply length (characters)');
    field(autoSwipe, 'auto_swipe_blacklist', 'Words to avoid');
    field(autoSwipe, 'auto_swipe_blacklist_threshold', 'Matching words needed to retry');
    autoSwipe.append(element('p', 'chlo-appearance-note', 'Separate words with commas.'));

    const context = group(pages['chat-automation'], 'Examples & group chats');
    selectRow(context, 'example_messages_behavior', 'Example messages');
    switches(context, 'disable_group_trimming');
}

function populateGeneral(pages) {
    const account = group(pages['general-account'], 'Account');
    move(account, byId('account_controls'));
    enableActionKeys(['account_button', 'admin_button', 'logout_button']);
    selectRow(group(pages['general-account'], 'Language'), 'ui_language_select', 'Interface language');
    move(group(pages['general-account'], 'About ChloLirium'), byId('version_display'));

    const characters = group(pages['general-characters'], 'Finding characters');
    switches(characters, 'fuzzy_search_checkbox', 'spoiler_free_mode');
    renamedSwitches(group(pages['general-characters'], 'Character card overrides'), {
        prefer_character_prompt: 'Use the card’s system prompt',
        prefer_character_jailbreak: 'Use the card’s post-history instructions',
    });

    const imports = group(pages['general-imports'], 'Character cards');
    selectRow(imports, 'tag_import_setting', 'Import card tags');
    switches(imports, 'never_resize_avatars');
    renamedSwitches(group(pages['general-imports'], 'Lorebooks'), {
        world_import_dialog: 'Ask before importing a card’s lorebook',
    });
}

function populateAdvanced(pages) {
    switches(group(pages['advanced-scripts'], 'Macros'), 'experimental_macro_engine');
    const flags = group(pages['advanced-scripts'], 'STscript parser flags');
    switches(flags, 'stscript_parser_flag_strict_escaping', 'stscript_parser_flag_replace_getvar');

    const completion = group(pages['advanced-autocomplete'], 'Suggestions');
    selectRow(completion, 'stscript_autocomplete_state', 'Show suggestions');
    selectRow(completion, 'stscript_matching', 'Match suggestions');
    selectRow(completion, 'stscript_autocomplete_select', 'Select with');
    switches(completion, 'stscript_autocomplete_autoHide', 'stscript_autocomplete_showInAllMacroFields');

    const look = byId('chlo-appearance-more');
    if (look) look.append(element('h4', 'chlo-preference-subheading', 'Autocomplete appearance'));
    for (const id of ['stscript_autocomplete_style', 'stscript_autocomplete_font_scale', 'stscript_autocomplete_width_left']) {
        const control = byId(id);
        const row = id.endsWith('_left') ? control?.closest('.doubleRangeContainer')?.parentElement : control?.closest('[title]');
        if (row && look) move(look, row);
    }

    const tools = group(pages['advanced-tools'], 'Maintenance');
    const toolIds = ['reload_chat', 'debug_menu', 'data_maid_button'];
    const actions = element('div', 'chlo-preference-actions');
    move(actions, ...toolIds.map(byId));
    move(tools, actions);
    enableActionKeys(toolIds);
    switches(group(pages['advanced-tools'], 'Troubleshooting'), 'console_log_prompts', 'request_token_probabilities');
    const compatibility = group(pages['advanced-tools'], 'Compatibility & limits');
    switches(compatibility, 'relaxed_api_urls');
    renamedSwitches(compatibility, { enableLabMode: 'Unlock sampling limits' });
}

export function populatePreferences(pages, navRow, navigate) {
    for (const [parent, children] of Object.entries(sections)) {
        for (const [id, title, summary, glyph] of children) {
            const row = navRow(title, () => navigate(id), summary, glyph);
            row.dataset.settingsSearch = 'ignore';
            pages[parent].append(row);
        }
    }
    populateChat(pages);
    populateGeneral(pages);
    populateAdvanced(pages);
}

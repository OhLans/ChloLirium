import { eventSource, event_types, getRequestHeaders, saveSettings, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, getContext } from '../../extensions.js';
import { power_user } from '../../power-user.js';
import { callGenericPopup, POPUP_RESULT, POPUP_TYPE } from '../../popup.js';
import { isAdmin } from '../../user.js';
import { download, isTrueBoolean, uuidv4 } from '../../utils.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue } from '../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { activeSnippets, legacySnippetFolder, mergeSyncedSnippets, normalizeSnippet, parseSnippetImport, readSnippetSettings, syncedSnippetKey } from './snippets-data.js';
import { button, element, icon } from './components.js';

const legacyName = `third-party/${legacySnippetFolder}`;
let settings;
let refreshList = () => {};
let openManager = () => {};
let styleHost;
let styleNodes = [];
let lastSheet = '';

const snippetScope = () => {
    const { characters, characterId, groupId } = getContext();
    return { theme: power_user.theme, character: characters[characterId]?.avatar, group: groupId };
};

function readSynced() {
    try {
        const values = JSON.parse(localStorage.getItem(syncedSnippetKey) ?? '[]');
        return Array.isArray(values) ? values : [];
    } catch {
        return [];
    }
}

function updateStyles() {
    const snippets = settings.nativeEnabled ? activeSnippets(settings.snippetList, snippetScope()) : [];
    const signature = JSON.stringify(snippets.map(snippet => snippet.content));
    if (signature === lastSheet) return;
    lastSheet = signature;
    const rules = snippets.map(snippet => {
        const node = document.createElement('style');
        node.textContent = snippet.content;
        node.dataset.chloCssSnippet = snippet.id;
        return node;
    });
    // A separate stylesheet per snippet keeps one bad rule from swallowing the next
    // snippet and allows each snippet's leading @import rules to work.
    for (const node of styleNodes) node.remove();
    styleHost.before(...rules);
    styleNodes = rules;
}

function save(snippet, announce = true) {
    if (snippet) {
        snippet.modifiedOn = Date.now();
        const entries = readSynced();
        const index = entries.findIndex(entry => String(entry?.id) === snippet.id);
        if (snippet.isSynced || index >= 0) {
            if (index < 0) entries.push(snippet);
            else entries[index] = snippet;
            try {
                localStorage.setItem(syncedSnippetKey, JSON.stringify(entries));
            } catch (error) {
                console.warn('Could not sync CSS snippets to browser storage', error);
            }
        }
    }
    saveSettingsDebounced();
    updateStyles();
    if (announce) refreshList();
}

function addSnippet(values) {
    const snippet = normalizeSnippet(values, {}, uuidv4);
    if (settings.snippetList.some(item => item.id === snippet.id)) snippet.id = uuidv4();
    settings.snippetList.push(snippet);
    return snippet;
}

function removeSnippet(snippet) {
    settings.snippetList.splice(settings.snippetList.indexOf(snippet), 1);
    save({ ...snippet, isDeleted: true });
}

function setLink(snippet, field, value, checked) {
    if (value == null || value === '') return;
    const key = String(value);
    const values = snippet[field].filter(item => item !== key);
    if (checked) values.push(key);
    snippet[field] = values;
}

function registerCommands() {
    const string = [ARGUMENT_TYPE.STRING];
    const bool = (name, description) => SlashCommandNamedArgument.fromProps({ name, description, typeList: [ARGUMENT_TYPE.BOOLEAN] });
    const names = () => settings.snippetList.map(snippet => new SlashCommandEnumValue(snippet.name));
    const find = name => settings.snippetList.find(snippet => snippet.name.toLowerCase() === String(name ?? '').toLowerCase());
    const enabled = value => value !== undefined && isTrueBoolean(value || 'true');
    const missing = (args, name) => { if (!enabled(args.quiet)) toastr.warning(`No such CSS snippet: ${name}`); };
    const quiet = () => bool('quiet', 'Do not warn if the snippet is missing.');
    for (const [name, action, helpString] of [
        ['csss-on', snippet => { snippet.isDisabled = false; save(snippet); }, 'Enable a CSS snippet.'],
        ['csss-off', snippet => { snippet.isDisabled = true; save(snippet); }, 'Disable a CSS snippet.'],
        ['csss-delete', removeSnippet, 'Delete a CSS snippet.'],
        ['csss-get', (snippet, args) => enabled(args.all) ? JSON.stringify(snippet) : snippet.content, 'Get a CSS snippet.'],
    ]) {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name, helpString,
            callback: (args, value) => {
                const snippet = find(value);
                if (!snippet) { missing(args, value); return ''; }
                return action(snippet, args) ?? '';
            },
            namedArgumentList: name === 'csss-get' ? [quiet(), bool('all', 'Return all snippet fields.')] : [quiet()],
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'Snippet name', typeList: string, isRequired: true, enumProvider: names })],
        }));
    }
    for (const name of ['csss-create', 'csss-update']) {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name,
            helpString: name === 'csss-create' ? 'Create a CSS snippet.' : 'Update a CSS snippet.',
            callback: (args, value) => {
                let snippet = name === 'csss-update' ? find(args.name) : null;
                if (!snippet) {
                    if (name === 'csss-update' && !enabled(args.create)) { missing(args, args.name); return ''; }
                    snippet = addSnippet({ name: args.name, content: String(value ?? '') });
                } else if (String(value ?? '').trim()) {
                    snippet.content = String(value);
                }
                if (args.disabled !== undefined) snippet.isDisabled = enabled(args.disabled);
                if (args.global !== undefined) snippet.isGlobal = enabled(args.global);
                if (args.theme !== undefined) setLink(snippet, 'themeList', power_user.theme, enabled(args.theme));
                save(snippet);
                return '';
            },
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({ name: 'name', description: 'Snippet name', typeList: string, isRequired: true, enumProvider: names }),
                bool('disabled', 'Disable this snippet.'),
                bool('global', 'Apply to every theme and chat.'),
                bool('theme', 'Link to the current theme.'),
                ...(name === 'csss-update' ? [quiet(), bool('create', 'Create the snippet if it is missing.')] : []),
            ],
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: 'CSS content', typeList: string, isRequired: name === 'csss-create' })],
        }));
    }
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'csss', helpString: 'Open CSS Snippets in User Settings.',
        callback: () => { openManager(); return ''; },
    }));
}

async function renderLegacyUninstall(container) {
    try {
        const response = await fetch('/api/extensions/discover');
        if (!response.ok) return;
        const installed = (await response.json()).find(item => item.name.toLowerCase() === legacyName.toLowerCase());
        if (!installed) return;
        const global = installed.type === 'global';
        if (global && !isAdmin()) return;
        const remove = button('Remove standalone extension', async () => {
            const result = await callGenericPopup('Remove the standalone CSS Snippets extension? Your snippets stay in ChloLirium.', POPUP_TYPE.CONFIRM);
            if (result !== POPUP_RESULT.AFFIRMATIVE) return;
            remove.disabled = true;
            try {
                await saveSettings();
                const deletion = await fetch('/api/extensions/delete', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ extensionName: installed.name.split('/').at(-1), global }),
                });
                if (!deletion.ok) throw new Error(`HTTP ${deletion.status}`);
                container.replaceChildren();
                toastr.success('Standalone extension removed. Your snippets are still here.');
            } catch (error) {
                console.warn('Could not remove standalone CSS Snippets', error);
                remove.disabled = false;
                toastr.error('Could not remove the standalone extension.');
            }
        });
        container.append(remove);
    } catch (error) {
        console.warn('Could not check for standalone CSS Snippets', error);
    }
}

function checkbox(title, checked, change, disabled = false) {
    const label = element('label', 'checkbox_label chlo-snippet-checkbox');
    const input = element('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => change(input.checked));
    label.append(input, element('span', '', title));
    return label;
}

function searchMatches(snippet, text) {
    const query = text.trim().toLowerCase();
    const match = /^(all|name|title|content|css|theme):\s*(.*)$/.exec(query);
    const term = match?.[2] ?? query;
    const values = { name: snippet.name, title: snippet.name, content: snippet.content, css: snippet.content, theme: snippet.themeList.join(' ') };
    const fields = !match || match[1] === 'all' ? [values.name, values.content, values.theme] : [values[match[1]]];
    return fields.some(value => value.toLowerCase().includes(term));
}

function mountManager(container) {
    const actions = element('div', 'chlo-snippet-actions');
    const search = element('input', 'text_pole chlo-settings-search');
    search.type = 'search';
    search.placeholder = 'Search snippets';
    search.setAttribute('aria-label', 'Search snippets');
    const filter = element('select', 'text_pole');
    filter.setAttribute('aria-label', 'Filter snippets');
    for (const [value, label] of [['all', 'All snippets'], ['active', 'Applied here'], ['disabled', 'Disabled']]) {
        const item = element('option', '', label);
        item.value = value;
        filter.append(item);
    }
    const fileInput = element('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,.css,application/json,text/css';
    fileInput.multiple = true;
    fileInput.hidden = true;
    const rows = element('div', 'chlo-snippet-list');
    const disabled = checkbox('Apply CSS snippets', settings.nativeEnabled, value => { settings.nativeEnabled = value; save(); });
    const uninstall = element('div', 'chlo-snippet-uninstall');
    let editId = null;
    let dragId = null;

    function exportSnippets(items, name = 'CSS-Snippets.json') {
        download(JSON.stringify(items, null, 2), name, 'application/json');
    }

    function move(from, to) {
        if (from === to || from < 0 || to < 0 || to >= settings.snippetList.length) return;
        const [item] = settings.snippetList.splice(from, 1);
        settings.snippetList.splice(to, 0, item);
        save();
    }

    function render() {
        const scope = snippetScope();
        const applied = new Set(settings.nativeEnabled ? activeSnippets(settings.snippetList, scope) : []);
        let count = 0;
        rows.replaceChildren();
        const master = /** @type {HTMLInputElement} */ (disabled.querySelector('input'));
        master.checked = settings.nativeEnabled;
        for (const [index, snippet] of settings.snippetList.entries()) {
            if (!searchMatches(snippet, search.value) || (filter.value === 'active' && !applied.has(snippet)) || (filter.value === 'disabled' && !snippet.isDisabled)) continue;
            count++;
            const card = element('article', 'chlo-snippet-row');
            const head = element('div', 'chlo-snippet-row-head');
            const title = button(snippet.name || 'Untitled snippet', () => { editId = editId === snippet.id ? null : snippet.id; render(); });
            title.classList.add('chlo-snippet-title');
            title.setAttribute('aria-expanded', String(editId === snippet.id));
            const state = element('span', 'chlo-snippet-state', snippet.isDisabled ? 'Off' : applied.has(snippet) ? 'Applied' : 'Inactive');
            state.dataset.applied = String(applied.has(snippet));
            const handle = element('span', 'chlo-snippet-drag');
            handle.title = 'Drag to reorder';
            handle.draggable = true;
            handle.append(icon('grip-vertical'));
            handle.addEventListener('dragstart', event => {
                dragId = snippet.id;
                event.dataTransfer.setData('text/plain', snippet.id);
                event.dataTransfer.effectAllowed = 'move';
            });
            handle.addEventListener('dragend', () => { dragId = null; });
            card.addEventListener('dragover', event => { if (dragId) event.preventDefault(); });
            card.addEventListener('drop', event => {
                if (!dragId) return;
                event.preventDefault();
                move(settings.snippetList.findIndex(item => item.id === dragId), index);
                dragId = null;
            });
            head.append(handle, title, state, button(snippet.isDisabled ? 'Enable snippet' : 'Disable snippet', () => {
                snippet.isDisabled = !snippet.isDisabled;
                save(snippet);
            }, snippet.isDisabled ? 'toggle-off' : 'toggle-on'));
            card.append(head);
            if (editId === snippet.id) {
                const edit = element('div', 'chlo-snippet-editor');
                const name = element('input', 'text_pole');
                name.value = snippet.name;
                name.setAttribute('aria-label', 'Snippet name');
                name.placeholder = 'Snippet name';
                name.addEventListener('input', () => { snippet.name = name.value; title.textContent = name.value || 'Untitled snippet'; save(snippet, false); });
                const css = element('textarea', 'text_pole monospace');
                css.value = snippet.content;
                css.setAttribute('aria-label', 'Snippet CSS');
                css.placeholder = 'CSS';
                css.rows = 8;
                css.spellcheck = false;
                css.addEventListener('input', () => { snippet.content = css.value; save(snippet, false); });
                const chatField = scope.group != null ? 'groupList' : 'charList';
                const currentChat = scope.group ?? scope.character;
                const scopes = element('div', 'chlo-snippet-scopes');
                scopes.append(
                    checkbox('Global', snippet.isGlobal, value => { snippet.isGlobal = value; save(snippet); }),
                    checkbox('This theme', snippet.themeList.includes(scope.theme), value => { setLink(snippet, 'themeList', scope.theme, value); save(snippet); }, !scope.theme),
                    checkbox('This chat', currentChat != null && snippet[chatField].includes(String(currentChat)), value => { setLink(snippet, chatField, currentChat, value); save(snippet); }, currentChat == null),
                    checkbox('Sync in this browser', snippet.isSynced, value => { snippet.isSynced = value; save(snippet); }),
                );
                const links = element('div', 'chlo-snippet-links');
                const ctx = getContext();
                for (const [field, label] of [['themeList', 'Theme'], ['charList', 'Character'], ['groupList', 'Group']]) {
                    for (const key of snippet[field]) {
                        const target = field === 'groupList' ? ctx.groups?.find(group => String(group.id) === key)?.name
                            : field === 'charList' ? ctx.characters.find(char => char?.avatar === key)?.name : key;
                        const chip = button(`${label}: ${target ?? key} ×`, () => {
                            setLink(snippet, field, key, false);
                            save(snippet);
                        });
                        chip.title = `Unlink ${target ?? key}`;
                        links.append(chip);
                    }
                }
                const tools = element('div', 'chlo-snippet-actions');
                const up = button('Move up', () => move(index, index - 1), 'arrow-up');
                const down = button('Move down', () => move(index, index + 1), 'arrow-down');
                up.disabled = index === 0;
                down.disabled = index === settings.snippetList.length - 1;
                tools.append(up, down, button('Export snippet', () => exportSnippets([snippet]), 'file-export'), button('Delete snippet', async () => {
                    if (await callGenericPopup('Delete this CSS snippet?', POPUP_TYPE.CONFIRM) === POPUP_RESULT.AFFIRMATIVE) {
                        editId = null;
                        removeSnippet(snippet);
                    }
                }, 'trash-can'));
                edit.append(name, css, scopes, links, tools);
                card.append(edit);
            }
            rows.append(card);
        }
        if (!count) rows.append(element('p', 'chlo-settings-empty', settings.snippetList.length ? 'No matching snippets.' : 'Add a snippet or import a CSS Snippets export.'));
    }

    refreshList = () => {
        // A theme/chat update must not remove the editor while a user is typing.
        if (!rows.contains(document.activeElement) || !document.activeElement.matches('input:not([type="checkbox"]), textarea')) render();
    };
    actions.append(button('New snippet', () => {
        const snippet = addSnippet({ content: '', name: 'Untitled snippet', isDisabled: true });
        editId = snippet.id;
        search.value = '';
        filter.value = 'all';
        save(snippet, false);
        render();
        rows.querySelector('input[aria-label="Snippet name"]')?.focus();
    }), button('Import', () => fileInput.click()), button('Export all', () => exportSnippets(settings.snippetList)));
    search.addEventListener('input', render);
    filter.addEventListener('change', render);
    fileInput.addEventListener('change', async () => {
        let imported = 0;
        for (const file of fileInput.files) {
            try {
                const entries = parseSnippetImport(await file.text(), file.name, uuidv4);
                for (const snippet of entries) { addSnippet(snippet); imported++; }
            } catch (error) {
                console.warn('Could not import CSS snippets', error);
                toastr.error('Could not import this snippet file.');
            }
        }
        if (imported) { save(); toastr.success(`Imported ${imported} CSS snippet(s).`); }
        fileInput.value = '';
    });
    container.append(disabled, actions, fileInput, search, filter, rows, uninstall);
    render();
    void renderLegacyUninstall(uninstall);
}

export function initCssSnippets(container, open) {
    if (settings) return;
    openManager = open;
    const previous = extension_settings.cssSnippets;
    settings = readSnippetSettings(previous, uuidv4);
    const wasDisabled = extension_settings.disabledExtensions?.some(name => String(name).toLowerCase() === legacyName.toLowerCase());
    settings.nativeEnabled = previous?.nativeEnabled ?? !wasDisabled;
    settings.snippetList = mergeSyncedSnippets(settings.snippetList, readSynced(), uuidv4);
    extension_settings.cssSnippets = settings;
    if (previous ? JSON.stringify(previous) !== JSON.stringify(settings) : settings.snippetList.length > 0) saveSettingsDebounced();
    styleHost = document.createComment('ChloLirium CSS snippets');
    document.head.append(styleHost);
    mountManager(container);
    registerCommands();
    const refresh = () => { updateStyles(); refreshList(); };
    refresh();
    eventSource.on(event_types.CHAT_CHANGED, refresh);
    eventSource.on(event_types.SETTINGS_UPDATED, refresh);
    eventSource.on(event_types.UI_THEME_CHANGED, refresh);
    window.addEventListener('storage', event => {
        if (event.key !== syncedSnippetKey) return;
        const next = mergeSyncedSnippets(settings.snippetList, readSynced(), uuidv4);
        if (JSON.stringify(next) !== JSON.stringify(settings.snippetList)) {
            settings.snippetList = next;
            save();
        }
    });
}

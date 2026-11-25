import { callGenericPopup, POPUP_TYPE } from '../../popup.js';
import { uuidv4 } from '../../utils.js';

const scopes = ['global', 'preset', 'character'];
const scopeNames = { global: 'Global', preset: 'Preset', character: 'Character' };
const orderListIds = { global: 'saved_regex_scripts', preset: 'saved_preset_scripts', character: 'saved_scoped_scripts' };

export function createRegexDrawer(root, { getLayout, saveLayout, toggleDrawer, moveRule, updateBulk }) {
    const $ = selector => root.querySelector(selector);
    const $$ = selector => [...root.querySelectorAll(selector)];
    const panel = root.closest('.drawer-content');
    const scroll = $('.chlo-regex-scroll');
    const sectionsHost = $('#chlo-regex-sections');
    const orderHost = $('#chlo-regex-order');
    const search = $('#chlo-regex-search');
    const newEditor = $('#chlo-regex-new-editor');
    const orderLists = Object.fromEntries(scopes.map(scope => [scope, $(`#${orderListIds[scope]}`)]));
    const collapsed = new Set();
    let scope = 'all';
    let view = 'sections';
    let rows = [];
    let activeEditor = null;
    let permissions = {};

    const layout = () => {
        const saved = getLayout();
        return {
            sections: Array.isArray(saved?.sections) ? saved.sections : [],
            assignments: saved?.assignments && typeof saved.assignments === 'object' ? saved.assignments : {},
        };
    };
    const key = (scriptScope, id) => `${scriptScope}:${id}`;
    const selectedRows = () => rows.filter(({ node }) => node.querySelector('.regex_bulk_checkbox').checked);
    const closeMenus = () => $$('details[open].chlo-regex-menu, details[open].chlo-regex-section-tools').forEach(details => { details.open = false; });
    const chat = document.getElementById('sheld');
    const resizeDrawer = () => {
        if (!chat || !panel.classList.contains('openDrawer')) return;
        if (matchMedia('(max-width: 1000px)').matches) {
            // A focused native toolbar button can scroll the transformed page sideways.
            if (scrollX) window.scrollTo(0, scrollY);
            return;
        }
        panel.style.setProperty('--regex-chat-edge', `${chat.getBoundingClientRect().left}px`);
    };
    const chatSize = new ResizeObserver(resizeDrawer);
    const chatPosition = new MutationObserver(resizeDrawer);

    function defaultSection(row) {
        const preset = row.scope === 'preset' ? permissions.presetName : '';
        const origin = !preset && row.source ? row.source.name : '';
        const parts = [preset || origin, row.folder].filter(Boolean);
        return parts.length
            ? { id: `source:${JSON.stringify([preset, origin && row.source.type, origin, row.folder])}`, name: parts.join(' / ') }
            : { id: '', name: 'Ungrouped' };
    }

    function setRowTools(row, open) {
        row.node.querySelector('.chlo-regex-row-actions').hidden = !open;
        row.node.querySelector('.chlo-regex-row-tools').setAttribute('aria-expanded', String(open));
    }

    function updateRow(row, assignedSection, sections, defaultName) {
        const label = row.node.querySelector('.chlo-regex-scope-label');
        const blocked = (row.scope === 'preset' && !permissions.presetAllowed)
            || (row.scope === 'character' && !permissions.characterAllowed);
        row.node.classList.toggle('chlo-regex-blocked', blocked);
        label.textContent = scopeNames[row.scope];
        label.title = blocked ? `${scopeNames[row.scope]} scripts are not allowed in the current context` : '';
        const select = row.node.querySelector('.chlo-regex-section-select');
        select.replaceChildren(
            new Option(defaultName, ''),
            ...sections.map(section => new Option(section.name, section.id)),
        );
        select.value = assignedSection ?? '';
    }

    function attachEditor() {
        if (!activeEditor) return;
        const row = rows.find(item => item.key === activeEditor.key);
        if (activeEditor.key && !row) return;
        const target = row?.node ?? newEditor;
        newEditor.hidden = Boolean(row);
        target.append(activeEditor.node);
        row?.node.querySelector('.edit_existing_regex').setAttribute('aria-expanded', 'true');
    }

    function render() {
        const y = scroll.scrollTop;
        const { sections, assignments } = layout();
        const byId = new Map(sections.map(section => [section.id, section]));
        const groupByRow = new Map();
        const names = new Map(sections.map(section => [section.id, section.name]));
        const query = search.value.trim().toLocaleLowerCase();
        const visible = [];
        for (const row of rows) {
            const fallback = defaultSection(row);
            const assigned = byId.get(assignments[row.key]);
            const section = assigned ?? fallback;
            groupByRow.set(row, section.id);
            if (section.id) names.set(section.id, section.name);
            const matchesScope = scope === 'all' || scope === row.scope;
            if (matchesScope && (!query || view === 'order'
                || row.name.toLocaleLowerCase().includes(query)
                || row.source?.name.toLocaleLowerCase().includes(query)
                || section.name.toLocaleLowerCase().includes(query))) visible.push(row);
            else row.node.querySelector('.regex_bulk_checkbox').checked = false;
            updateRow(row, assigned?.id, sections, fallback.name);
        }

        root.dataset.regexView = view;
        root.dataset.regexScope = scope;
        for (const button of $$('[data-regex-scope], [data-regex-view]')) {
            const selected = button.dataset.regexScope ? button.dataset.regexScope === scope : button.dataset.regexView === view;
            button.setAttribute('aria-pressed', String(selected));
        }
        search.disabled = view === 'order';
        $('.chlo-regex-back').hidden = view !== 'order';
        sectionsHost.hidden = view !== 'sections';
        orderHost.hidden = view !== 'order';
        $('#toggle_preset_regex').hidden = !['all', 'preset'].includes(scope) || !rows.some(row => row.scope === 'preset');
        const name = $('.chlo-regex-preset-name');
        name.textContent = permissions.presetName ?? '';
        name.title = name.textContent;
        $('#toggle_scoped_regex').hidden = scope !== 'character' || !permissions.hasCharacter;
        $('#open_preset_editor').disabled = !permissions.hasPreset;
        $('#open_scoped_editor').disabled = !permissions.hasCharacter;
        $('#bulk_regex_move_to_preset').disabled = !permissions.hasPreset;
        $('#bulk_regex_move_to_scoped').disabled = !permissions.hasCharacter;

        sectionsHost.replaceChildren();
        for (const list of Object.values(orderLists)) list.replaceChildren();
        if (view === 'order') {
            for (const name of scopes) {
                const group = visible.filter(row => row.scope === name);
                orderLists[name].parentElement.hidden = !group.length;
                group.forEach((row, i) => {
                    row.node.querySelector('[data-regex-action="script-up"]').disabled = i === 0;
                    row.node.querySelector('[data-regex-action="script-down"]').disabled = i === group.length - 1;
                    orderLists[name].append(row.node);
                });
            }
        } else {
            const groups = new Map([...names.keys()].map(id => [id, []]));
            const occupied = new Set(groupByRow.values());
            groups.set('', []);
            for (const row of visible) groups.get(groupByRow.get(row)).push(row);
            for (const [id, group] of groups) {
                if (!group.length && (!byId.has(id) || query || (scope !== 'all' && occupied.has(id)))) continue;
                const section = $('#chlo-regex-section-template').content.firstElementChild.cloneNode(true);
                const heading = section.querySelector('.chlo-regex-section-toggle');
                const list = section.querySelector('.chlo-regex-section-rows');
                const name = names.get(id) ?? 'Ungrouped';
                const expanded = query !== '' || !collapsed.has(id);
                section.dataset.sectionId = id;
                heading.setAttribute('aria-expanded', String(expanded));
                section.querySelector('.chlo-regex-section-name').textContent = name;
                section.querySelector('.chlo-regex-section-tools').hidden = !byId.has(id);
                section.querySelector('.chlo-regex-section-tools summary').setAttribute('aria-label', `Tools for ${name}`);
                section.querySelector('.chlo-regex-count').textContent = String(group.length);
                section.querySelector('[data-regex-action="section-up"]').disabled = sections[0]?.id === id;
                section.querySelector('[data-regex-action="section-down"]').disabled = sections.at(-1)?.id === id;
                list.hidden = !expanded;
                for (const row of group) list.append(row.node);
                sectionsHost.append(section);
            }
        }
        const empty = $('.chlo-regex-empty');
        empty.hidden = visible.length > 0 || (view === 'sections' && sectionsHost.childElementCount > 0) || Boolean(activeEditor && !activeEditor.key);
        empty.textContent = query && view === 'sections' ? 'No matching scripts.' : 'No scripts in this scope.';
        attachEditor();
        updateBulk();
        scroll.scrollTop = y;
    }

    function closeEditor() {
        if (!activeEditor) return;
        activeEditor.node.remove();
        rows.find(row => row.key === activeEditor.key)?.node.querySelector('.edit_existing_regex').setAttribute('aria-expanded', 'false');
        activeEditor = null;
        newEditor.hidden = true;
    }

    async function editSection(action, id) {
        const draft = layout();
        const section = draft.sections.find(item => item.id === id);
        if (action !== 'new-section' && !section) return;
        if (action === 'new-section' || action === 'rename-section') {
            const answer = await callGenericPopup(action === 'new-section' ? 'New regex section' : 'Rename regex section', POPUP_TYPE.INPUT, section?.name ?? '');
            const name = typeof answer === 'string' ? answer.trim() : '';
            if (!name || name === section?.name) return;
            if (name.toLocaleLowerCase() === 'ungrouped' || draft.sections.some(item => item !== section && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
                toastr.warning('A section with that name already exists.');
                return;
            }
            draft.sections = section
                ? draft.sections.map(item => item === section ? { ...item, name } : item)
                : [...draft.sections, { id: uuidv4(), name }];
            if (!section) {
                view = 'sections';
                search.value = '';
            }
        } else if (action === 'remove-section') {
            draft.sections = draft.sections.filter(item => item !== section);
            draft.assignments = Object.fromEntries(Object.entries(draft.assignments).filter(([, sectionId]) => sectionId !== id));
            collapsed.delete(id);
        } else {
            const index = draft.sections.indexOf(section);
            const target = index + (action === 'section-up' ? -1 : 1);
            if (target < 0 || target >= draft.sections.length) return;
            draft.sections = [...draft.sections];
            [draft.sections[index], draft.sections[target]] = [draft.sections[target], draft.sections[index]];
        }
        saveLayout(draft);
        render();
    }

    root.addEventListener('click', async event => {
        if (!(event.target instanceof HTMLElement)) return;
        const button = event.target.closest('button');
        const section = button?.closest('.chlo-regex-section');
        const rowNode = button?.closest('.regex-script-label');
        const action = button?.dataset.regexAction;
        if (button?.closest('.chlo-regex-menu-items, .chlo-regex-section-actions')) {
            const details = button.closest('details');
            details.open = false;
            if (document.activeElement === button) details.querySelector('summary')?.focus();
        }
        if (button?.dataset.regexScope || button?.dataset.regexView) {
            const nextScope = button.dataset.regexScope ?? scope;
            const nextView = button.dataset.regexView ?? view;
            if (nextScope === scope && nextView === view) return;
            scope = nextScope;
            view = nextView;
            if (activeEditor && scope !== 'all' && scope !== activeEditor.scope) closeEditor();
            scroll.scrollTop = 0;
            render();
        } else if (button?.classList.contains('chlo-regex-section-toggle') && section) {
            const list = section.querySelector('.chlo-regex-section-rows');
            list.hidden = !list.hidden;
            button.setAttribute('aria-expanded', String(!list.hidden));
            if (list.hidden) collapsed.add(section.dataset.sectionId);
            else collapsed.delete(section.dataset.sectionId);
            updateBulk();
        } else if (button?.classList.contains('chlo-regex-row-tools') && rowNode) {
            const row = rows.find(item => item.node === rowNode);
            if (row) setRowTools(row, row.node.querySelector('.chlo-regex-row-actions').hidden);
        } else if (action === 'close') {
            toggleDrawer();
        } else if (action === 'new-section' || section && ['rename-section', 'section-up', 'section-down', 'remove-section'].includes(action)) {
            await editSection(action, section?.dataset.sectionId);
        } else if (action === 'bulk') {
            const input = $('#regex_bulk_edit');
            input.checked = !input.checked;
            button.setAttribute('aria-pressed', String(input.checked));
            if (!input.checked) selectedRows().forEach(({ node }) => { node.querySelector('.regex_bulk_checkbox').checked = false; });
            updateBulk();
        } else if (action === 'presets') {
            const presets = $('#regex_presets_block');
            presets.hidden = !presets.hidden;
            button.setAttribute('aria-expanded', String(!presets.hidden));
        } else if (view === 'order' && rowNode && ['script-up', 'script-down'].includes(action)) {
            const row = rows.find(item => item.node === rowNode);
            if (row) await moveRule(row.scope, row.id, action === 'script-up' ? -1 : 1);
        }
    });
    root.addEventListener('change', event => {
        if (!(event.target instanceof HTMLSelectElement) || !event.target.matches('.chlo-regex-section-select')) return;
        const row = rows.find(item => item.node.contains(event.target));
        if (!row) return;
        const draft = layout();
        const id = event.target.value;
        draft.assignments = { ...draft.assignments };
        if (id) {
            draft.assignments[row.key] = id;
            collapsed.delete(id);
        } else delete draft.assignments[row.key];
        saveLayout(draft);
        setRowTools(row, false);
        render();
        row.node.querySelector('.chlo-regex-row-tools').focus({ preventScroll: true });
    });
    search.addEventListener('input', render);
    document.addEventListener('click', event => {
        if (!(event.target instanceof HTMLElement)) return;
        const current = event.target.closest('.chlo-regex-menu, .chlo-regex-section-tools');
        for (const el of $$('details[open].chlo-regex-menu, details[open].chlo-regex-section-tools')) {
            if (el !== current) el.open = false;
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !panel.classList.contains('openDrawer') || document.querySelector('dialog[open]')) return;
        const menu = $('details[open].chlo-regex-menu, details[open].chlo-regex-section-tools');
        if (menu) {
            menu.open = false;
            menu.querySelector('summary')?.focus();
        } else {
            toggleDrawer();
        }
    });
    new MutationObserver(() => {
        const open = panel.classList.contains('openDrawer');
        document.querySelector('#regex-drawer-button > .drawer-toggle')?.setAttribute('aria-expanded', String(open));
        if (open && chat) {
            resizeDrawer();
            chatSize.observe(chat, { box: 'border-box' });
            chatPosition.observe(chat, { attributes: true, attributeFilter: ['class', 'style'] });
            window.addEventListener('resize', resizeDrawer);
        } else {
            closeMenus();
            chatSize.disconnect();
            chatPosition.disconnect();
            window.removeEventListener('resize', resizeDrawer);
        }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });

    return {
        update(newRows, nextPermissions) {
            const selection = new Set(selectedRows().map(row => row.key));
            for (const old of rows) {
                old.node.querySelector('.edit_existing_regex').setAttribute('aria-expanded', 'false');
                old.node.remove();
            }
            rows = newRows.map(row => ({ ...row, key: key(row.scope, row.id) }));
            permissions = nextPermissions;
            if (activeEditor && (activeEditor.owner !== permissions.owners[activeEditor.scope]
                || (activeEditor.key && !rows.some(row => row.key === activeEditor.key)))) closeEditor();
            for (const row of rows) {
                if (selection.has(row.key)) row.node.querySelector('.regex_bulk_checkbox').checked = true;
            }
            render();
        },
        openEditor(node, editScope, id, onSave) {
            const editKey = id ? key(editScope, id) : null;
            const same = Boolean(editKey && activeEditor?.key === editKey);
            closeEditor();
            if (same) return;
            if (editScope !== scope && (scope !== 'all' || !id)) {
                scope = editScope;
                render();
            }
            const editorScope = permissions.owners[editScope];
            const editor = document.createElement('form');
            editor.className = 'chlo-regex-inline-editor';
            const actions = document.createElement('div');
            actions.className = 'chlo-regex-editor-actions';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.textContent = 'Cancel';
            const save = document.createElement('button');
            save.type = 'submit';
            save.className = 'chlo-regex-new';
            save.textContent = 'Save script';
            actions.append(cancel, save);
            editor.append(node, actions);
            activeEditor = { key: editKey, scope: editScope, owner: editorScope, node: editor };
            const refocus = () => {
                const trigger = rows.find(row => row.key === editKey)?.node.querySelector('.edit_existing_regex') ?? $('.chlo-regex-new');
                if (editKey) trigger?.scrollIntoView({ block: 'nearest' });
                trigger?.focus({ preventScroll: true });
            };
            cancel.addEventListener('click', () => {
                closeEditor();
                refocus();
            });
            editor.addEventListener('submit', async event => {
                event.preventDefault();
                if (save.disabled || permissions.owners[editScope] !== editorScope) return;
                save.disabled = true;
                try {
                    if (await onSave() && activeEditor?.node === editor) {
                        closeEditor();
                        refocus();
                    }
                } finally {
                    save.disabled = false;
                }
            });
            attachEditor();
            editor.querySelector('input:not([type="checkbox"])')?.focus({ preventScroll: true });
            editor.scrollIntoView({ block: 'nearest' });
        },
        getSelection: selectedRows,
        getVisibleRows: () => rows.filter(row => row.node.isConnected && !row.node.closest('[hidden]')),
        moveSection(fromScope, toScope, id) {
            const draft = layout();
            const idFrom = key(fromScope, id);
            if (!draft.assignments[idFrom]) return;
            draft.assignments = { ...draft.assignments, [key(toScope, id)]: draft.assignments[idFrom] };
            delete draft.assignments[idFrom];
            saveLayout(draft);
        },
        forgetSection(scriptScope, id) {
            const draft = layout();
            const rowKey = key(scriptScope, id);
            if (!draft.assignments[rowKey]) return;
            draft.assignments = { ...draft.assignments };
            delete draft.assignments[rowKey];
            saveLayout(draft);
        },
    };
}

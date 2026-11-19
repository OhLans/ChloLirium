import { Popup } from '../../popup.js';
import { escapeHtml } from '../../utils.js';
import { applyPromptSections, insertPromptSection, organizePrompt, promptEditorGroups, promptSectionDefinitions } from './presentation.js';
import { chooseSectionForSplit, editPromptSections } from './sections.js';

export const inPromptWorkspace = manager => Boolean(manager.containerElement?.closest('#left-nav-panel.chlo-preset-panel'));

function formSnapshot(manager) {
    const values = {};
    manager.updatePromptWithPromptEditForm(values);
    return JSON.stringify(values);
}

export async function confirmPromptSwitch(manager) {
    if (!manager || !inPromptWorkspace(manager) || !manager.workspaceFormSnapshot || manager.workspaceFormSnapshot === formSnapshot(manager)) return true;
    return Boolean(await Popup.show.confirm('Discard unsaved block changes?', 'Save the block first to keep your text, or discard these edits to continue.'));
}

export function promptEditorLoaded(manager, prompt) {
    if (!inPromptWorkspace(manager)) return;
    manager.workspaceSelectedId = prompt.identifier;
    manager.workspaceFormSnapshot = formSnapshot(manager);
    document.querySelectorAll('#completion_prompt_manager_list [data-pm-identifier]').forEach(row => row.classList.toggle('chlo-block-selected', row.dataset.pmIdentifier === prompt.identifier));
    const popup = document.getElementById('completion_prompt_manager_popup');
    popup.querySelector('.chlo-block-heading')?.remove();
    const heading = document.createElement('h3');
    heading.className = 'chlo-block-heading';
    heading.textContent = prompt.name || 'New block';
    popup.querySelector('#completion_prompt_manager_popup_entry_form_prompt').closest('form').prepend(heading);
    const save = popup.querySelector('#completion_prompt_manager_popup_entry_form_save');
    if (!save.querySelector('.chlo-block-action-label')) save.insertAdjacentHTML('beforeend', '<span class="chlo-block-action-label">Save block</span>');
    const close = popup.querySelector('#completion_prompt_manager_popup_entry_form_close');
    if (!close.querySelector('.chlo-block-action-label')) close.insertAdjacentHTML('beforeend', '<span class="chlo-block-action-label">Close editor</span>');
    for (const button of [save, close]) {
        if (button.hasAttribute('tabindex')) continue;
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
        });
    }
}

export function filterPromptWorkspace(manager) {
    const query = (manager.workspaceSearch ?? '').toLocaleLowerCase().trim();
    const collapsed = new Set(manager.workspaceCollapsed ?? []);
    const list = manager.listElement;
    if ($(list).data('ui-sortable')) $(list).sortable('option', 'disabled', Boolean(query));
    const help = document.querySelector('#chlo-preset-editor-header .chlo-prompt-view-help');
    if (help) help.textContent = query ? 'Clear the search to drag blocks.' : list.dataset.editorView === 'grouped' ? 'Drag a block by its ⠿ handle to arrange this editor. Sending order is unchanged.' : 'Drag to change the actual sending order. In-chat blocks use their depth.';
    let shown = 0;
    const visibleGroups = new Set();
    for (const row of list.querySelectorAll('[data-pm-identifier]')) {
        const prompt = query ? manager.getPromptById(row.dataset.pmIdentifier) : null;
        const matches = !query || `${prompt?.name ?? ''}\n${prompt?.content ?? ''}`.toLocaleLowerCase().includes(query);
        row.hidden = !matches || (list.dataset.editorView === 'grouped' && !query && collapsed.has(row.dataset.editorGroup));
        if (!row.hidden) {
            shown++;
            visibleGroups.add(row.dataset.editorGroup);
        }
    }
    for (const heading of list.querySelectorAll('[data-pm-group]')) {
        const group = heading.dataset.pmGroup;
        heading.hidden = Boolean(query) && !visibleGroups.has(group);
        heading.querySelector('button')?.setAttribute('aria-expanded', String(Boolean(query) || !collapsed.has(group)));
    }
    list.parentElement.querySelector('.chlo-block-empty')?.remove();
    if (query && !shown) list.insertAdjacentHTML('afterend', '<p class="chlo-block-empty">No matching blocks.</p>');
}

export function mountPromptWorkspace(manager) {
    if (!inPromptWorkspace(manager)) return;
    const list = manager.listElement;
    const header = document.getElementById('chlo-preset-editor-header');
    const search = header.querySelector('.chlo-block-search');
    const toolsButton = header.querySelector('.chlo-prompt-tools-button');
    const tools = header.querySelector('.chlo-prompt-list-tools');
    const closeTools = () => { if (toolsButton.getAttribute('aria-expanded') === 'true') toolsButton.click(); };
    const commitLayout = layout => {
        manager.serviceSettings.chlo_preset = { ...manager.serviceSettings.chlo_preset, editor_layout: layout };
        manager.saveServiceSettings();
        manager.render(false);
    };
    if (search.value !== (manager.workspaceSearch ?? '')) search.value = manager.workspaceSearch ?? '';
    search.oninput = () => { manager.workspaceSearch = search.value; filterPromptWorkspace(manager); };
    header.querySelector('.chlo-add-block').onclick = event => { closeTools(); manager.handleNewPrompt(event); };

    const view = list.dataset.editorView;
    header.querySelector('.chlo-prompt-active-view').hidden = view !== 'order';
    tools.innerHTML = `<div class="chlo-prompt-view-buttons" role="group" aria-label="Prompt list view">
            <button type="button" class="menu_button" data-pm-view="grouped" aria-pressed="${view === 'grouped'}">Editor layout</button>
            <button type="button" class="menu_button" data-pm-view="order" aria-pressed="${view === 'order'}">Sending order</button>
        </div>
        <small class="chlo-prompt-view-help"></small>
        <div class="chlo-section-tools" ${view === 'grouped' ? '' : 'hidden'}>
            <label class="chlo-organize-toggle"><input type="checkbox" ${manager.workspaceOrganize ? 'checked' : ''}> Show group controls</label>
            <button type="button" class="menu_button chlo-manage-sections">Manage sections</button>
        </div>`;
    tools.querySelectorAll('[data-pm-view]').forEach(button => button.addEventListener('click', () => {
        closeTools();
        toolsButton.focus({ preventScroll: true });
        if (button.dataset.pmView === view) return;
        manager.promptEditorView = button.dataset.pmView;
        manager.render(false);
    }));
    tools.querySelector('input[type="checkbox"]').addEventListener('change', event => {
        manager.workspaceOrganize = event.target.checked;
        list.classList.toggle('chlo-organizing', manager.workspaceOrganize);
        closeTools();
        toolsButton.focus({ preventScroll: true });
    });
    tools.querySelector('.chlo-manage-sections').addEventListener('click', async () => {
        closeTools();
        const preset = manager.serviceSettings.preset_settings_openai;
        const sections = await editPromptSections(manager.serviceSettings.chlo_preset?.editor_layout);
        if (sections && preset === manager.serviceSettings.preset_settings_openai) {
            commitLayout(applyPromptSections(manager.serviceSettings.chlo_preset?.editor_layout, sections));
        }
        toolsButton.focus({ preventScroll: true });
    });

    const stats = manager.containerElement.querySelector('.completion_prompt_manager_header');
    if (stats) tools.prepend(stats);
    const footer = manager.containerElement.querySelector('.completion_prompt_manager_footer');
    if (footer) {
        const available = document.createElement('details');
        available.className = 'chlo-available-blocks';
        available.innerHTML = '<summary>Available blocks & tools</summary>';
        available.append(footer);
        tools.append(available);
    }
    const layout = manager.serviceSettings.chlo_preset?.editor_layout;
    const groups = promptEditorGroups(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), layout);
    const groupForPrompt = new Map(groups.flatMap(group => group.prompts.map(prompt => [prompt.identifier, group.id])));
    const sections = promptSectionDefinitions(layout);
    list.classList.toggle('chlo-organizing', Boolean(manager.workspaceOrganize));
    const insertAbove = async identifier => {
        const preset = manager.serviceSettings.preset_settings_openai;
        const group = groups.find(item => item.id === groupForPrompt.get(identifier));
        const index = group?.prompts.findIndex(prompt => prompt.identifier === identifier) ?? -1;
        if (index < 0) return;
        const emptySections = sections.filter(item => item.removable && !groups.find(group => group.id === item.id)?.prompts.length);
        const choice = await chooseSectionForSplit({
            anchor: group.prompts[index].name || 'This block',
            source: group.label,
            count: group.prompts.length - index,
            sections,
            emptySections,
        });
        if (!choice || preset !== manager.serviceSettings.preset_settings_openai || !inPromptWorkspace(manager)) return;
        const next = insertPromptSection(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), manager.serviceSettings.chlo_preset?.editor_layout, identifier, choice);
        if (!next) return;
        manager.workspaceCollapsed = manager.workspaceCollapsed?.filter(id => id !== choice.id) ?? [];
        commitLayout(next);
    };
    for (const row of list.querySelectorAll('[data-pm-identifier]')) {
        const identifier = row.dataset.pmIdentifier;
        row.dataset.editorGroup = groupForPrompt.get(identifier) ?? 'instructions';
        row.classList.toggle('chlo-block-selected', identifier === manager.workspaceSelectedId);
        const handle = row.querySelector('.drag-handle');
        const name = manager.getPromptById(identifier)?.name ?? identifier;
        if (list.dataset.editorView === 'grouped') {
            handle.tabIndex = 0;
            handle.setAttribute('role', 'button');
            handle.setAttribute('aria-label', `Move ${name} in editor; use Up or Down arrow keys`);
            handle.addEventListener('keydown', event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                event.stopPropagation();
                commitLayout(organizePrompt(manager.getPromptsForCharacter(manager.activeCharacter), manager.serviceSettings.chlo_preset?.editor_layout, identifier, { direction: event.key === 'ArrowUp' ? 'up' : 'down' }));
            });
        }
        const controls = document.createElement('div');
        controls.className = 'chlo-block-organization';
        controls.innerHTML = `<label>Editor group<select aria-label="Editor group for ${escapeHtml(name)}">${sections.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === row.dataset.editorGroup ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label><div><button type="button" class="menu_button" data-editor-move="up" aria-label="Move up in editor">↑</button><button type="button" class="menu_button" data-editor-move="down" aria-label="Move down in editor">↓</button><button type="button" class="menu_button chlo-insert-section" title="Insert section above this block" aria-label="Insert section above this block">+ Section above</button></div>`;
        controls.querySelector('select').addEventListener('change', event => commitLayout(organizePrompt(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), manager.serviceSettings.chlo_preset?.editor_layout, identifier, { group: event.target.value })));
        controls.querySelectorAll('[data-editor-move]').forEach(button => button.addEventListener('click', () => commitLayout(organizePrompt(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), manager.serviceSettings.chlo_preset?.editor_layout, identifier, { direction: button.dataset.editorMove }))));
        const insert = controls.querySelector('.chlo-insert-section');
        insert.addEventListener('click', () => insertAbove(identifier));
        insert.addEventListener('keydown', event => { if (event.key === 'Enter') event.stopPropagation(); });
        row.append(controls);
    }
    for (const heading of list.querySelectorAll('[data-pm-group]')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.innerHTML = `<span aria-hidden="true">⌄</span> ${heading.innerHTML}`;
        heading.replaceChildren(button);
        button.addEventListener('click', () => {
            const collapsed = new Set(manager.workspaceCollapsed ?? []);
            if (collapsed.has(heading.dataset.pmGroup)) collapsed.delete(heading.dataset.pmGroup);
            else collapsed.add(heading.dataset.pmGroup);
            manager.workspaceCollapsed = [...collapsed];
            filterPromptWorkspace(manager);
        });
    }
    filterPromptWorkspace(manager);
}

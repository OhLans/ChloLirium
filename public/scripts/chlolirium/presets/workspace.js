import { Popup } from '../../popup.js';
import { escapeHtml } from '../../utils.js';
import { organizePrompt, promptEditorGroups } from './presentation.js';

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
    const help = manager.containerElement.querySelector('.chlo-prompt-view-help');
    if (help) help.textContent = query ? 'Clear the search to drag blocks.' : list.dataset.editorView === 'grouped' ? 'Drag a block by its ⠿ handle to arrange this editor. Sending order is unchanged.' : 'Drag to change the actual sending order. In-chat blocks use their depth.';
    let shown = 0;
    for (const row of list.querySelectorAll('[data-pm-identifier]')) {
        const prompt = manager.getPromptById(row.dataset.pmIdentifier);
        const matches = !query || `${prompt?.name ?? ''}\n${prompt?.content ?? ''}`.toLocaleLowerCase().includes(query);
        row.hidden = !matches || (list.dataset.editorView === 'grouped' && !query && collapsed.has(row.dataset.editorGroup));
        if (!row.hidden) shown++;
    }
    for (const heading of list.querySelectorAll('[data-pm-group]')) {
        const group = heading.dataset.pmGroup;
        heading.hidden = Boolean(query) && ![...list.querySelectorAll('[data-pm-identifier]')].some(row => row.dataset.editorGroup === group && !row.hidden);
        heading.querySelector('button')?.setAttribute('aria-expanded', String(Boolean(query) || !collapsed.has(group)));
    }
    list.parentElement.querySelector('.chlo-block-empty')?.remove();
    if (query && !shown) list.insertAdjacentHTML('afterend', '<p class="chlo-block-empty">No matching blocks.</p>');
}

export function mountPromptWorkspace(manager) {
    if (!inPromptWorkspace(manager)) return;
    const list = manager.listElement;
    const footer = manager.containerElement.querySelector('.completion_prompt_manager_footer');
    if (footer && !footer.closest('.chlo-available-blocks')) {
        const available = document.createElement('details');
        available.className = 'chlo-available-blocks';
        available.innerHTML = '<summary>Available blocks & tools</summary>';
        footer.before(available);
        available.append(footer);
    }
    const groups = promptEditorGroups(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), manager.serviceSettings.chlo_preset?.editor_layout);
    const toolbar = document.createElement('div');
    toolbar.className = 'chlo-block-tools';
    toolbar.innerHTML = `<div class="chlo-block-search"><input type="search" class="text_pole" aria-label="Find a block" placeholder="Find a block…" value="${escapeHtml(manager.workspaceSearch ?? '')}"><button type="button" class="menu_button chlo-add-block">＋ Add block</button></div>
        <label class="chlo-organize-toggle"><input type="checkbox" ${manager.workspaceOrganize ? 'checked' : ''}> Show group controls</label>`;
    const view = list.parentElement.querySelector('.chlo-prompt-view');
    const navigation = document.createElement('div');
    navigation.className = 'chlo-block-navigation';
    const scroller = document.createElement('div');
    scroller.className = 'chlo-block-scroller';
    // Keep the native header, tools and view controls outside the row scrollport.
    const frame = list.parentElement;
    navigation.append(...[...frame.children].filter(child => child !== list && child !== view), toolbar, view);
    frame.prepend(navigation);
    list.before(scroller);
    scroller.append(list);
    toolbar.querySelector('input[type="search"]').addEventListener('input', event => { manager.workspaceSearch = event.target.value; filterPromptWorkspace(manager); });
    toolbar.querySelector('.chlo-add-block').addEventListener('click', manager.handleNewPrompt);
    toolbar.querySelector('[type="checkbox"]').addEventListener('change', event => { manager.workspaceOrganize = event.target.checked; list.classList.toggle('chlo-organizing', manager.workspaceOrganize); });
    toolbar.querySelector('.chlo-organize-toggle').hidden = list.dataset.editorView !== 'grouped';
    list.classList.toggle('chlo-organizing', Boolean(manager.workspaceOrganize));
    const commitLayout = layout => {
        manager.serviceSettings.chlo_preset = { ...manager.serviceSettings.chlo_preset, editor_layout: layout };
        manager.saveServiceSettings();
        manager.render(false);
    };
    for (const row of list.querySelectorAll('[data-pm-identifier]')) {
        const identifier = row.dataset.pmIdentifier;
        const group = groups.find(item => item.prompts.some(prompt => prompt.identifier === identifier));
        row.dataset.editorGroup = group?.id ?? 'instructions';
        row.classList.toggle('chlo-block-selected', identifier === manager.workspaceSelectedId);
        const handle = row.querySelector('.drag-handle');
        if (list.dataset.editorView === 'grouped') {
            handle.tabIndex = 0;
            handle.setAttribute('role', 'button');
            handle.setAttribute('aria-label', `Move ${manager.getPromptById(identifier)?.name ?? identifier} in editor; use Up or Down arrow keys`);
            handle.addEventListener('keydown', event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                event.stopPropagation();
                commitLayout(organizePrompt(manager.getPromptsForCharacter(manager.activeCharacter), manager.serviceSettings.chlo_preset?.editor_layout, identifier, { direction: event.key === 'ArrowUp' ? 'up' : 'down' }));
            });
        }
        const controls = document.createElement('div');
        controls.className = 'chlo-block-organization';
        controls.innerHTML = `<label>Editor group<select aria-label="Editor group for ${escapeHtml(manager.getPromptById(identifier)?.name ?? identifier)}">${groups.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === group?.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}${groups.some(item => item.id === 'context') ? '' : '<option value="context">Context & structure</option>'}${groups.some(item => item.id === 'instructions') ? '' : '<option value="instructions">Instructions</option>'}</select></label><div><button type="button" class="menu_button" data-editor-move="up" aria-label="Move up in editor">↑</button><button type="button" class="menu_button" data-editor-move="down" aria-label="Move down in editor">↓</button></div>`;
        controls.querySelector('select').addEventListener('change', event => commitLayout(organizePrompt(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), manager.serviceSettings.chlo_preset?.editor_layout, identifier, { group: event.target.value })));
        controls.querySelectorAll('[data-editor-move]').forEach(button => button.addEventListener('click', () => commitLayout(organizePrompt(manager.getPromptsForCharacter(manager.activeCharacter).filter(Boolean), manager.serviceSettings.chlo_preset?.editor_layout, identifier, { direction: button.dataset.editorMove }))));
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

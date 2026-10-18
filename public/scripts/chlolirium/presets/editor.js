import { promptManager } from '../../openai.js';
import { debounce } from '../../utils.js';
import { blockCategory, getBlocks, getOrder } from './model.js';
import { button, esc, icon } from './library.js';

const triggerOptions = ['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'];

export class BlockEditor {
    constructor(workspace) {
        this.workspace = workspace;
        this.selected = null;
        this.refreshPreview = debounce(() => this.updatePreview(), 200);
    }

    block() {
        return getBlocks(this.workspace.draft).find(({ prompt }) => prompt.identifier === this.selected);
    }

    render() {
        const blocks = getBlocks(this.workspace.draft);
        if (!blocks.some(({ prompt }) => prompt.identifier === this.selected)) this.selected = blocks[0]?.prompt.identifier;
        this.renderList();
        this.renderForm();
    }

    renderList() {
        const w = this.workspace;
        const search = w.root.querySelector('#pw-block-search').value.toLocaleLowerCase();
        const blocks = getBlocks(w.draft);
        let previousCategory;
        w.root.querySelector('#pw-block-list').innerHTML = blocks.map(({ prompt, entry }, index) => {
            if (!`${prompt.name} ${prompt.content}`.toLocaleLowerCase().includes(search)) return '';
            const category = blockCategory(prompt, !!entry);
            const heading = category !== previousCategory ? `<h4>${esc(category)}</h4>` : '';
            previousCategory = category;
            const toggle = promptManager.isPromptToggleAllowed(prompt);
            return `${heading}<div class="pw-block-row ${prompt.identifier === this.selected ? 'pw-selected' : ''}">
                <input type="checkbox" data-enable-block="${esc(prompt.identifier)}" aria-label="Enable ${esc(prompt.name)}" ${entry?.enabled ? 'checked' : ''} ${toggle ? '' : 'disabled'}>
                <button type="button" data-block="${esc(prompt.identifier)}" aria-pressed="${prompt.identifier === this.selected}"><span class="pw-block-index">${entry ? index + 1 : '—'}</span><span>${esc(prompt.name || prompt.identifier)}</span>${prompt.marker ? icon('bookmark') : ''}</button>
            </div>`;
        }).join('') || '<p class="pw-empty">No matching blocks.</p>';
    }

    renderForm() {
        const w = this.workspace;
        const host = w.root.querySelector('#pw-block-editor');
        const block = this.block();
        if (!block) {
            host.innerHTML = '<p class="pw-empty">Add a block to begin writing your preset.</p>';
            return;
        }
        const { prompt, entry } = block;
        const canEdit = promptManager.isPromptEditAllowed(prompt);
        const attached = !!entry;
        const selectOptions = (values, current) => values.map(([value, title]) => `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${title}</option>`).join('');
        host.innerHTML = `<div class="pw-block-heading"><h3>${esc(prompt.name || prompt.identifier)}</h3><label class="pw-enable"><input type="checkbox" data-enable-block="${esc(prompt.identifier)}" ${entry?.enabled ? 'checked' : ''} ${promptManager.isPromptToggleAllowed(prompt) ? '' : 'disabled'}> Enabled</label></div>
            <div class="pw-field-grid"><label>Block name<input data-field="name" value="${esc(prompt.name)}"></label><label>Category<input data-field="chlo_category" value="${esc(blockCategory(prompt, attached))}" list="pw-categories"></label></div>
            <datalist id="pw-categories">${[...new Set(getBlocks(w.draft).map(block => blockCategory(block.prompt)))].map(category => `<option value="${esc(category)}"></option>`).join('')}</datalist>
            <div class="pw-field-grid"><label>Role<select data-field="role" ${canEdit ? '' : 'disabled'}>${selectOptions([['system', 'System'], ['user', 'User'], ['assistant', 'Assistant']], prompt.role || 'system')}</select></label><label>Placement<select data-field="injection_position" ${canEdit ? '' : 'disabled'}>${selectOptions([[0, 'In prompt order'], [1, 'At chat depth']], prompt.injection_position ?? 0)}</select></label></div>
            ${canEdit ? `<label class="pw-instructions">Instructions<textarea id="pw-content" data-field="content" rows="12" spellcheck="false">${esc(prompt.content)}</textarea></label>
            <div class="pw-macro-row"><span class="pw-muted">Insert macro</span>${['{{char}}', '{{user}}', '{{persona}}', '{{original}}'].map(macro => `<button type="button" data-macro="${macro}">${macro}</button>`).join('')}</div>` : '<div class="pw-marker-note"><h4>Live context block</h4><p>SillyTavern fills this block from the current chat. Its native marker stays intact when you save or reorder it.</p></div>'}
            <details class="pw-advanced"><summary>Conditions & placement</summary><div class="pw-field-grid"><label>Chat depth<input type="number" data-field="injection_depth" min="0" max="9999" value="${esc(prompt.injection_depth ?? 4)}"></label><label>Order at this depth<input type="number" data-field="injection_order" min="0" max="9999" value="${esc(prompt.injection_order ?? 100)}"></label></div>
            <label class="pw-enable"><input type="checkbox" data-field="forbid_overrides" ${prompt.forbid_overrides ? 'checked' : ''}> Prevent character overrides</label>
            <p class="pw-muted">Generate for these actions. Leave all unchecked to use every action.</p><div class="pw-triggers">${triggerOptions.map(value => `<label><input type="checkbox" data-trigger="${value}" ${prompt.injection_trigger?.includes(value) ? 'checked' : ''}>${value}</label>`).join('')}</div></details>
            <div class="pw-block-actions">${button('move-up', `${icon('arrow-up')} Move up`)}${button('move-down', `${icon('arrow-down')} Move down`)}<span class="pw-spacer"></span>${promptManager.isPromptDeletionAllowed(prompt) ? button('delete-block', `${icon('trash')} Delete block`) : '<span class="pw-muted">Built-in block</span>'}</div>
            <details class="pw-preview"><summary>${icon('eye')} Prompt text preview</summary><p class="pw-muted">Enabled blocks in prompt order. Live markers, lorebook retrieval, and macros are resolved by SillyTavern for each generation.</p><pre></pre></details>
            <details class="pw-preset-metadata"><summary>Preset details & cover</summary><label>Description<textarea data-meta="description" rows="2">${esc(w.draft.chlo_preset?.description)}</textarea></label><div class="pw-detail-actions">${button('cover', 'Choose cover')}${button('remove-cover', 'Remove cover')}</div></details>`;
        this.updatePreview();
    }

    updatePreview() {
        const pre = this.workspace.root.querySelector('.pw-preview pre');
        if (!pre || !pre.parentElement.open) return;
        pre.textContent = getBlocks(this.workspace.draft).filter(block => block.entry?.enabled)
            .map(({ prompt }) => `[${prompt.role || 'system'} · ${prompt.name || prompt.identifier}${prompt.injection_position === 1 ? ` · depth ${prompt.injection_depth ?? 4}` : ''}]\n${prompt.marker ? '(Live context marker)' : prompt.content || ''}`).join('\n\n');
    }

    enable(identifier, enabled) {
        const w = this.workspace;
        const block = getBlocks(w.draft).find(block => block.prompt.identifier === identifier);
        if (!block || !promptManager.isPromptToggleAllowed(block.prompt)) return;
        if (!block.entry) getOrder(w.draft).push({ identifier, enabled });
        else block.entry.enabled = enabled;
        w.markDirty();
        this.renderList();
        const checkbox = w.root.querySelector('#pw-block-editor [data-enable-block]');
        if (checkbox?.dataset.enableBlock === identifier) checkbox.checked = enabled;
        this.updatePreview();
    }

    move(direction) {
        const order = getOrder(this.workspace.draft);
        const index = order.findIndex(entry => entry.identifier === this.selected);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        this.workspace.markDirty();
        this.renderList();
        this.updatePreview();
    }

    input(target) {
        const w = this.workspace;
        const block = this.block();
        if (!block) return;
        if (target.dataset.field) {
            if (!target.checkValidity()) return;
            const field = target.dataset.field;
            block.prompt[field] = target.type === 'checkbox' ? target.checked
                : ['injection_depth', 'injection_order', 'injection_position'].includes(field) ? Number(target.value) : target.value;
            if (['name', 'chlo_category'].includes(field)) {
                this.renderList();
                w.root.querySelector('.pw-block-heading h3').textContent = block.prompt.name;
            }
        } else if (target.dataset.trigger) {
            const selected = new Set([...w.root.querySelectorAll('[data-trigger]:checked')].map(input => input.dataset.trigger));
            // Preserve any generation triggers introduced by other extensions.
            block.prompt.injection_trigger = [...(block.prompt.injection_trigger ?? []).filter(value => !triggerOptions.includes(value)), ...selected];
        } else if (target.dataset.meta) {
            (w.draft.chlo_preset ??= {})[target.dataset.meta] = target.value;
        } else return;
        w.markDirty();
        this.refreshPreview();
    }
}

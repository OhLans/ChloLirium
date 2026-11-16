import { eventSource, event_types, getCurrentChatId, main_api, name2 } from '../../../script.js';
import { oai_settings, promptManager } from '../../openai.js';
import { PromptOutline } from './workspace-outline.js';
import { WorkspaceForm } from './workspace-form.js';
import { createInsertPicker } from './workspace-insert.js';

let workspace;
export const isPresetWorkspaceOpen = () => Boolean(workspace?.dialog.open);
export function closePresetWorkspace() {
    if (!workspace) return;
    workspace.dialog.close();
    // Dialog close events are queued. Restore before tab removal or an API
    // change can remove the native return anchors in the same task.
    workspace.restore();
}
export async function openPresetWorkspace() {
    if (main_api !== 'openai' || !promptManager || !document.getElementById('left-nav-panel').classList.contains('chlo-preset-panel')) return;
    workspace ??= new PresetWorkspace();
    try { await workspace.open(); } catch (error) {
        closePresetWorkspace();
        console.error('Could not open the preset editor', error);
        toastr.error('Could not open the preset editor. Please try again.');
    }
}

/** Move original nodes into a modal workspace, restoring their exact anchors. */
class PresetWorkspace {
    constructor() {
        this.dialog = document.createElement('dialog');
        this.dialog.id = 'chlo-preset-workspace';
        this.dialog.className = 'popup';
        this.dialog.dataset.promptWorkspace = '';
        this.dialog.setAttribute('aria-label', 'Preset editor');
        this.dialog.innerHTML = `<header class="chlo-workspace-header"><div class="chlo-workspace-heading"><small>PRESET EDITOR</small><div class="chlo-workspace-preset-header"></div></div><button type="button" class="menu_button chlo-workspace-close"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to chat</button></header>
            <div class="chlo-workspace-body"><aside class="chlo-workspace-outline" aria-label="Prompt navigation"><header><div><strong>Prompt order</strong><button type="button" class="menu_button chlo-workspace-add"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add prompt</button></div><label class="sr-only" for="chlo-outline-search">Search prompt names or contents</label><input id="chlo-outline-search" type="search" placeholder="Find a block…" autocomplete="off"><small role="status"></small></header><div class="chlo-workspace-list scrollableInner"></div></aside>
            <section class="chlo-workspace-editor" aria-label="Selected prompt"><div class="chlo-workspace-editor-content"><div class="chlo-workspace-empty"><small>YOUR PROMPT BLOCKS</small><h2>Choose a block</h2><p>Select a prompt in the outline to edit it. Use the + between blocks to add one in place.</p></div></div></section></div>
            <footer class="chlo-workspace-status"><span id="chlo-preset-save-status" role="status">Editing preset</span><span>Save block updates its instructions · Save preset updates the file</span></footer>`;
        document.body.append(this.dialog);
        const perform = task => Promise.resolve().then(task).catch(error => { console.error(error); toastr.error(error.message || 'Could not update the prompt.'); });
        this.outline = new PromptOutline({
            root: this.dialog.querySelector('aside'), manager: () => promptManager,
            select: id => perform(() => this.form.select(id)),
            insert: after => this.picker.open(after),
        });
        this.form = new WorkspaceForm({
            dialog: this.dialog, manager: () => promptManager, outline: this.outline,
            status: this.dialog.querySelector('#chlo-preset-save-status'), empty: this.dialog.querySelector('.chlo-workspace-empty'),
        });
        this.picker = createInsertPicker({
            manager: () => promptManager,
            create: after => perform(() => this.form.create(after)),
            insert: (id, after) => perform(() => this.form.insert(id, after)),
        });
        this.dialog.querySelector('.chlo-workspace-close').addEventListener('click', closePresetWorkspace);
        this.dialog.querySelector('.chlo-workspace-add').addEventListener('click', () => {
            const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
            this.picker.open(order.at(-1)?.identifier ?? null);
        });
        this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.restore(); });
        this.dialog.addEventListener('cancel', event => { event.preventDefault(); closePresetWorkspace(); });
        this.dialog.addEventListener('submit', event => event.preventDefault());
        this.dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape' && this.dialog.querySelector('.select2-container--open, .autoComplete-wrap')) event.preventDefault();
        }, true);
        this.dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
        promptManager.containerElement.addEventListener('prompt-manager-rendered', () => {
            if (!this.dialog.open) return;
            this.outline.decorate();
            this.form.afterRender();
        });
        promptManager.containerElement.addEventListener('click', event => {
            if (!this.dialog.open) return;
            const row = event.target.closest('[data-pm-identifier]');
            if (!row) return;
            if (event.target.closest('.prompt-manager-detach-action')) {
                event.preventDefault();
                event.stopPropagation();
                perform(() => this.form.detach(row.dataset.pmIdentifier));
                return;
            }
            const inspect = event.target.closest('.prompt_manager_prompt_tokens[role=button]');
            if (inspect) {
                event.preventDefault();
                event.stopPropagation();
                perform(() => this.form.select(row.dataset.pmIdentifier, true));
                return;
            }
            const edit = event.target.closest('.completion_prompt_manager_prompt_name, .prompt-manager-edit-action');
            if (edit) {
                event.preventDefault();
                event.stopPropagation();
                perform(() => this.form.select(row.dataset.pmIdentifier));
            }
        }, true);
        this.dialog.addEventListener('click', event => {
            // Update the real block synchronously before the native preset
            // save/rename/save-as handler takes its snapshot.
            if (event.target.closest('#chlo-preset-editor-actions')) this.form.commit();
        }, true);
        eventSource.on(event_types.PROMPT_PRESET_SAVED, () => {
            if (this.dialog.open) { this.form.status.textContent = 'Preset saved'; this.context = oai_settings.preset_settings_openai; }
        });
        eventSource.on(event_types.MAIN_API_CHANGED, () => { if (main_api !== 'openai') closePresetWorkspace(); });
    }

    move(node, target) {
        const anchor = document.createComment('preset workspace return position');
        node.before(anchor);
        this.slots.push({ node, anchor });
        target.append(node);
    }

    async open() {
        if (this.dialog.open) return;
        this.invoker = document.activeElement;
        const chat = document.getElementById('chat');
        this.chatPosition = { node: chat, top: chat?.scrollTop, id: getCurrentChatId(), name: name2 };
        this.slots = [];
        this.move(document.getElementById('chlo-preset-editor-header'), this.dialog.querySelector('.chlo-workspace-preset-header'));
        this.move(promptManager.containerElement, this.dialog.querySelector('.chlo-workspace-list'));
        const popup = document.getElementById('completion_prompt_manager_popup');
        this.move(popup, this.dialog.querySelector('.chlo-workspace-editor-content'));
        this.labels = [
            ['update_oai_preset', 'Save preset'], ['completion_prompt_manager_popup_entry_form_save', 'Save block'],
        ].map(([id, label]) => {
            const node = document.getElementById(id);
            const existing = node.querySelector('.chlo-preset-action-label');
            const span = existing ?? document.createElement('span');
            const previous = span.textContent;
            span.classList.add('chlo-workspace-control-label');
            span.textContent = label;
            if (!existing) node.append(span);
            return { span, existing, previous };
        });
        this.dialog.showModal();
        document.body.classList.add('chlo-preset-workspace-open');
        this.restoreTriggers = this.moveTriggerDropdown(this.dialog);
        const preset = oai_settings.preset_settings_openai;
        const current = this.form.current;
        const retained = this.context === preset && document.getElementById('completion_prompt_manager_popup_entry_form_save').dataset.pmPrompt === current;
        if (!retained) {
            this.form.current = null;
            this.form.snapshot = null;
            this.form.pending = null;
            $(popup).stop(true, true).hide().removeClass('openDrawer');
        }
        if (this.context !== preset) { this.outline.search.value = ''; this.outline.collapsed.clear(); }
        this.context = preset;
        await promptManager.render(false);
        if (!this.dialog.open) return;
        if (retained && this.form.current === current) {
            const snapshot = this.form.snapshot;
            promptManager.showPopup(this.form.mode);
            this.form.snapshot = snapshot;
        } else if (!this.form.current) {
            const first = promptManager.getPromptsForCharacter(promptManager.activeCharacter).find(prompt => promptManager.isPromptEditAllowed(prompt));
            if (first) await this.form.select(first.identifier);
        }
    }

    moveTriggerDropdown(parent) {
        const select = $('#completion_prompt_manager_popup_entry_form_injection_trigger');
        const instance = select.data('select2');
        if (!instance) return () => {};
        const options = instance.options.options;
        select.select2('destroy').select2({ ...options, dropdownParent: $(parent) });
        return () => select.select2('destroy').select2(options);
    }

    restore() {
        if (!this.slots?.length) return;
        this.picker.dialog.close();
        this.outline.clean();
        this.restoreTriggers?.();
        $('#completion_prompt_manager_popup').stop(true, true).hide().removeClass('openDrawer');
        for (const { node, anchor } of this.slots) {
            if (anchor.isConnected) anchor.after(node);
            else document.getElementById('openai_api-presets').append(node);
            anchor.remove();
        }
        for (const { span, existing, previous } of this.labels) {
            if (existing) { span.textContent = previous; span.classList.remove('chlo-workspace-control-label'); } else span.remove();
        }
        this.slots = [];
        document.body.classList.remove('chlo-preset-workspace-open');
        window.ChatCompletionTabs?.openAITabManager?.tabManager?.switchTab('presets');
        const chat = this.chatPosition;
        if (chat?.id === getCurrentChatId() && chat.name === name2 && chat.node) chat.node.scrollTop = chat.top;
        if (this.invoker?.isConnected) this.invoker.focus({ preventScroll: true });
        else document.getElementById('openai-tab-btn-presets')?.focus({ preventScroll: true });
    }
}

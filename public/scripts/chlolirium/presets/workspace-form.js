import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../popup.js';
import { insertPromptAt } from './workspace-insert.js';

const field = name => document.getElementById(`completion_prompt_manager_popup_entry_form_${name}`);

function fingerprint() {
    return JSON.stringify(['name', 'role', 'prompt', 'injection_position', 'injection_depth', 'injection_order', 'injection_trigger', 'forbid_overrides'].map(name => {
        const node = field(name);
        return node.multiple ? [...node.selectedOptions].map(option => option.value) : node.type === 'checkbox' ? node.checked : node.value;
    }));
}

function promptFingerprint(prompt) {
    return JSON.stringify([prompt.name ?? '', prompt.role || 'system', prompt.content ?? '', String(prompt.injection_position ?? 0), String(prompt.injection_depth ?? 4), String(prompt.injection_order ?? 100), prompt.injection_trigger ?? [], Boolean(prompt.forbid_overrides)]);
}

/** Keep the real form mounted. Native Save updates the model without closing it. */
export class WorkspaceForm {
    constructor({ dialog, manager, outline, status, empty }) {
        Object.assign(this, { dialog, manager, outline, status, empty });
        this.current = null;
        this.snapshot = null;
        this.mode = 'edit';
        const container = manager().containerElement;
        container.addEventListener('prompt-manager-opened', event => {
            if (!dialog.open) return;
            this.mode = event.detail.area;
            if (this.mode === 'edit') this.current = field('save').dataset.pmPrompt;
            this.snapshot = fingerprint();
            empty.hidden = true;
            outline.choose(this.current);
        });
        container.addEventListener('prompt-manager-save', event => {
            if (!dialog.open) return;
            event.preventDefault();
            this.current = event.detail.identifier;
            if (event.detail.created && this.pending) {
                try {
                    insertPromptAt(manager(), this.current, this.pending.after);
                    this.reveal = this.current;
                } catch (error) { toastr.error(error.message); }
                this.pending = null;
            }
            this.snapshot = fingerprint();
            status.textContent = 'Block saved';
            outline.choose(this.current);
        });
        container.addEventListener('prompt-manager-before-reset', event => {
            if (!dialog.open) return;
            const prompt = manager().getPromptById(this.current);
            if (this.mode === 'edit' && prompt && promptFingerprint(prompt) === fingerprint()) event.preventDefault();
            else { this.reload = true; this.snapshot = null; this.pending = null; }
        });
        container.addEventListener('prompt-manager-detached', event => {
            if (!dialog.open) return;
            if (event.detail.identifier !== this.current) event.preventDefault();
            else {
                this.current = null;
                this.snapshot = null;
                this.pending = null;
                empty.hidden = false;
                empty.querySelector('h2').textContent = 'Choose a block';
                empty.querySelector('p').textContent = 'Select a prompt in the outline to edit it.';
            }
        });
        const updateStatus = () => {
            if (dialog.open) status.textContent = this.dirty ? 'Unsaved block changes' : 'Editing block';
        };
        for (const event of ['input', 'change']) document.getElementById('completion_prompt_manager_popup').addEventListener(event, updateStatus);
        dialog.addEventListener('keydown', event => {
            const control = event.target.closest('#completion_prompt_manager_popup a.menu_button');
            if (control && ['Enter', ' '].includes(event.key)) { event.preventDefault(); control.click(); }
        });
        for (const id of ['close', 'reset', 'save']) {
            const control = field(id);
            control.setAttribute('role', 'button');
            control.tabIndex = 0;
        }
        field('close').addEventListener('click', () => {
            if (!dialog.open) return;
            this.current = null;
            this.pending = null;
            this.snapshot = null;
            empty.hidden = false;
            outline.choose(null);
        });
    }

    get dirty() { return this.mode === 'edit' && this.snapshot !== null && fingerprint() !== this.snapshot; }

    commit() {
        if (this.mode === 'edit' && field('save').dataset.pmPrompt && (this.dirty || this.pending)) field('save').click();
    }

    async canSwitch(identifier) {
        if (!this.dirty || identifier === this.current) return true;
        const result = await new Popup('Save this block’s changes before opening another block?', POPUP_TYPE.CONFIRM, null, {
            okButton: 'Save block', cancelButton: 'Keep editing',
            customButtons: [{ text: 'Discard changes', result: POPUP_RESULT.CUSTOM1 }],
        }).show();
        if (result === POPUP_RESULT.AFFIRMATIVE) this.commit();
        if (![POPUP_RESULT.AFFIRMATIVE, POPUP_RESULT.CUSTOM1].includes(result)) return false;
        this.pending = null;
        return true;
    }

    async select(identifier, inspect = false) {
        if (!await this.canSwitch(inspect ? null : identifier)) return;
        const manager = this.manager(), prompt = manager.getPromptById(identifier);
        if (!prompt) return;
        if (identifier === this.current && this.mode === 'edit' && !inspect && field('save').dataset.pmPrompt === identifier) return;
        manager.clearEditForm();
        manager.clearInspectForm();
        this.current = identifier;
        this.pending = null;
        this.outline.choose(identifier);
        if (inspect) {
            const row = [...manager.listElement.querySelectorAll('[data-pm-identifier]')].find(row => row.dataset.pmIdentifier === identifier);
            manager.handleInspect({ target: row });
        } else if (manager.isPromptEditAllowed(prompt)) {
            manager.loadPromptIntoEditForm(prompt);
            manager.showPopup();
        } else {
            manager.hidePopup();
            this.mode = 'marker';
            this.empty.hidden = false;
            this.empty.querySelector('h2').textContent = prompt.name;
            this.empty.querySelector('p').textContent = 'This is a content marker. Its content is supplied by SillyTavern. You can move it and use its existing toggle in the prompt list.';
        }
        this.status.textContent = 'Editing preset';
    }

    async create(after) {
        if (!await this.canSwitch(null)) return;
        this.manager().clearEditForm();
        this.manager().clearInspectForm();
        this.pending = { after };
        this.manager().handleNewPrompt();
        this.status.textContent = 'New block · Save block to insert it here';
        field('name').focus();
    }

    async insert(identifier, after) {
        if (!await this.canSwitch(identifier)) return;
        insertPromptAt(this.manager(), identifier, after);
        this.reveal = identifier;
        this.manager().saveServiceSettings();
        await this.manager().render();
        await this.select(identifier);
    }

    async detach(identifier) {
        if (identifier === this.current && !await this.canSwitch(null)) return;
        const row = [...this.manager().listElement.querySelectorAll('[data-pm-identifier]')].find(row => row.dataset.pmIdentifier === identifier);
        if (row) this.manager().handleDetach({ target: row });
    }

    afterRender() {
        this.outline.choose(this.current);
        if (this.reload) {
            this.reload = false;
            const order = this.manager().getPromptOrderForCharacter(this.manager().activeCharacter);
            const id = this.manager().getPromptById(this.current) ? this.current : order[0]?.identifier;
            this.current = null;
            if (id) this.select(id);
        }
        if (this.reveal) {
            // Native render restores its scroll position after emitting the event.
            const id = this.reveal;
            this.reveal = null;
            requestAnimationFrame(() => { if (this.dialog.open) this.outline.reveal(id); });
        }
    }
}

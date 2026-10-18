import { eventSource, event_types, main_api, saveSettings, saveSettingsDebounced } from '../../../script.js';
import { extension_settings } from '../../extensions.js';
import { getChatCompletionPreset, getPresetApplicationPromise, oai_settings, openai_setting_names, openai_settings, promptManager, saveChatCompletionPromptPreset, settingsToUpdate } from '../../openai.js';
import { Popup } from '../../popup.js';
import { renderTemplateAsync } from '../../templates.js';
import { download, uuidv4 } from '../../utils.js';
import { BlockEditor } from './editor.js';
import { PresetLibrary } from './library.js';
import { blockCategory, getBlocks, getOrder, importPromptPreset, promptPresetKeys } from './model.js';
import { SharedParameters } from './parameters.js';

let workspace;

class PresetWorkspace {
    view = 'library';
    selected = null;
    draft = null;
    draftName = null;
    dirty = false;
    busy = false;
    docked = false;
    revision = 0;

    constructor(root) {
        this.root = root;
        // Moonlit's phone layout transforms the page root. A manual popover
        // keeps this non-modal workspace in viewport coordinates, like Emoji.
        if (typeof root.showPopover === 'function') root.popover = 'manual';
        this.preferences = extension_settings.chloPresetLibrary ??= { favorites: [], recent: [] };
        this.preferences.favorites ??= [];
        this.preferences.recent ??= [];
        this.library = new PresetLibrary(this);
        this.editor = new BlockEditor(this);
        this.parameters = new SharedParameters();
        this.resizeObserver = new ResizeObserver(() => this.updateDock());
        this.resizeObserver.observe(root);
        root.addEventListener('click', event => {
            if (event.target.closest('button')) this.run(() => this.click(event));
        });
        root.addEventListener('input', event => {
            if (event.target.id === 'pw-search') this.library.render();
            else if (event.target.id === 'pw-block-search') this.editor.renderList();
            else if (event.target.dataset.enableBlock) this.editor.enable(event.target.dataset.enableBlock, event.target.checked);
            else if (this.view === 'parameters' && this.draftName === this.activeName() && this.draft) {
                // Advanced native formatting controls still belong to the active
                // prompt. Keep its draft in sync without touching generation values.
                for (const [key, [selector, setting]] of Object.entries(settingsToUpdate)) {
                    if (selector && event.target.matches(selector) && promptPresetKeys.has(key)) {
                        this.draft[key] = structuredClone(oai_settings[setting]);
                        this.markDirty();
                    }
                }
            } else if (this.draft) this.editor.input(event.target);
        });
        root.querySelector('#pw-import-file').addEventListener('change', event => this.run(() => this.importFile(event.target)));
        root.querySelector('#pw-cover-file').addEventListener('change', event => this.run(() => this.coverFile(event.target)));
        root.addEventListener('toggle', event => {
            if (event.target.matches('.pw-preview') && event.target.open) this.editor.updatePreview();
        }, true);
        document.addEventListener('click', event => {
            if (root.hidden || root.contains(event.target)) return;
            const navigation = event.target.closest('#rn-left-rail [data-rn-key]:not([data-rn-key="presets"]), [data-rn-manager-duplicate], #top-settings-holder .drawer-toggle');
            if (!navigation) return;
            if (!this.dirty && !this.busy) return this.hide();
            event.preventDefault();
            event.stopImmediatePropagation();
            this.run(async () => {
                if (!await this.discard()) return;
                this.hide();
                navigation.click();
            });
        }, true);
        document.addEventListener('keydown', event => {
            if (root.hidden || document.querySelector('dialog[open]')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.run(() => this.close());
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && this.view === 'editor') {
                event.preventDefault();
                this.run(() => this.save());
            }
        }, true);
        window.addEventListener('beforeunload', event => {
            if (!this.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
        // Restore controls before the existing tab manager reacts to an API switch.
        const leaveApi = () => {
            if (main_api !== 'openai') this.hide();
            document.getElementById('chlo-preset-library-button').hidden = main_api !== 'openai';
        };
        eventSource.on(event_types.MAIN_API_CHANGED, leaveApi);
        eventSource.makeFirst(event_types.MAIN_API_CHANGED, leaveApi);
        for (const type of [event_types.OAI_PRESET_CHANGED_AFTER, event_types.PROMPT_PRESET_SAVED, event_types.PRESET_DELETED, event_types.PRESET_RENAMED]) {
            eventSource.on(type, () => {
                if (!this.names().includes(this.selected)) this.selected = this.activeName() || this.names()[0];
                if (!root.hidden && this.view === 'library') this.library.render();
            });
        }
    }

    names() { return Object.keys(openai_setting_names ?? {}); }
    activeName() { return oai_settings.preset_settings_openai; }
    defaults() { return openai_settings[openai_setting_names.Default] ?? oai_settings; }

    updateDock() {
        const docked = !this.root.hidden && this.root.classList.contains('pw-docked') && window.innerWidth > 1050;
        document.body.classList.toggle('pw-docked-open', docked);
        if (docked) document.body.style.setProperty('--pw-chat-left', `${Math.ceil(this.root.getBoundingClientRect().right) + 12}px`);
        else document.body.style.removeProperty('--pw-chat-left');
    }

    preset(name) {
        const stored = openai_settings[openai_setting_names[name]] ?? {};
        if (name !== this.activeName()) return stored;
        const current = getChatCompletionPreset();
        return { ...stored, ...current, chlo_preset: Object.keys(current.chlo_preset ?? {}).length ? current.chlo_preset : stored.chlo_preset ?? {} };
    }

    async run(action) {
        if (this.busy) return;
        this.busy = true;
        this.root.setAttribute('aria-busy', 'true');
        try { await action(); } catch (error) {
            console.error('Preset workspace:', error);
            this.status(error.message || 'Could not complete the operation. Your draft has been kept.', true);
        } finally {
            this.busy = false;
            this.root.removeAttribute('aria-busy');
        }
    }

    status(message, error = false) {
        const node = this.root.querySelector('.pw-status');
        node.textContent = message;
        node.classList.toggle('pw-error', error);
    }

    markDirty() {
        this.revision++;
        if (this.dirty) return;
        this.dirty = true;
        this.root.querySelector('#pw-draft-state').textContent = 'Unsaved prompt changes';
    }

    updateBlockCount() {
        this.root.querySelector('#pw-subtitle').textContent = `${getBlocks(this.draft).filter(block => block.entry).length} blocks · Prompts & instructions`;
    }

    async discard() {
        if (!this.dirty) return true;
        const confirmed = await Popup.show.confirm('Unsaved prompt changes', 'Discard your unsaved block and preset edits? Your generation parameters are already saved.');
        if (!confirmed) return false;
        this.dirty = false;
        this.draft = null;
        this.draftName = null;
        return true;
    }

    async open() {
        if (main_api !== 'openai') {
            toastr.info('The preset library is available with Chat Completion.');
            return;
        }
        this.returnFocus = document.activeElement;
        this.selected ??= this.activeName() || this.names()[0];
        this.root.hidden = false;
        if (this.root.popover && !this.root.matches(':popover-open')) this.root.showPopover();
        this.root.classList.add('open');
        // Every new visit opens the collection. A draft survives navigation.
        await this.showView('library');
        this.root.querySelector('#pw-search').focus();
    }

    hide() {
        this.parameters.restore();
        if (this.root.popover && this.root.matches(':popover-open')) this.root.hidePopover();
        this.root.hidden = true;
        this.root.classList.remove('open');
        document.body.classList.remove('pw-docked-open');
        document.body.style.removeProperty('--pw-chat-left');
        if (this.returnFocus?.isConnected) this.returnFocus.focus();
    }

    async close() {
        if (!await this.discard()) return;
        this.hide();
    }

    async showView(view) {
        if (view === 'editor' && !this.draft) return this.edit(this.selected || this.activeName());
        this.parameters.restore();
        this.view = view;
        this.root.querySelectorAll('.pw-view').forEach(node => node.hidden = node.id !== `pw-${view}`);
        this.root.querySelectorAll('[data-view]').forEach(node => {
            if (node.closest('.pw-tabs')) {
                if (node.dataset.view === view) node.setAttribute('aria-current', 'page');
                else node.removeAttribute('aria-current');
            }
        });
        const title = view === 'library' ? 'Preset Library' : view === 'parameters' ? 'Generation settings' : this.draftName;
        this.root.querySelector('#pw-title').textContent = title;
        this.root.querySelector('#pw-subtitle').textContent = view === 'library' ? 'Your collection, ready to write.'
            : view === 'parameters' ? 'Your current settings, shared across every prompt preset.'
                : `${getBlocks(this.draft).filter(block => block.entry).length} blocks · Prompts & instructions`;
        this.root.classList.toggle('pw-docked', view === 'parameters' || this.docked);
        this.updateDock();
        if (view === 'library') this.library.render();
        if (view === 'editor') {
            this.editor.render();
            this.root.querySelector('#pw-draft-state').textContent = this.dirty ? 'Unsaved prompt changes' : 'Prompt preset · Parameters stay shared';
        }
        if (view === 'parameters') this.parameters.mount(this.root.querySelector('#pw-parameter-controls'));
    }

    async edit(name) {
        if (!name) return;
        if (name !== this.draftName || !this.draft) {
            if (!await this.discard()) return;
            this.draft = importPromptPreset(this.preset(name), this.defaults());
            this.draftName = name;
            this.selected = name;
            this.editor.selected = null;
        }
        await this.showView('editor');
    }

    async activate(name) {
        if (this.dirty && this.draftName === name) {
            await this.save();
            if (this.dirty) return;
        } else if (!await this.discard()) return;
        $('#settings_preset_openai').val(openai_setting_names[name]).trigger('change');
        await getPresetApplicationPromise();
        this.preferences.recent = [name, ...this.preferences.recent.filter(value => value !== name)].slice(0, 30);
        await saveSettings();
        this.selected = name;
        this.draft = null;
        this.draftName = null;
        this.hide();
    }

    async save() {
        if (!this.draft) return;
        const name = this.draftName;
        const revision = this.revision;
        // Validate before the request, while retaining all native block properties.
        const preset = importPromptPreset(this.draft, this.defaults());
        (preset.chlo_preset ??= {}).updatedAt = new Date().toISOString();
        const saved = await saveChatCompletionPromptPreset(name, preset, { apply: name === this.activeName() });
        // A completed Save must survive an immediate page reload. Native setting
        // saves are normally debounced; flush the active prompt state explicitly.
        if (saved === this.activeName()) await saveSettings();
        this.draftName = saved;
        this.selected = saved;
        if (this.revision !== revision) {
            this.status('Earlier changes saved. Your newest edits are still in the draft; save again when ready.');
            return;
        }
        this.draft = structuredClone(preset);
        this.dirty = false;
        this.root.querySelector('#pw-draft-state').textContent = 'Saved';
        this.status('Prompt preset saved. Shared generation settings are unchanged.');
    }

    async askName(suggested) {
        const value = await Popup.show.input('Preset name', 'Choose a name for your prompt preset.', suggested);
        if (!value) return null;
        const name = String(value).trim();
        if (!name || name.length > 150 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) {
            throw new Error('Use a valid Windows file name, up to 150 characters, without slashes or special filename characters.');
        }
        return name;
    }

    async newPreset(copy = false) {
        if (!await this.discard()) return;
        const source = copy ? this.preset(this.selected) : this.defaults();
        const name = await this.askName(copy ? `${this.selected} copy` : 'My preset');
        if (!name) return;
        if (this.names().some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('That preset name already exists. Choose another name.');
        this.draft = importPromptPreset(source, this.defaults());
        if (!copy) delete this.draft.chlo_preset;
        this.draftName = name;
        this.editor.selected = null;
        this.markDirty();
        await this.showView('editor');
    }

    async importFile(input) {
        const file = input.files[0];
        input.value = '';
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) throw new Error('Choose a preset smaller than 15 MB.');
        const raw = JSON.parse(await file.text());
        const preset = importPromptPreset(raw, this.defaults());
        if (!await this.discard()) return;
        let name = await this.askName(file.name.replace(/\.[^.]+$/, ''));
        if (!name) return;
        const existing = this.names().find(value => value.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (existing) {
            if (!await Popup.show.confirm('Replace existing prompt preset?', 'The existing preset will be replaced when you save this draft.')) return;
            name = existing;
        }
        this.draft = preset;
        this.draftName = name;
        this.editor.selected = null;
        this.markDirty();
        await this.showView('editor');
        this.status(`Imported ${getBlocks(preset).length} blocks for review. Save when ready. Generation and connection settings from the file were left out.`);
    }

    async coverFile(input) {
        const file = input.files[0];
        input.value = '';
        if (!file || !this.draft) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP cover smaller than 10 MB.');
        const image = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, 1200 / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        image.close();
        (this.draft.chlo_preset ??= {}).cover = canvas.toDataURL('image/webp', 0.85);
        this.markDirty();
        this.status('Cover added to this draft. Save the preset to keep it.');
    }

    async click(event) {
        const target = event.target.closest('button');
        if (!target || !this.root.contains(target)) return;
        if (target.dataset.view) return this.showView(target.dataset.view);
        if (target.dataset.select) {
            this.selected = target.dataset.select;
            this.library.render();
            return;
        }
        if (target.dataset.edit) return this.edit(target.dataset.edit);
        if (target.dataset.use) return this.activate(target.dataset.use);
        if (target.dataset.favorite) {
            const name = target.dataset.favorite;
            const favorites = this.preferences.favorites;
            this.preferences.favorites = favorites.includes(name) ? favorites.filter(value => value !== name) : [...favorites, name];
            saveSettingsDebounced();
            this.library.render();
            return;
        }
        if (target.dataset.filter) {
            this.library.filter = target.dataset.filter;
            this.library.render();
            return;
        }
        if (target.dataset.block) {
            this.editor.selected = target.dataset.block;
            this.editor.render();
            return;
        }
        if (target.dataset.category) {
            await this.edit(this.selected);
            const block = getBlocks(this.draft).find(block => blockCategory(block.prompt) === target.dataset.category);
            if (block) this.editor.selected = block.prompt.identifier;
            this.editor.render();
            return;
        }
        if (target.dataset.macro) {
            const textarea = this.root.querySelector('#pw-content');
            textarea.setRangeText(target.dataset.macro, textarea.selectionStart, textarea.selectionEnd, 'end');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.focus();
            return;
        }
        switch (target.dataset.action) {
            case 'close': return this.close();
            case 'dock':
                this.docked = !this.root.classList.contains('pw-docked');
                this.root.classList.toggle('pw-docked', this.docked);
                this.updateDock();
                return;
            case 'save': return this.save();
            case 'use-draft': return this.activate(this.draftName);
            case 'new': return this.newPreset();
            case 'duplicate': return this.newPreset(true);
            case 'import': this.root.querySelector('#pw-import-file').click(); return;
            case 'cover': this.root.querySelector('#pw-cover-file').click(); return;
            case 'remove-cover':
                if (this.draft.chlo_preset) delete this.draft.chlo_preset.cover;
                this.markDirty();
                this.status('Cover removed from this draft.');
                return;
            case 'export':
                download(JSON.stringify(this.draft, null, 4), `${this.draftName}.json`, 'application/json');
                return;
            case 'add-block': {
                const identifier = uuidv4();
                this.draft.prompts.push({ identifier, name: 'New block', role: 'system', content: '', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] });
                getOrder(this.draft).push({ identifier, enabled: true });
                this.editor.selected = identifier;
                this.markDirty();
                this.editor.render();
                this.updateBlockCount();
                this.root.querySelector('[data-field="name"]').focus();
                return;
            }
            case 'move-up': return this.editor.move(-1);
            case 'move-down': return this.editor.move(1);
            case 'delete-block': {
                const { prompt } = this.editor.block();
                if (!promptManager.isPromptDeletionAllowed(prompt)) return;
                if (!await Popup.show.confirm('Delete this block?', 'It will be removed from this draft. Save the preset to keep the change.')) return;
                this.draft.prompts = this.draft.prompts.filter(block => block.identifier !== prompt.identifier);
                for (const list of this.draft.prompt_order) list.order = list.order.filter(entry => entry.identifier !== prompt.identifier);
                this.markDirty();
                this.editor.render();
                this.updateBlockCount();
                return;
            }
        }
    }
}

export async function initPresetWorkspace() {
    if (workspace) return;
    const html = await renderTemplateAsync('/scripts/chlolirium/presets/workspace.html', {}, true, false, true);
    document.body.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById('chlo-preset-workspace');
    const launch = document.createElement('button');
    launch.type = 'button';
    launch.id = 'chlo-preset-library-button';
    launch.className = 'menu_button menu_button_icon';
    launch.innerHTML = '<i class="fa-solid fa-book-open" aria-hidden="true"></i><span>Preset Library</span>';
    launch.hidden = main_api !== 'openai';
    document.querySelector('#openai_api-presets > div').prepend(launch);
    workspace = new PresetWorkspace(root);
    launch.addEventListener('click', () => workspace.run(() => workspace.open()));
}

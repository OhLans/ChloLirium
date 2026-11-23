import { eventSource, event_types } from '../../../script.js';
import { getPresetApplicationPromise, oai_settings, openai_settings, promptManager } from '../../openai.js';
import { escapeHtml } from '../../utils.js';
import { initPresetActions, updatePresetActions } from './actions.js';
import { editPresetCover } from './covers.js';
import { presetBlockCount, presetCover } from './presentation.js';
import { initConfigurationWorkspace } from './shell.js';
import { confirmPromptSwitch } from './workspace.js';

let initialized = false;

/** A collection view over native presets; application/edit/save remain native. */
export function initPresetPanel() {
    if (initialized) return;
    const select = document.getElementById('settings_preset_openai');
    const collection = document.createElement('div');
    collection.id = 'chlo-preset-collection';
    collection.setAttribute('aria-label', 'Presets');
    const cards = document.createElement('div');
    cards.id = 'chlo-preset-cards';
    collection.append(cards);
    const preview = document.createElement('aside');
    preview.id = 'chlo-preset-preview';
    preview.className = 'chlo-preset-preview';
    document.getElementById('openai_api-presets').append(collection);
    initPresetActions(collection);
    const search = collection.querySelector('.chlo-preset-search');
    let previewName;
    let catalogOrder = [];
    try {
        const saved = JSON.parse(localStorage.getItem('chlo-preset-library-order') ?? '[]');
        if (Array.isArray(saved)) catalogOrder = saved.filter(name => typeof name === 'string');
    } catch { /* Keep the native order if storage is unavailable. */ }
    const saveCatalogOrder = () => {
        catalogOrder = [...cards.children].map(card => card.dataset.name);
        try { localStorage.setItem('chlo-preset-library-order', JSON.stringify(catalogOrder)); } catch { /* Session ordering remains usable. */ }
    };
    const filter = () => {
        const query = search.value.toLocaleLowerCase().trim();
        for (const card of cards.children) card.hidden = !card.dataset.name.toLocaleLowerCase().includes(query);
        if ($(cards).data('ui-sortable')) $(cards).sortable('option', 'disabled', Boolean(query));
    };
    search.addEventListener('input', filter);

    const renderPreview = name => {
        const option = [...select.options].find(option => option.text === name);
        const row = [...cards.children].find(card => card.dataset.name === name);
        preview.remove();
        previewName = row && option ? name : undefined;
        for (const card of cards.children) {
            const button = card.querySelector('.chlo-preset-open');
            button.setAttribute('aria-expanded', String(card === row));
            if (card === row) button.setAttribute('aria-controls', preview.id);
            else button.removeAttribute('aria-controls');
        }
        if (!row || !option) return;
        preview.dataset.name = name;
        const preset = openai_settings[option.value] ?? {};
        const cover = presetCover(preset);
        const description = typeof preset.chlo_preset?.description === 'string' ? preset.chlo_preset.description : '';
        preview.innerHTML = `${cover ? `<button type="button" class="chlo-preview-cover" aria-label="Change preview image"><img src="${escapeHtml(cover)}" alt="" referrerpolicy="no-referrer"></button>` : ''}
            <h3>${escapeHtml(name)}</h3><p>${presetBlockCount(preset)} blocks${name === oai_settings.preset_settings_openai ? ' · Active preset' : ''}</p>
            ${description ? `<p class="chlo-preview-description">${escapeHtml(description)}</p>` : ''}`;
        row.append(preview);
        preview.querySelector('img')?.addEventListener('error', event => event.target.hidden = true);
    };

    const render = () => {
        const options = [...select.options].filter(option => option.value !== 'gui');
        const positions = new Map(catalogOrder.map((name, index) => [name, index]));
        options.sort((a, b) => (positions.get(a.text) ?? Infinity) - (positions.get(b.text) ?? Infinity));
        cards.innerHTML = options.map(option => {
            const selected = option.text === oai_settings.preset_settings_openai;
            const preset = openai_settings[option.value] ?? {};
            const cover = presetCover(preset);
            const format = preset.chlo_preset?.format === 'Loom' ? ' · Loom blocks' : preset.chlo_preset?.format === 'Legacy' ? ' · Legacy' : '';
            return `<article class="chlo-preset-card${selected ? ' selected' : ''}" data-value="${escapeHtml(option.value)}" data-name="${escapeHtml(option.text)}" aria-label="${escapeHtml(option.text)}">
                <span class="chlo-preset-drag" role="button" tabindex="0" aria-label="Reorder ${escapeHtml(option.text)}; use Up or Down arrow keys" title="Drag to reorder presets">⠿</span>
                <button type="button" class="chlo-preset-cover" aria-label="Change image for ${escapeHtml(option.text)}" title="Change preset image">
                    <i class="fa-solid fa-book-open" aria-hidden="true"></i>
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
                    <span class="chlo-preset-cover-edit fa-solid fa-camera" aria-hidden="true"></span>
                </button>
                <button type="button" class="chlo-preset-open" aria-expanded="false">
                    <span class="chlo-preset-name">${escapeHtml(option.text)}</span>
                    <small>${presetBlockCount(preset)} blocks${format}</small>
                </button>
                <div class="chlo-preset-card-footer">${selected ? '<small class="chlo-preset-active">Active</small>' : ''}<button type="button" class="menu_button chlo-preset-use" aria-pressed="${selected}">Use</button><button type="button" class="menu_button chlo-preset-edit">Edit</button></div>
            </article>`;
        }).join('');
        for (const image of cards.querySelectorAll('img')) image.addEventListener('error', () => image.hidden = true);
        filter();
        $(cards).sortable({ items: '.chlo-preset-card', handle: '.chlo-preset-drag', axis: 'y', disabled: Boolean(search.value.trim()), update: saveCatalogOrder });
        for (const handle of cards.querySelectorAll('.chlo-preset-drag')) handle.addEventListener('keydown', event => {
            if (search.value.trim() || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const card = handle.closest('.chlo-preset-card');
            const sibling = event.key === 'ArrowUp' ? card.previousElementSibling : card.nextElementSibling;
            if (!sibling) return;
            if (event.key === 'ArrowUp') sibling.before(card);
            else sibling.after(card);
            saveCatalogOrder();
            handle.focus();
        });
        renderPreview(previewName);
        updatePresetActions();
    };

    let selection = 0;
    collection.addEventListener('click', async event => {
        const card = event.target.closest('.chlo-preset-card, .chlo-preset-preview');
        if (!card) return;
        try {
            if (event.target.closest('.chlo-preset-cover, .chlo-preview-cover')) { await editPresetCover(card.dataset.name); return; }
            if (!event.target.closest('.chlo-preset-open, .chlo-preset-edit, .chlo-preset-use')) return;
            if (event.target.closest('.chlo-preset-open')) { renderPreview(previewName === card.dataset.name ? undefined : card.dataset.name); return; }
            if (!await confirmPromptSwitch(promptManager)) return;
            const openEditor = !event.target.closest('.chlo-preset-use');
            const request = ++selection;
            if (!openEditor || oai_settings.preset_settings_openai !== card.dataset.name) {
                $(select).val(card.dataset.value).trigger('change');
                await getPresetApplicationPromise();
            }
            if (openEditor && request === selection && oai_settings.preset_settings_openai === card.dataset.name) document.getElementById('openai-tab-btn-prompts')?.click();
        } catch (error) {
            console.error('Could not open or update preset', error);
            toastr.error('Could not update the preset. Please try again.');
        }
    });

    for (const type of [event_types.OAI_PRESET_CHANGED_AFTER, event_types.PROMPT_PRESET_SAVED, event_types.PRESET_DELETED, event_types.PRESET_RENAMED]) eventSource.on(type, render);
    // Native imports and renames also change the select's option list.
    new MutationObserver(render).observe(select, { childList: true, subtree: true, characterData: true });
    render();
    initConfigurationWorkspace();
    initialized = true;
}

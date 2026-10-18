import { eventSource, event_types } from '../../../script.js';
import { getPresetApplicationPromise, oai_settings, openai_settings } from '../../openai.js';
import { escapeHtml } from '../../utils.js';
import { initPresetActions, updatePresetActions } from './actions.js';
import { editPresetCover } from './covers.js';
import { presetBlockCount, presetCover } from './presentation.js';

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
    document.getElementById('openai_api-presets').append(collection);
    initPresetActions(collection);

    const render = () => {
        const options = [...select.options].filter(option => option.value !== 'gui');
        cards.innerHTML = options.map(option => {
            const selected = option.text === oai_settings.preset_settings_openai;
            const preset = openai_settings[option.value] ?? {};
            const cover = presetCover(preset);
            const format = preset.chlo_preset?.format === 'Loom' ? ' · Loom blocks' : preset.chlo_preset?.format === 'Legacy' ? ' · Legacy' : '';
            return `<article class="chlo-preset-card${selected ? ' selected' : ''}" data-value="${escapeHtml(option.value)}" data-name="${escapeHtml(option.text)}" aria-label="${escapeHtml(option.text)}">
                <button type="button" class="chlo-preset-cover" aria-label="Change image for ${escapeHtml(option.text)}" title="Change preset image">
                    <i class="fa-solid fa-book-open" aria-hidden="true"></i>
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
                    <span class="chlo-preset-cover-edit fa-solid fa-camera" aria-hidden="true"></span>
                </button>
                <button type="button" class="chlo-preset-open" aria-pressed="${selected}">
                    <span class="chlo-preset-name">${escapeHtml(option.text)}</span>
                    <small>${presetBlockCount(preset)} blocks${format}</small>
                </button>
                <div class="chlo-preset-card-footer">${selected ? '<small class="chlo-preset-active">Active</small>' : ''}<button type="button" class="menu_button chlo-preset-use" aria-pressed="${selected}">Use</button><button type="button" class="menu_button chlo-preset-edit">Edit</button></div>
            </article>`;
        }).join('');
        for (const image of cards.querySelectorAll('img')) image.addEventListener('error', () => image.hidden = true);
        updatePresetActions();
    };

    let selection = 0;
    collection.addEventListener('click', async event => {
        const card = event.target.closest('.chlo-preset-card');
        if (!card) return;
        try {
            if (event.target.closest('.chlo-preset-cover')) { await editPresetCover(card.dataset.name); return; }
            if (!event.target.closest('.chlo-preset-open, .chlo-preset-edit, .chlo-preset-use')) return;
            const openEditor = !event.target.closest('.chlo-preset-use');
            const request = ++selection;
            if (oai_settings.preset_settings_openai !== card.dataset.name) {
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
    initialized = true;
}

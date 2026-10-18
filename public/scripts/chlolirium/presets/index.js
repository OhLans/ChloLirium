import { eventSource, event_types } from '../../../script.js';
import { getPresetApplicationPromise, oai_settings } from '../../openai.js';
import { escapeHtml } from '../../utils.js';

let initialized = false;

/** A different presentation of the native select's options. Selection, imports,
 * editing, saves and parameters continue through the existing ST controls. */
export function initPresetPanel() {
    if (initialized) return;
    const select = document.getElementById('settings_preset_openai');
    const collection = document.createElement('div');
    collection.id = 'chlo-preset-collection';
    collection.setAttribute('aria-label', 'Presets');
    document.getElementById('openai_api-presets').append(collection);

    const render = () => {
        const options = [...select.options].filter(option => option.value !== 'gui');
        collection.innerHTML = options.map(option => {
            const selected = option.text === oai_settings.preset_settings_openai;
            return `<button type="button" class="chlo-preset-card${selected ? ' selected' : ''}" data-value="${escapeHtml(option.value)}" aria-pressed="${selected}">
                <i class="fa-solid fa-file-lines" aria-hidden="true"></i>
                <span class="chlo-preset-name">${escapeHtml(option.text)}</span>
                ${selected ? '<span class="chlo-preset-active">Active</span>' : '<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>'}
            </button>`;
        }).join('');
    };

    let selection = 0;
    collection.addEventListener('click', async event => {
        const card = event.target.closest('.chlo-preset-card');
        if (!card) return;
        const request = ++selection;
        $(select).val(card.dataset.value).trigger('change');
        try {
            await getPresetApplicationPromise();
            if (request !== selection) return;
            document.getElementById('openai-tab-btn-prompts')?.click();
        } catch (error) {
            console.error('Could not select preset', error);
            toastr.error('Could not select the preset. Please try again.');
        }
    });

    for (const type of [event_types.OAI_PRESET_CHANGED_AFTER, event_types.PROMPT_PRESET_SAVED, event_types.PRESET_DELETED, event_types.PRESET_RENAMED]) eventSource.on(type, render);
    // Native imports and renames also change the select's option list.
    new MutationObserver(render).observe(select, { childList: true, subtree: true, characterData: true });
    render();
    initialized = true;
}

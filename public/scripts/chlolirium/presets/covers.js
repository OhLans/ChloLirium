import { saveSettingsDebounced } from '../../../script.js';
import { oai_settings, openai_settings, openai_setting_names, saveChatCompletionPromptPreset } from '../../openai.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../popup.js';
import { createThumbnail, getBase64Async } from '../../utils.js';
import { presetCover } from './presentation.js';

/** Covers belong to preset files, so rename, save-as, export and backups carry
 * them along. Changing a cover never selects an inactive preset. */
export async function editPresetCover(name) {
    const stored = openai_settings[openai_setting_names[name]];
    if (!stored) return;
    const form = document.createElement('div');
    form.className = 'chlo-preset-cover-dialog';
    const heading = document.createElement('h3');
    heading.textContent = name;
    const image = document.createElement('img');
    image.alt = 'Preset cover';
    image.referrerPolicy = 'no-referrer';
    const current = presetCover(stored);
    if (current) image.src = current;
    else image.hidden = true;
    const label = document.createElement('label');
    label.textContent = 'Choose image';
    label.className = 'menu_button';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.setAttribute('aria-label', 'Choose preset image');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'menu_button';
    remove.textContent = 'Remove image';
    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    let cover = current, pending = Promise.resolve(), valid = true, request = 0;
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const version = ++request;
        valid = false;
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) {
            status.textContent = 'Choose a PNG, JPEG, WebP or GIF under 10 MB.';
            return;
        }
        status.textContent = 'Preparing image…';
        pending = (async () => {
            try {
                const thumbnail = await createThumbnail(await getBase64Async(file), 384, 384, 'image/jpeg');
                if (version !== request) return;
                cover = thumbnail;
                image.src = cover;
                image.hidden = false;
                status.textContent = '';
                valid = true;
            } catch { if (version === request) status.textContent = 'Could not read this image. Choose another file.'; }
        })();
    });
    remove.addEventListener('click', async () => {
        await pending;
        cover = '';
        image.hidden = true;
        valid = true;
        status.textContent = '';
    });
    label.append(input);
    form.append(heading, image, label, remove, status);
    const result = await new Popup(form, POPUP_TYPE.CONFIRM, null, {
        okButton: 'Save image', cancelButton: 'Cancel',
        onClosing: async popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            await pending;
            return valid;
        },
    }).show();
    await pending;
    if (!result || !valid) return;
    const selected = oai_settings.preset_settings_openai === name;
    const source = selected ? oai_settings : openai_settings[openai_setting_names[name]];
    if (!source) return;
    const metadata = { ...source.chlo_preset, cover };
    await saveChatCompletionPromptPreset(name, { ...source, chlo_preset: metadata });
    if (oai_settings.preset_settings_openai === name) {
        oai_settings.chlo_preset = metadata;
        saveSettingsDebounced();
    }
}

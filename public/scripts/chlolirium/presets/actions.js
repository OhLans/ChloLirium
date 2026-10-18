import { oai_settings } from '../../openai.js';

let controls = [];

/** Move the real native controls, retaining IDs and every existing handler. */
export function initPresetActions(collection) {
    const header = document.createElement('header');
    header.id = 'chlo-preset-library-header';
    header.innerHTML = '<h3>Presets</h3><div id="chlo-preset-library-actions" class="chlo-preset-actions"></div><small id="chlo-preset-current"></small>';
    collection.prepend(header);
    const editor = document.createElement('header');
    editor.id = 'chlo-preset-editor-header';
    editor.innerHTML = '<h3 id="chlo-preset-editor-title"></h3><div id="chlo-preset-editor-actions" class="chlo-preset-actions"></div>';
    document.getElementById('openai_api-presets').append(editor);
    const layout = document.createElement('details');
    layout.id = 'chlo-preset-layout-setting';
    layout.innerHTML = '<summary>Panel layout</summary>';
    document.getElementById('openai_settings').append(layout);
    const specs = [
        ['#import_oai_preset', 'Import', 'chlo-preset-library-actions'],
        ['#export_oai_preset', 'Export', 'chlo-preset-library-actions'],
        ['#delete_oai_preset', 'Delete', 'chlo-preset-library-actions'],
        ['#update_oai_preset', 'Save', 'chlo-preset-editor-actions'],
        ['[data-preset-manager-rename="openai"]', 'Rename', 'chlo-preset-editor-actions'],
        ['#new_oai_preset', 'Save as', 'chlo-preset-editor-actions'],
        ['label:has(> #ChatCompletionTabs-enabled)', null, 'chlo-preset-layout-setting'],
    ];
    controls = specs.map(([selector, label, target]) => {
        const node = document.querySelector(selector);
        const anchor = document.createComment('native preset control position');
        node.before(anchor);
        if (label) {
            node.setAttribute('role', 'button');
            node.tabIndex = 0;
            node.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); node.click(); }
            });
            const text = document.createElement('span');
            text.className = 'chlo-preset-action-label';
            text.textContent = label;
            node.append(text);
        }
        return { node, anchor, target };
    });
}

export function mountPresetActions(active) {
    for (const { node, anchor, target } of controls) {
        if (active) document.getElementById(target)?.append(node);
        else anchor.after(node);
    }
    const header = document.getElementById('chlo-preset-editor-header');
    const prompts = document.getElementById('openai-tab-content-prompts');
    if (active && prompts) prompts.prepend(header);
    else document.getElementById('openai_api-presets').append(header);
    updatePresetActions();
}

export function updatePresetActions() {
    const name = oai_settings.preset_settings_openai || 'No preset selected';
    document.getElementById('chlo-preset-editor-title').textContent = name;
    document.getElementById('chlo-preset-current').textContent = `Active: ${name}`;
}

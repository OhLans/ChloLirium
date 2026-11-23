import { oai_settings } from '../../openai.js';

let controls = [];

function wireTools(header, button, panel, actions) {
    const setOpen = open => {
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => setOpen(panel.hidden));
    header.addEventListener('keydown', event => {
        // Native buttons already click on Enter.
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.stopPropagation();
        if (event.key !== 'Escape' || panel.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.focus();
    });
    document.addEventListener('click', event => {
        if (!panel.hidden && !header.contains(event.target)) setOpen(false);
    });
    actions.addEventListener('click', () => {
        const restoreFocus = panel.contains(document.activeElement);
        setOpen(false);
        // Leave focus in any dialog opened by the native handler.
        if (restoreFocus) button.focus();
    });
}

/** Move the real native controls, retaining IDs and every existing handler. */
export function initPresetActions(collection) {
    const header = document.createElement('header');
    header.id = 'chlo-preset-library-header';
    header.innerHTML = `<div class="chlo-block-navigation chlo-library-navigation">
            <input type="search" class="text_pole chlo-block-search chlo-preset-search" aria-label="Search presets" placeholder="Search presets…">
            <button type="button" class="menu_button chlo-tools-button" aria-label="Preset tools" title="Preset tools" aria-expanded="false" aria-controls="chlo-preset-library-tools">⋯</button>
        </div>
        <div id="chlo-preset-library-tools" class="chlo-tools-panel" hidden>
            <small id="chlo-preset-current"></small>
            <div id="chlo-preset-library-actions" class="chlo-preset-actions" role="group" aria-label="Library actions"></div>
        </div>`;
    collection.prepend(header);
    wireTools(header, header.querySelector('.chlo-tools-button'), header.querySelector('#chlo-preset-library-tools'), header.querySelector('#chlo-preset-library-actions'));
    const editor = document.createElement('header');
    editor.id = 'chlo-preset-editor-header';
    editor.innerHTML = `<div class="chlo-prompt-caption"><h3 id="chlo-preset-editor-title"></h3><small class="chlo-prompt-active-view" hidden>Sending order</small></div>
        <div class="chlo-block-navigation">
            <input type="search" class="text_pole chlo-block-search" aria-label="Find a block" placeholder="Find a block…">
            <button type="button" class="menu_button chlo-add-block"><span aria-hidden="true">+</span> Add block</button>
            <button type="button" class="menu_button chlo-tools-button chlo-prompt-tools-button" aria-label="Prompt tools" title="Prompt tools" aria-expanded="false" aria-controls="chlo-prompt-tools-panel">⋯</button>
        </div>
        <div id="chlo-prompt-tools-panel" class="chlo-tools-panel" hidden>
            <div class="chlo-prompt-list-tools"></div>
            <div id="chlo-preset-editor-actions" class="chlo-preset-actions" role="group" aria-label="Preset actions"></div>
        </div>`;
    wireTools(editor, editor.querySelector('.chlo-prompt-tools-button'), editor.querySelector('#chlo-prompt-tools-panel'), editor.querySelector('#chlo-preset-editor-actions'));
    document.getElementById('openai_api-presets').append(editor);
    const layout = document.createElement('details');
    layout.id = 'chlo-preset-layout-setting';
    layout.innerHTML = '<summary>Panel layout</summary>';
    document.getElementById('openai_settings').append(layout);
    const specs = [
        ['#import_oai_preset', 'Import', 'chlo-preset-library-actions'],
        ['#export_oai_preset', 'Export', 'chlo-preset-library-actions'],
        ['#update_oai_preset', 'Save preset', 'chlo-preset-editor-actions'],
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
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); node.click(); }
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
    if (active && prompts) {
        if (header.parentElement !== prompts) prompts.prepend(header);
    } else {
        header.querySelector('.chlo-prompt-list-tools').replaceChildren();
        document.getElementById('openai_api-presets').append(header);
    }
    updatePresetActions();
}

export function updatePresetActions() {
    const name = oai_settings.preset_settings_openai || 'No preset selected';
    const title = document.getElementById('chlo-preset-editor-title');
    title.textContent = name;
    title.title = name;
    document.getElementById('chlo-preset-current').textContent = `Active: ${name}`;
}

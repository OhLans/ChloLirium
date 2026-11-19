import { oai_settings } from '../../openai.js';

let controls = [];

/** Move the real native controls, retaining IDs and every existing handler. */
export function initPresetActions(collection) {
    const header = document.createElement('header');
    header.id = 'chlo-preset-library-header';
    header.innerHTML = '<h3>Preset library</h3><div id="chlo-preset-library-actions" class="chlo-preset-actions"></div><small id="chlo-preset-current"></small>';
    collection.prepend(header);
    const editor = document.createElement('header');
    editor.id = 'chlo-preset-editor-header';
    editor.innerHTML = `<div class="chlo-prompt-caption"><h3 id="chlo-preset-editor-title"></h3><small class="chlo-prompt-active-view" hidden>Sending order</small></div>
        <div class="chlo-block-navigation">
            <input type="search" class="text_pole chlo-block-search" aria-label="Find a block" placeholder="Find a block…">
            <button type="button" class="menu_button chlo-add-block"><span aria-hidden="true">+</span> Add block</button>
            <button type="button" class="menu_button chlo-prompt-tools-button" aria-label="Prompt tools" title="Prompt tools" aria-expanded="false" aria-controls="chlo-prompt-tools-panel">⋯</button>
        </div>
        <div id="chlo-prompt-tools-panel" hidden>
            <div class="chlo-prompt-list-tools"></div>
            <div id="chlo-preset-editor-actions" class="chlo-preset-actions" role="group" aria-label="Preset actions"></div>
        </div>`;
    const toolsButton = editor.querySelector('.chlo-prompt-tools-button');
    const toolsPanel = editor.querySelector('#chlo-prompt-tools-panel');
    const setToolsOpen = open => {
        toolsPanel.hidden = !open;
        toolsButton.setAttribute('aria-expanded', String(open));
    };
    toolsButton.addEventListener('click', () => setToolsOpen(toolsPanel.hidden));
    editor.addEventListener('keydown', event => {
        // Native buttons already click on Enter. Keep the app's global menu
        // shortcut from clicking them a second time.
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.stopPropagation();
        if (event.key !== 'Escape' || toolsPanel.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        setToolsOpen(false);
        toolsButton.focus();
    });
    document.addEventListener('click', event => {
        if (!toolsPanel.hidden && !editor.contains(event.target)) setToolsOpen(false);
    });
    editor.querySelector('#chlo-preset-editor-actions').addEventListener('click', () => {
        setToolsOpen(false);
        // Native actions can open a dialog; let it take focus if it does.
        if (toolsPanel.contains(document.activeElement)) toolsButton.focus();
    });
    document.getElementById('openai_api-presets').append(editor);
    const layout = document.createElement('details');
    layout.id = 'chlo-preset-layout-setting';
    layout.innerHTML = '<summary>Panel layout</summary>';
    document.getElementById('openai_settings').append(layout);
    const specs = [
        ['#import_oai_preset', 'Import', 'chlo-preset-library-actions'],
        ['#export_oai_preset', 'Export', 'chlo-preset-library-actions'],
        ['#delete_oai_preset', 'Delete', 'chlo-preset-library-actions'],
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

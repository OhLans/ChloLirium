import { promptSection } from './presentation.js';

/** Move only the chosen native entry; preserve every other entry and flag. */
export function insertPromptAt(manager, identifier, after) {
    const order = manager.getPromptOrderForCharacter(manager.activeCharacter);
    if (order.some(entry => entry.identifier === identifier)) return false;
    const target = after === null ? -1 : order.findIndex(entry => entry.identifier === after);
    if (after !== null && target < 0) throw new Error('The insertion point no longer exists. Choose another position.');
    const prompt = manager.getPromptById(identifier);
    if (!prompt) throw new Error('This prompt is no longer available.');
    const neighbor = manager.getPromptById(after ?? order[0]?.identifier);
    if (neighbor && !prompt.chlo_category) prompt.chlo_category = promptSection(neighbor);
    order.splice(target + 1, 0, { identifier, enabled: true });
    return true;
}

/** Searchable front end for the native prompt pool. No new persistence format. */
export function createInsertPicker({ manager, create, insert }) {
    const dialog = document.createElement('dialog');
    dialog.id = 'chlo-prompt-insert-picker';
    dialog.className = 'popup';
    dialog.setAttribute('aria-labelledby', 'chlo-insert-title');
    dialog.innerHTML = `<header><div><small>INSERT BLOCK</small><h2 id="chlo-insert-title">Add a prompt</h2></div><button type="button" data-close aria-label="Close prompt picker">×</button></header>
        <p class="chlo-insert-position"></p><button type="button" class="menu_button chlo-create-prompt"><i class="fa-solid fa-plus" aria-hidden="true"></i> New prompt</button>
        <label for="chlo-insert-search">Or choose an available prompt</label><input id="chlo-insert-search" type="search" placeholder="Search names or contents…" autocomplete="off">
        <div class="chlo-insert-results"></div>`;
    document.body.append(dialog);
    const search = dialog.querySelector('input');
    let after = null;
    const render = () => {
        const used = new Set(manager().getPromptOrderForCharacter(manager().activeCharacter).map(entry => entry.identifier));
        const query = search.value.trim().toLocaleLowerCase();
        const available = manager().serviceSettings.prompts.filter(prompt => prompt && !prompt.system_prompt && !used.has(prompt.identifier) && `${prompt.name}\n${prompt.content ?? ''}`.toLocaleLowerCase().includes(query));
        const results = dialog.querySelector('.chlo-insert-results');
        results.replaceChildren();
        for (const prompt of available) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chlo-insert-choice';
            const name = document.createElement('strong');
            name.textContent = prompt.name || 'Untitled prompt';
            const preview = document.createElement('small');
            preview.textContent = (prompt.content || `${prompt.role ?? 'system'} · Content marker`).slice(0, 150);
            button.append(name, preview);
            button.addEventListener('click', () => { dialog.close(); insert(prompt.identifier, after); });
            results.append(button);
        }
        if (!available.length) results.textContent = 'No available prompts match. You can create a new prompt above.';
    };
    search.addEventListener('input', render);
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('.chlo-create-prompt').addEventListener('click', () => { dialog.close(); create(after); });
    return {
        dialog,
        open: position => {
            after = position;
            search.value = '';
            dialog.querySelector('.chlo-insert-position').textContent = after === null ? 'At the beginning of this preset' : `After ${manager().getPromptById(after)?.name ?? 'this block'}`;
            render();
            dialog.showModal();
            search.focus();
        },
    };
}

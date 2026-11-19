import { Popup, POPUP_RESULT, POPUP_TYPE } from '../../popup.js';
import { uuidv4 } from '../../utils.js';
import { promptSectionDefinitions } from './presentation.js';

/** Edit a draft list and return its new order and labels on Apply. */
export async function editPromptSections(layout) {
    const content = document.createElement('div');
    content.className = 'chlo-section-editor';
    content.innerHTML = `<h3>Manage sections</h3>
        <p>Drag sections or use the arrows to reorder them. Use <b>Show group controls</b> to move blocks between sections.</p>
        <ol aria-label="Prompt sections"></ol>
        <button type="button" class="menu_button chlo-add-section">Add section</button>
        <small>Removing a custom section returns its blocks to the default sections. Use <b>Save preset</b> to keep your layout.</small>
        <p class="text_danger" role="alert" hidden></p>`;
    const list = content.querySelector('ol');
    const notice = content.querySelector('[role="alert"]');
    const addSection = content.querySelector('.chlo-add-section');
    const refresh = () => {
        for (const [index, row] of [...list.children].entries()) {
            row.querySelector('[data-section-action="up"]').disabled = index === 0;
            row.querySelector('[data-section-action="down"]').disabled = index === list.children.length - 1;
        }
        notice.hidden = true;
    };
    const append = ({ id, label, removable }) => {
        const row = document.createElement('li');
        row.dataset.sectionId = id;
        row.innerHTML = `<span class="chlo-section-drag" title="Drag to reorder" aria-hidden="true">⠿</span>
            <input type="text" class="text_pole" maxlength="80" aria-label="Section name">
            <button type="button" class="menu_button" data-section-action="up" aria-label="Move section up" title="Move section up">↑</button>
            <button type="button" class="menu_button" data-section-action="down" aria-label="Move section down" title="Move section down">↓</button>
            ${removable ? '<button type="button" class="menu_button" data-section-action="remove" aria-label="Remove section" title="Remove section">×</button>' : ''}`;
        const input = row.querySelector('input');
        input.value = label;
        list.append(row);
        return input;
    };
    promptSectionDefinitions(layout).forEach(append);
    refresh();
    addSection.addEventListener('click', () => {
        const input = append({ id: `section-${uuidv4()}`, label: '', removable: true });
        refresh();
        input.focus();
    });
    list.addEventListener('input', () => { notice.hidden = true; });
    list.addEventListener('click', event => {
        const button = event.target.closest('[data-section-action]');
        if (!button) return;
        const row = button.closest('li');
        switch (button.dataset.sectionAction) {
            case 'up': row.previousElementSibling?.before(row); break;
            case 'down': row.nextElementSibling?.after(row); break;
            case 'remove': {
                const neighbor = row.nextElementSibling ?? row.previousElementSibling;
                row.remove();
                (neighbor?.querySelector('input') ?? addSection).focus();
                break;
            }
        }
        refresh();
        if (row.isConnected) (button.disabled ? row.querySelector('input') : button).focus();
    });
    content.addEventListener('keydown', event => {
        // The browser already activates these buttons on Enter.
        if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.stopPropagation();
    });

    let sections;
    const result = await new Popup(content, POPUP_TYPE.CONFIRM, null, {
        okButton: 'Apply sections', cancelButton: 'Cancel', leftAlign: true, allowVerticalScrolling: true,
        onOpen: () => { $(list).sortable({ handle: '.chlo-section-drag', axis: 'y', update: refresh }); },
        onClosing: popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            const names = new Set();
            sections = [];
            for (const row of list.children) {
                const input = row.querySelector('input');
                const label = input.value.trim();
                const key = label.toLocaleLowerCase();
                if (!key || names.has(key)) {
                    notice.textContent = key ? 'Give each section a different name.' : 'Enter a name for each section.';
                    notice.hidden = false;
                    input.focus();
                    return false;
                }
                sections.push({ id: row.dataset.sectionId, label });
                names.add(key);
            }
            return true;
        },
    }).show();
    return result ? sections : undefined;
}

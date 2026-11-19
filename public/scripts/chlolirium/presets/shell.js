import { promptManager } from '../../openai.js';
import { confirmPromptSwitch } from './workspace.js';

let synchronize = () => {};
export function syncConfigurationWorkspace() { synchronize(); }

function mountColumnDivider(parent, key, label) {
    if (parent.querySelector(':scope > .chlo-column-divider')) return;
    const divider = document.createElement('div');
    divider.className = 'chlo-column-divider';
    divider.tabIndex = 0;
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-label', label);
    divider.title = 'Drag to resize columns; use Left/Right arrow keys when focused';
    divider.textContent = '⠿';
    parent.append(divider);
    let preferred = 380;
    try { preferred = Number(localStorage.getItem(`chlo-${key}-column-width`)) || 380; } catch { /* Use the default when storage is disabled. */ }
    const apply = value => {
        const maximum = Math.max(280, parent.clientWidth - 370);
        const width = Math.min(maximum, Math.max(280, value));
        parent.style.setProperty('--chlo-list-column-width', `${width}px`);
        divider.setAttribute('aria-valuenow', String(Math.round(width)));
        divider.setAttribute('aria-valuemin', '280');
        divider.setAttribute('aria-valuemax', String(Math.round(maximum)));
    };
    const save = value => {
        preferred = Math.min(Math.max(280, parent.clientWidth - 370), Math.max(280, value));
        try { localStorage.setItem(`chlo-${key}-column-width`, String(preferred)); } catch { /* Resizing still works in this session. */ }
        apply(preferred);
    };
    let dragging = false;
    let originX, originWidth;
    divider.addEventListener('pointerdown', event => {
        dragging = true;
        originX = event.clientX;
        originWidth = Number(divider.getAttribute('aria-valuenow'));
        divider.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    divider.addEventListener('pointermove', event => { if (dragging) save(originWidth + event.clientX - originX); });
    divider.addEventListener('pointerup', () => dragging = false);
    divider.addEventListener('pointercancel', () => dragging = false);
    divider.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            save(Number(divider.getAttribute('aria-valuenow')) + (event.key === 'ArrowRight' ? 20 : -20));
        }
    });
    new ResizeObserver(() => apply(preferred)).observe(parent);
    apply(preferred);
}

/** Full-page configuration; dividers resize its internal columns. */
export function initConfigurationWorkspace() {
    const panel = document.getElementById('left-nav-panel');
    const header = document.createElement('header');
    header.id = 'chlo-config-header';
    header.innerHTML = '<div><small>ChloLirium</small><h2>Response configuration</h2></div><button type="button" class="menu_button" aria-label="Close configuration">×</button>';
    panel.prepend(header);
    const sync = () => {
        const active = panel.classList.contains('chlo-preset-panel');
        const open = active && panel.classList.contains('openDrawer');
        document.body.classList.toggle('chlo-config-open', open);
        const manager = document.getElementById('completion_prompt_manager');
        manager?.classList.toggle('scrollableInner', active && innerWidth > 700);
        const page = document.getElementById('openai-tab-content-prompts');
        if (active && page && !document.getElementById('chlo-prompt-editor-empty')) {
            const empty = document.createElement('aside');
            empty.id = 'chlo-prompt-editor-empty';
            empty.innerHTML = '<h3>Your prompt blocks</h3><p>Select a block on the left to edit it here.</p><p>Drag its ⠿ handle to rearrange it. Use “Show group controls” to move it to another group. Save preset keeps your organization.</p>';
            page.append(empty);
        }
        if (active && page) mountColumnDivider(page, 'blocks', 'Resize block list');
        const library = document.getElementById('chlo-preset-collection');
        if (active && library) mountColumnDivider(library, 'library', 'Resize preset list');
    };
    header.querySelector('button').addEventListener('click', async () => {
        if (!await confirmPromptSwitch(promptManager)) return;
        promptManager?.hidePopup();
        promptManager?.clearEditForm();
        document.querySelector('#ai-config-button > .drawer-toggle')?.click();
    });
    let approvedNavigation = false;
    panel.addEventListener('click', async event => {
        const tab = event.target.closest('.openai-tab-button');
        if (!tab || approvedNavigation || !promptManager?.workspaceFormSnapshot) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!await confirmPromptSwitch(promptManager)) return;
        promptManager.hidePopup();
        promptManager.clearEditForm();
        approvedNavigation = true;
        tab.click();
        approvedNavigation = false;
    }, true);
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', sync);
    synchronize = sync;
    sync();
}

import { promptManager } from '../../openai.js';
import { confirmPromptSwitch } from './workspace.js';

let synchronize = () => {};
export function syncConfigurationWorkspace() { synchronize(); }

/** Resize the existing configuration drawer; closing it restores native geometry. */
export function initConfigurationWorkspace() {
    const panel = document.getElementById('left-nav-panel');
    const header = document.createElement('header');
    header.id = 'chlo-config-header';
    header.innerHTML = '<div><small>ChloLirium</small><h2>Response configuration</h2></div><label class="chlo-config-width">Width<input type="range" min="600" max="1600" step="20" aria-label="Configuration width"></label><button type="button" class="menu_button" aria-label="Close configuration">×</button>';
    panel.prepend(header);
    const resize = document.createElement('div');
    resize.id = 'chlo-config-resize';
    resize.tabIndex = 0;
    resize.setAttribute('role', 'separator');
    resize.setAttribute('aria-orientation', 'vertical');
    resize.setAttribute('aria-label', 'Resize configuration');
    panel.append(resize);
    let preferred;
    try { preferred = Number(localStorage.getItem('chlo-configuration-width')) || undefined; } catch { /* Storage can be disabled. */ }
    const sync = () => {
        const active = panel.classList.contains('chlo-preset-panel');
        const open = active && panel.classList.contains('openDrawer');
        if (open && !document.body.classList.contains('chlo-config-open')) {
            document.body.style.setProperty('--chlo-config-left', `${Math.max(0, Math.min(160, panel.getBoundingClientRect().left))}px`);
        }
        document.body.classList.toggle('chlo-config-open', open);
        const left = parseFloat(document.body.style.getPropertyValue('--chlo-config-left')) || 0;
        const available = Math.max(280, innerWidth - left - 12);
        const width = Math.min(available, Math.max(600, preferred ?? Math.min(1100, innerWidth * .6)));
        document.body.style.setProperty('--chlo-config-width', `${width}px`);
        document.body.classList.toggle('chlo-config-split', open && innerWidth > 1100 && available - width >= 350);
        const input = header.querySelector('input');
        input.max = String(Math.floor(available / 20) * 20);
        input.value = String(width);
        resize.setAttribute('aria-valuenow', String(Math.round(width)));
        resize.setAttribute('aria-valuemin', '600');
        resize.setAttribute('aria-valuemax', String(available));
        const manager = document.getElementById('completion_prompt_manager');
        manager?.classList.toggle('scrollableInner', active && innerWidth > 700);
        const page = document.getElementById('openai-tab-content-prompts');
        if (active && page && !document.getElementById('chlo-prompt-editor-empty')) {
            const empty = document.createElement('aside');
            empty.id = 'chlo-prompt-editor-empty';
            empty.innerHTML = '<h3>Your prompt blocks</h3><p>Select a block on the left to edit it here.</p><p>Use “Organize editor groups” to choose where blocks appear. The sending order remains separate.</p>';
            page.append(empty);
        }
    };
    const setWidth = value => {
        preferred = Math.max(600, Math.min(innerWidth - 12, value));
        try { localStorage.setItem('chlo-configuration-width', String(preferred)); } catch { /* Session resizing still works. */ }
        sync();
    };
    header.querySelector('input').addEventListener('input', event => setWidth(Number(event.target.value)));
    header.querySelector('button').addEventListener('click', async () => {
        if (!await confirmPromptSwitch(promptManager)) return;
        promptManager?.hidePopup();
        promptManager?.clearEditForm();
        document.querySelector('#ai-config-button > .drawer-toggle')?.click();
    });
    let dragging = false;
    resize.addEventListener('pointerdown', event => { dragging = true; resize.setPointerCapture(event.pointerId); event.preventDefault(); });
    resize.addEventListener('pointermove', event => { if (dragging) setWidth(event.clientX - panel.getBoundingClientRect().left); });
    resize.addEventListener('pointerup', () => dragging = false);
    resize.addEventListener('pointercancel', () => dragging = false);
    resize.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(panel.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20)); }
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

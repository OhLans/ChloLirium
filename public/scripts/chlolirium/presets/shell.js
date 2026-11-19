import { promptManager } from '../../openai.js';
import { confirmPromptSwitch } from './workspace.js';

let synchronize = () => {};
export function syncConfigurationWorkspace() { synchronize(); }

/** A compact header mounted in the original configuration drawer. */
export function initConfigurationWorkspace() {
    const panel = document.getElementById('left-nav-panel');
    const header = document.createElement('header');
    header.id = 'chlo-config-header';
    header.innerHTML = '<div class="chlo-config-title"><small>ChloLirium</small><h2>Response configuration</h2></div><div class="chlo-config-tabs"></div><div class="chlo-config-actions"><button type="button" class="menu_button" aria-label="Close configuration">×</button></div>';
    panel.prepend(header);
    const tabsSlot = header.querySelector('.chlo-config-tabs');
    const actions = header.querySelector('.chlo-config-actions');
    const pin = document.getElementById('lm_button_panel_pin_div');
    const pinAnchor = document.createComment('native configuration pin position');
    pin.before(pinAnchor);
    const sync = () => {
        const active = panel.classList.contains('chlo-preset-panel');
        const tabs = panel.querySelector('.openai-tab-buttons');
        if (active && tabs && tabs.parentElement !== tabsSlot) tabsSlot.append(tabs);
        if (active && pin.parentElement !== actions) actions.prepend(pin);
        if (!active && pin.parentElement === actions) pinAnchor.after(pin);
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
    synchronize = sync;
    sync();
}

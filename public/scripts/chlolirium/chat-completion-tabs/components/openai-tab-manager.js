/**
 * Keep preset selection, parameters and the native prompt editor in the
 * existing Chat Completion drawer.
 */

// Import required functions
import { main_api } from '../../../../script.js';
import { oai_settings } from './../../../openai.js';
import { TabManager } from './tab-manager.js';
import { mountPresetActions } from '../../presets/actions.js';

export class OpenAITabManager {
    constructor() {
        this.panel = document.getElementById('left-nav-panel');
        this.popup = document.getElementById('completion_prompt_manager_popup');
        this.popupAnchor = document.createComment('native prompt editor position');
        this.popup.before(this.popupAnchor);
        const role = document.getElementById('completion_prompt_manager_popup_entry_form_role').parentElement;
        const triggers = document.getElementById('completion_prompt_manager_popup_entry_form_injection_trigger').parentElement;
        const placement = document.getElementById('completion_prompt_manager_popup_entry_form_injection_position').closest('.flex-container');
        this.promptOptions = [role, triggers, placement].map(node => {
            const anchor = document.createComment('native prompt option position');
            node.before(anchor);
            return { node, anchor };
        });
        this.options = document.createElement('details');
        this.options.className = 'chlo-inline-prompt-options';
        this.options.innerHTML = '<summary>Role, triggers & placement</summary>';
        this.tabManager = new TabManager({
            containerSelector: '#left-nav-panel #openai_api-presets',
            insertAfterSelector: '#left-nav-panel #openai_api-presets > div',
            tabPrefix: 'openai-tab',
            defaultTab: 'presets',
            className: 'openai-tab',
            onTabSwitch: view => this.panel.dataset.presetView = view,
            tabs: {
                presets: {
                    label: 'Presets',
                    icon: 'fa-solid fa-layer-group',
                    contentSelectors: ['#chlo-preset-collection'],
                },
                parameters: {
                    label: 'Parameters',
                    icon: 'fa-solid fa-vial',
                    contentSelectors: [
                        '#left-nav-panel #range_block_openai',
                        '#left-nav-panel #openai_settings',
                        '#left-nav-panel #logit_bias_openai',
                        '#left-nav-panel [data-source*="openai"]:not(.openai-tab-content):not(.openai-tab-buttons)',
                    ],
                },
                prompts: {
                    label: 'Prompts',
                    icon: 'fa-solid fa-file-edit',
                    contentSelectors: [
                        '#left-nav-panel #completion_prompt_manager',
                    ],
                },
            },
            checkCondition: () => {
                return typeof main_api !== 'undefined' &&
                       main_api === 'openai' &&
                       typeof oai_settings !== 'undefined' &&
                       document.querySelector('#left-nav-panel') !== null;
            },
        });

        this.enabled = true;
        this.syncLayout();
        this.wasOpen = this.panel.classList.contains('openDrawer');
        new MutationObserver(() => {
            const open = this.panel.classList.contains('openDrawer');
            if (open && !this.wasOpen && this.enabled && this.isTabsCreated && !this.popup.classList.contains('openDrawer')) this.tabManager.switchTab('presets');
            this.wasOpen = open;
        }).observe(this.panel, { attributes: true, attributeFilter: ['class'] });
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.tabManager.setEnabled(enabled);
        this.syncLayout();
    }

    refreshTabs() {
        this.tabManager.refreshTabs();
        this.syncLayout();
    }

    syncLayout() {
        const active = this.enabled && main_api === 'openai' && this.isTabsCreated;
        this.panel.classList.toggle('chlo-preset-panel', active);
        mountPresetActions(active);
        if (active) {
            const container = document.getElementById('openai-tab-content-prompts');
            // The outer drawer opens all descendant .drawer-content nodes.
            // Inline edit/inspect is a page, so it must not open with the drawer.
            this.popup.classList.remove('drawer-content');
            if (!container.contains(this.popup)) container.append(this.popup);
            if (!this.options.isConnected) {
                const footer = this.popup.querySelector('.completion_prompt_manager_popup_entry_form_footer');
                footer.before(this.options);
                this.promptOptions.forEach(({ node }) => this.options.append(node));
            }
        } else if (this.popup.previousSibling !== this.popupAnchor) {
            this.promptOptions.forEach(({ node, anchor }) => anchor.after(node));
            this.options.remove();
            this.popup.classList.add('drawer-content');
            this.popupAnchor.after(this.popup);
        }
    }

    // Backward compatibility methods
    get activeTab() {
        return this.tabManager.activeTab;
    }

    get isTabsCreated() {
        return this.tabManager.isTabsCreated;
    }
}

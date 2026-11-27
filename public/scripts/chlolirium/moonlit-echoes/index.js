import { getContext } from '../context.js';
import { THEME_VERSION } from './src/config/theme-info.js';
export { THEME_VERSION } from './src/config/theme-info.js';

import { t } from '../../i18n.js';
import { power_user, refreshLegacyThemeOptions, registerThemeAppearance } from '../../power-user.js';
import { appearanceSnapshot } from '../user-settings/theme-data.js';
import { tabMappings, themeCustomSettings } from './src/config/theme-settings.js';
import { settingsKey, getSettings as getExtensionSettings, saveSettings as saveExtensionSettings } from './src/services/settings-service.js';
import { initializeSlashCommands } from './src/services/slash-commands.js';
import { initThemeSettings } from './src/bootstrap/init-theme.js';
import { registerChatDisplaySelect } from './src/services/chat-controls.js';
import { initControls } from './src/ui/controls.js';
import { configureSettingsTabs, createTabbedSettingsUI } from './src/ui/settings-tabs.js';
import {
    configureSettingsFactory,
    createCustomSettingsUI,
    createSettingItem,
    updateSettingsUI,
    addModernCompactStyles,
} from './src/ui/settings-factory.js';
import { applyAllThemeSettings as applyAllThemeSettingsCore } from './src/core/theme-applier.js';
import { initAvatarInjector, initFormSheldHeightMonitor } from './src/core/observers.js';

// Track if custom chat styles have been added
let customChatStylesAdded = false;

export function applyAllThemeSettings(contextOverride) {
    return applyAllThemeSettingsCore(settingsKey, themeCustomSettings, contextOverride);
}


/**
 * Initialize native appearance controls and theme events
 * Includes settings panel, chat style and color picker
 */
function initThemeUI() {
    configureSettingsTabs({
        t,
        tabMappings,
        themeCustomSettings,
        createSettingItem,
        addModernCompactStyles,
    });

    renderThemeSettings();
    initChatDisplaySwitcher();
    initAvatarInjector();

    // Account settings hold the live values, including edits made since the
    // last theme save. Opening the app must not re-apply the saved preset.
    applyCurrentAppearance();
    registerThemeAppearance({
        capture: () => appearanceSnapshot(getExtensionSettings(), themeCustomSettings),
        normalize: normalizeExtendedAppearance,
        apply: applyAppearanceSnapshot,
        names: () => Object.keys(getExtensionSettings()?.presets ?? {}),
        legacy: getLegacyAppearance,
        removeLegacy: removeLegacyAppearance,
    });

    // Add modern compact styles
    addModernCompactStyles();

    // Initialize theme-specific message interactions
    initControls();

    // Initialize slash commands (only when enabled)
    initializeSlashCommands();
}

/** The old appearance catalog remains readable for existing themes and scripts. */
function getLegacyAppearance(name) {
    const presets = getExtensionSettings()?.presets ?? {};
    return Object.hasOwn(presets, name) ? presets[name] : null;
}

function removeLegacyAppearance(name) {
    const settings = getExtensionSettings();
    if (!getLegacyAppearance(name)) return;
    delete settings.presets[name];
    if (settings.activePreset === name) settings.activePreset = Object.keys(settings.presets)[0];
}

function applyCurrentAppearance() {
    const settings = getExtensionSettings();
    for (const { varId } of themeCustomSettings) applyThemeSetting(varId, settings[varId]);
    applyAllThemeSettings();
    updateSettingsUI();
}

function normalizeExtendedAppearance(values) {
    const { enabled, useOriginalAvatarImages } = getExtensionSettings();
    return appearanceSnapshot(values, themeCustomSettings, { enabled, useOriginalAvatarImages });
}

function applyAppearanceSnapshot(values) {
    const settings = getExtensionSettings();
    Object.assign(settings, normalizeExtendedAppearance(values));
    const enabledControl = document.getElementById(`${settingsKey}-enabled`);
    if (enabledControl) enabledControl.checked = settings.enabled;
    const avatars = document.getElementById(`${settingsKey}-use-original-avatars`);
    if (avatars) avatars.checked = settings.useOriginalAvatarImages;
    toggleCss(settings.enabled);
    applyCurrentAppearance();
    window.updateAvatars?.();
}

function loadLegacyAppearance(name) {
    const values = getLegacyAppearance(name);
    if (!values) return false;
    const settings = getExtensionSettings();
    settings.activePreset = name;
    const select = document.getElementById('themes');
    if (select && [...select.options].some(option => option.value === name)) {
        select.value = name;
        select.dispatchEvent(new Event('change'));
    } else {
        applyAppearanceSnapshot(values);
        saveExtensionSettings();
    }
    return true;
}

/**
 * Automatically load or remove CSS based on enabled status in settings
 * @param {boolean} shouldLoad - If true, load CSS, otherwise remove
 */
export function toggleCss(shouldLoad) {
    // Get existing <link> elements
    const existingLinkStyle = document.getElementById('MoonlitEchosTheme-style');
    const existingLinkExt = document.getElementById('MoonlitEchosTheme-extension');

    if (shouldLoad) {
        // Determine base URL path
        const baseUrl = getBaseUrl();

        // Load theme style
        if (!existingLinkStyle) {
            const cssUrl = baseUrl + '/style.css';
            const linkStyle = document.createElement('link');
            linkStyle.id = 'MoonlitEchosTheme-style';
            linkStyle.rel = 'stylesheet';
            linkStyle.href = cssUrl;
            document.head.append(linkStyle);
        }

        // Load extension style
        if (!existingLinkExt) {
            const extUrl = baseUrl + '/extension.css';
            const linkExt = document.createElement('link');
            linkExt.id = 'MoonlitEchosTheme-extension';
            linkExt.rel = 'stylesheet';
            linkExt.href = extUrl;
            document.head.append(linkExt);
        }

        // Re-apply all checkbox styles if they were enabled
        updateAllCheckboxStyles(true);
    } else {
        // Remove CSS
        if (existingLinkStyle) existingLinkStyle.remove();
        if (existingLinkExt) existingLinkExt.remove();

        // Clear all checkbox styles
        clearAllCheckboxStyles();
    }
}

/**
 * Clear all CSS styles added by checkboxes
 */
function clearAllCheckboxStyles() {
    // Find all style elements created by checkboxes
    document.querySelectorAll('style[id^="css-block-"]').forEach(element => {
        element.textContent = '';
    });
}

/**
 * Update all checkbox styles based on their current settings and extension state
 * @param {boolean} extensionEnabled - Whether the extension is enabled
 */
function updateAllCheckboxStyles(extensionEnabled) {
    if (!extensionEnabled) {
        clearAllCheckboxStyles();
        return;
    }

    // Get settings
    const context = getContext();
    const settings = getExtensionSettings(context);

    // Go through all checkbox settings and update their styles
    themeCustomSettings.forEach(setting => {
        if (setting.type === 'checkbox' && (setting.cssBlock || setting.cssFile)) {
            const varId = setting.varId;
            const enabled = settings[varId] === true;
            const styleElement = document.getElementById(`css-block-${varId}`);

            if (styleElement) {
                if (setting.cssBlock && enabled) {
                    styleElement.textContent = setting.cssBlock;
                } else {
                    styleElement.textContent = '';
                }
            }
        }
    });
}

/**
* Get the base URL path for the extension
* @returns {string} Base URL for the extension
*/
function getBaseUrl() {
    let baseUrl = '';

    // Try various possible path retrieval methods
    if (typeof import.meta !== 'undefined' && import.meta.url) {
        baseUrl = new URL('.', import.meta.url).href;
    } else {
        const currentScript = document.currentScript;
        if (currentScript && currentScript.src) {
            baseUrl = currentScript.src.substring(0, currentScript.src.lastIndexOf('/'));
        } else {
        // If above methods fail, use hardcoded path
            baseUrl = `${window.location.origin}/scripts/chlolirium/moonlit-echoes`;
        }
    }

    return baseUrl;
}

/**
 * Render the native appearance controls and wire up their settings.
 */
function renderThemeSettings() {
    const context = getContext();
    const settingsContainer = document.getElementById('chlo-theme-settings');
    if (!settingsContainer) {
        return;
    }

    // Find existing settings drawer to avoid duplication
    let existingDrawer = settingsContainer.querySelector(`#${settingsKey}-drawer`);
    if (existingDrawer) {
        return; // Don't recreate if exists
    }

    // Create settings drawer
    const inlineDrawer = document.createElement('div');
    inlineDrawer.id = `${settingsKey}-drawer`;
    inlineDrawer.classList.add('inline-drawer');
    settingsContainer.append(inlineDrawer);

    // Create drawer title
    const inlineDrawerToggle = document.createElement('button');
    inlineDrawerToggle.type = 'button';
    inlineDrawerToggle.setAttribute('aria-expanded', 'false');
    inlineDrawerToggle.setAttribute('aria-controls', 'chlo-appearance-controls');
    inlineDrawerToggle.classList.add('inline-drawer-toggle', 'inline-drawer-header');

    const appearanceLabel = document.createElement('b');
    appearanceLabel.textContent = t`Appearance`;

    const inlineDrawerIcon = document.createElement('div');
    inlineDrawerIcon.classList.add('inline-drawer-icon', 'fa-solid', 'fa-circle-chevron-down', 'down');

    inlineDrawerToggle.append(appearanceLabel, inlineDrawerIcon);

    // Create settings content area
    const inlineDrawerContent = document.createElement('div');
    inlineDrawerContent.id = 'chlo-appearance-controls';
    inlineDrawerContent.classList.add('inline-drawer-content');

    // Add to drawer
    inlineDrawer.append(inlineDrawerToggle, inlineDrawerContent);

    // Get settings
    const settings = getExtensionSettings(context);

    // Create enable switch
    const enabledCheckboxLabel = document.createElement('label');
    enabledCheckboxLabel.classList.add('checkbox_label');
    enabledCheckboxLabel.htmlFor = `${settingsKey}-enabled`;

    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.id = `${settingsKey}-enabled`;
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.checked = settings.enabled;

    enabledCheckbox.addEventListener('change', () => {
        settings.enabled = enabledCheckbox.checked;
        toggleCss(settings.enabled);

        // Update custom chat styles when enabled status changes
        updateCustomChatStyles();

        // Re-initialize slash commands based on enabled status
        if (settings.enabled) {
            initializeSlashCommands();
        }

        saveExtensionSettings(context);
    });

    const enabledCheckboxText = document.createElement('span');
    enabledCheckboxText.textContent = t`Enable extended appearance`;

    enabledCheckboxLabel.append(enabledCheckbox, enabledCheckboxText);
    inlineDrawerContent.append(enabledCheckboxLabel);

    // Toggle using original avatar images instead of thumbnails
    const originalAvatarLabel = document.createElement('label');
    originalAvatarLabel.classList.add('checkbox_label');
    originalAvatarLabel.htmlFor = `${settingsKey}-use-original-avatars`;

    const originalAvatarCheckbox = document.createElement('input');
    originalAvatarCheckbox.id = `${settingsKey}-use-original-avatars`;
    originalAvatarCheckbox.type = 'checkbox';
    originalAvatarCheckbox.checked = settings.useOriginalAvatarImages === true;

    originalAvatarCheckbox.addEventListener('change', () => {
        settings.useOriginalAvatarImages = originalAvatarCheckbox.checked;
        saveExtensionSettings(context);
        window.updateAvatars?.();
    });

    const originalAvatarText = document.createElement('span');
    originalAvatarText.textContent = t`Use original character avatars in chat messages`;

    originalAvatarLabel.append(originalAvatarCheckbox, originalAvatarText);
    inlineDrawerContent.append(originalAvatarLabel);

    // Create tabbed settings UI
    createTabbedSettingsUI(inlineDrawerContent, settings);

    // The shared drawer handler animates the content and updates the icon.
    inlineDrawerToggle.addEventListener('click', function () {
        this.setAttribute('aria-expanded', String(this.getAttribute('aria-expanded') !== 'true'));
    });
}

/**
 * Update custom chat styles based on extension enabled status
 */
function updateCustomChatStyles() {
    // No-op: options are now permanent; nothing to add/remove on enable toggle
}

/**
 * Remove custom chat styles when theme is disabled
 */
export function removeCustomChatStyles() {
    // Intentionally empty: we no longer remove options when the theme is disabled
}

/**
 * Create tabbed settings UI with state persistence - Updated tab name
 * @param {HTMLElement} container - Container to add tabbed settings
 * @param {Object} settings - Current settings object
 */

/**
 * Populate tab content with sections and settings
 * Modified to support always-expanded first sections
 * @param {Array} tabs - Tab configuration objects
 * @param {HTMLElement} tabContents - Container for tab content
 * @param {Object} settings - Current settings object
 * @param {boolean} firstSectionAlwaysExpanded - Whether to keep first section expanded
 */

/**
 * Enhanced populateTabContent without expand/collapse all buttons
 * @param {Array} tabs - Tab configuration objects
 * @param {HTMLElement} tabContents - Container for tab content
 * @param {Object} settings - Current settings object
 */

/**
 * Save section expand/collapse state to localStorage
 * @param {string} category - Category ID
 * @param {boolean} isExpanded - Whether section is expanded
 */

/**
* Create preset manager UI
* @param {HTMLElement} container - Container to add preset manager
* @param {Object} settings - Current settings object
*/
/**
 * Initialize chat appearance switcher - only when theme is enabled
 * Handle switching between different chat styles
 */
function initChatDisplaySwitcher() {
    const themeSelect = document.getElementById('themes');
    const chatDisplaySelect = document.getElementById('chat_display');
    if (!themeSelect || !chatDisplaySelect) return;

    // Keep a session reference so slash commands keep working while the host
    // (TauriTavern) has the settings drawer detached from the document.
    registerChatDisplaySelect(chatDisplaySelect);

    // Add our custom options exactly once (regardless of theme enabled)
    function addCustomStyleOptions() {
        if (customChatStylesAdded) return;

        const ensureOption = (value, label) => {
            if (!chatDisplaySelect.querySelector(`option[value="${value}"]`)) {
                const opt = document.createElement('option');
                opt.value = value;
                opt.text = label;
                chatDisplaySelect.appendChild(opt);
            }
        };

        // Ensure all custom styles exist
        ensureOption('3', t`Echo`);
        ensureOption('4', t`Whisper`);
        ensureOption('5', t`Hush`);
        ensureOption('6', t`Ripple`);
        ensureOption('7', t`Tide`);

        customChatStylesAdded = true;
    }

    addCustomStyleOptions();

    // Older builds restored a browser-only chat style over the account value.
    // Adopt it once, then let the native UI theme own this setting.
    const legacyStyle = localStorage.getItem('savedChatStyle');
    const savedStyle = legacyStyle ?? String(power_user.chat_display);
    if ([...chatDisplaySelect.options].some(option => option.value === savedStyle)) {
        chatDisplaySelect.value = savedStyle;
        chatDisplaySelect.dispatchEvent(new Event('change'));
    }
    if (legacyStyle !== null) localStorage.removeItem('savedChatStyle');
}


/**
* Apply single theme setting
* @param {string} varId - CSS variable ID
* @param {string} value - Setting value
*/
export function applyThemeSetting(varId, value) {
    // Directly set CSS variable
    document.documentElement.style.setProperty(`--${varId}`, value, 'important');

    // Trigger custom event
    document.dispatchEvent(new CustomEvent('themeSettingChanged', {
        detail: { varId, value },
    }));
}
// Inject raw CSS (unfiltered) into the page via a dedicated <style> tag
function applyRawCustomCss(cssText) {
    let rawStyle = document.getElementById('moonlit-raw-css');
    if (!rawStyle) {
        rawStyle = document.createElement('style');
        rawStyle.id = 'moonlit-raw-css';
        // DO NOT sanitize or filter; user explicitly wants full control
        document.head.appendChild(rawStyle);
    }
    rawStyle.textContent = cssText || '';
}
// Re-apply when the setting changes (optional safety net)
document.addEventListener('themeSettingChanged', (ev) => {
    const { varId, value } = ev.detail || {};
    if (varId === 'rawCustomCss') {
        applyRawCustomCss(value);
    }
});

/**
 * Convert RGBA to HEX - enhanced version
 * Support more formats and better error handling
 * @param {string} rgba - RGBA color string
 * @returns {string|null} HEX color string or null
 */


/**
* Dynamically add a new custom setting
* Use this function to add new settings at runtime
* @param {Object} settingConfig - Setting configuration object
*/
export function addCustomSetting(settingConfig) {
    // Check setting validity
    if (!settingConfig || !settingConfig.varId || !settingConfig.type) {
        return;
    }

    // Check if already exists
    const existing = themeCustomSettings.find(s => s.varId === settingConfig.varId);
    if (existing) {
        return;
    }

    // Add to setting configuration
    themeCustomSettings.push(settingConfig);

    // Get settings and add default value
    const context = getContext();
    const settings = getExtensionSettings(context);

    // If settings don't have this item, add default value
    if (settings[settingConfig.varId] === undefined) {
        settings[settingConfig.varId] = settingConfig.default;
    }

    // Save settings
    saveExtensionSettings(context);

    // Re-render settings panel
    const settingsContainer = document.querySelector(`#${settingsKey}-drawer .inline-drawer-content`);
    if (settingsContainer) {
        // Clear existing settings (keep enable switch)
        const enabledCheckbox = settingsContainer.querySelector(`#${settingsKey}-enabled`).parentElement;
        const separator = settingsContainer.querySelector('hr');

        // Clear child elements
        while (settingsContainer.lastChild) {
            settingsContainer.removeChild(settingsContainer.lastChild);
        }

        // Re-add enable switch
        settingsContainer.appendChild(enabledCheckbox);
        settingsContainer.appendChild(separator);

        // Recreate settings
        createCustomSettingsUI(settingsContainer, settings);
    }
}

configureSettingsFactory({
    applyThemeSetting,
    applyRawCustomCss,
});

export { addModernCompactStyles };

function runStartupDomReadyTasks() {
    try {
        addModernCompactStyles();
    } catch (error) {
        console.error('Moonlit Echoes failed to add compact styles', error);
    }

    try {
        refreshLegacyThemeOptions();
    } catch (error) {
        console.error('Could not refresh legacy appearance themes', error);
    }
}

function initializeThemeColorOnDemand() {
    applyAllThemeSettings();
    refreshLegacyThemeOptions();
}

function setupPublicMoonlitApi() {
    window.initializeThemeColorOnDemand = initializeThemeColorOnDemand;

    window.MoonlitEchoesTheme = {
        init: function () {
            applyAllThemeSettings();
            initializeThemeColorOnDemand();
            refreshLegacyThemeOptions();
        },

        addSetting: addCustomSetting,

        applySetting: applyThemeSetting,

        getSettings: function () {
            return getExtensionSettings();
        },

        getSettingsConfig: function () {
            return [...themeCustomSettings];
        },

        presets: {
            getAll: function () {
                const context = getContext();
                const settings = getExtensionSettings(context);
                return settings?.presets || {};
            },

            getActive: function () {
                const context = getContext();
                const settings = getExtensionSettings(context);
                return {
                    name: settings.activePreset,
                    settings: settings.presets[settings.activePreset] || {},
                };
            },

            create: function (name, settingsObj) {
                const context = getContext();
                const settings = getExtensionSettings(context);

                if (!name || typeof name !== 'string') {
                    return false;
                }

                settings.presets[name] = settingsObj || {};
                saveExtensionSettings(context);
                refreshLegacyThemeOptions();

                return true;
            },

            load: function (name) {
                return loadLegacyAppearance(name);
            },

            update: function (name, settingsObj) {
                const context = getContext();
                const settings = getExtensionSettings(context);

                if (!settings.presets[name]) {
                    return false;
                }

                settings.presets[name] = settingsObj || settings.presets[name];
                saveExtensionSettings(context);

                return true;
            },

            delete: function (name) {
                const context = getContext();
                const settings = getExtensionSettings(context);

                if (name === 'Default') {
                    return false;
                }

                if (!settings.presets[name]) {
                    return false;
                }

                if (Object.keys(settings.presets).length <= 1) {
                    return false;
                }

                if (settings.activePreset === name) {
                    settings.activePreset = 'Default';
                    if (getLegacyAppearance('Default')) applyAppearanceSnapshot(getLegacyAppearance('Default'));
                }

                delete settings.presets[name];
                saveExtensionSettings(context);
                refreshLegacyThemeOptions();

                return true;
            },

            export: function (name) {
                const context = getContext();
                const settings = getExtensionSettings(context);

                if (!settings.presets[name]) {
                    return null;
                }

                return {
                    moonlitEchoesPreset: true,
                    presetVersion: THEME_VERSION,
                    presetName: name,
                    settings: settings.presets[name],
                };
            },

            import: function (jsonData) {
                if (!jsonData || !jsonData.moonlitEchoesPreset || !jsonData.presetName || !jsonData.settings) {
                    return false;
                }

                const context = getContext();
                const settings = getExtensionSettings(context);
                const presetName = jsonData.presetName;

                settings.presets[presetName] = jsonData.settings;
                saveExtensionSettings(context);
                refreshLegacyThemeOptions();

                return true;
            },
        },
    };

    window.formSheldHeightController = initFormSheldHeightMonitor();
}

let initialized = false;

export async function initMoonlitTheme() {
    if (initialized) return;
    initialized = true;
    setupPublicMoonlitApi();
    await initThemeSettings({ initThemeUI, toggleCss });
    runStartupDomReadyTasks();
}

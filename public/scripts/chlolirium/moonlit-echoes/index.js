import { getContext } from '../context.js';
import { THEME_VERSION } from './src/config/theme-info.js';
export { THEME_VERSION } from './src/config/theme-info.js';

import { t } from '../../i18n.js';
import { power_user, refreshLegacyThemeOptions, registerThemeAppearance } from '../../power-user.js';
import { appearanceSnapshot, withoutLegacyAppearanceToggle } from '../user-settings/theme-data.js';
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
} from './src/ui/settings-factory.js';
import { applyAppearanceProperty } from './src/core/theme-applier.js';
import { initAvatarInjector, initFormSheldHeightMonitor } from './src/core/observers.js';

function applyAppearanceStyles(settings) {
    for (const setting of themeCustomSettings) {
        if (setting.varId !== 'rawCustomCss') applyAppearanceValue(setting, settings[setting.varId]);
    }
    applyThemeSetting('rawCustomCss', settings.rawCustomCss);
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
    });

    // Account settings hold live edits that may not have been saved as a theme.
    applyAppearanceStyles(getExtensionSettings());
    renderThemeSettings();
    initChatDisplaySwitcher();
    initAvatarInjector();

    registerThemeAppearance({
        capture: () => appearanceSnapshot(getExtensionSettings(), themeCustomSettings),
        normalize: normalizeExtendedAppearance,
        apply: applyAppearanceSnapshot,
        names: () => Object.keys(getExtensionSettings()?.presets ?? {}),
        legacy: getLegacyAppearance,
        removeLegacy: removeLegacyAppearance,
    });

    // Initialize theme-specific message interactions
    initControls();

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

function normalizeExtendedAppearance(values) {
    const { useOriginalAvatarImages } = getExtensionSettings();
    return appearanceSnapshot(values, themeCustomSettings, { useOriginalAvatarImages });
}

function applyAppearanceSnapshot(values) {
    const settings = getExtensionSettings();
    const next = normalizeExtendedAppearance(values);
    const changed = new Set(Object.keys(next).filter(key => settings[key] !== next[key]));
    Object.assign(settings, next);

    applyAppearanceStyles(next);
    if (changed.size) updateSettingsUI(changed);
    if (changed.has('useOriginalAvatarImages')) {
        const avatars = document.getElementById(`${settingsKey}-use-original-avatars`);
        if (avatars) avatars.checked = next.useOriginalAvatarImages;
        window.updateAvatars?.();
    }
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

/** Register the built-in chat layouts and restore the saved layout. */
function initChatDisplaySwitcher() {
    const themeSelect = document.getElementById('themes');
    const chatDisplaySelect = document.getElementById('chat_display');
    if (!themeSelect || !chatDisplaySelect) return;

    // Keep a session reference so slash commands keep working while the host
    // (TauriTavern) has the settings drawer detached from the document.
    registerChatDisplaySelect(chatDisplaySelect);

    for (const [value, label] of [['3', t`Echo`], ['4', t`Whisper`], ['5', t`Hush`], ['6', t`Ripple`], ['7', t`Tide`]]) {
        if (!chatDisplaySelect.querySelector(`option[value="${value}"]`)) {
            chatDisplaySelect.append(new Option(label, value));
        }
    }

    // Older builds restored a browser-only chat style over the account value.
    // Adopt it once, then let the native UI theme own this setting.
    const legacyStyle = localStorage.getItem('savedChatStyle');
    const savedStyle = legacyStyle ?? String(power_user.chat_display);
    if (chatDisplaySelect.value !== savedStyle && [...chatDisplaySelect.options].some(option => option.value === savedStyle)) {
        chatDisplaySelect.value = savedStyle;
        chatDisplaySelect.dispatchEvent(new Event('change'));
    }
    if (legacyStyle !== null) localStorage.removeItem('savedChatStyle');
}


/** Notify listeners only when a style actually changes. */
function applyAppearanceValue(setting, value) {
    const { varId } = setting;
    const changed = varId === 'rawCustomCss' ? applyRawCustomCss(value) : applyAppearanceProperty(setting, value);
    if (!changed) return;
    document.dispatchEvent(new CustomEvent('themeSettingChanged', {
        detail: { varId, value },
    }));
}

export function applyThemeSetting(varId, value) {
    const setting = themeCustomSettings.find(item => item.varId === varId);
    applyAppearanceValue(setting ?? { varId }, value);
}

// Inject raw CSS (unfiltered) into the page via a dedicated <style> tag
function applyRawCustomCss(cssText) {
    let rawStyle = document.getElementById('moonlit-raw-css');
    if (!rawStyle && !cssText) return false;
    if (!rawStyle) {
        rawStyle = document.createElement('style');
        rawStyle.id = 'moonlit-raw-css';
        document.head.appendChild(rawStyle);
    }
    if (rawStyle.textContent === (cssText || '')) return false;
    rawStyle.textContent = cssText || '';
    return true;
}
// Also honor changes sent by older theme scripts.
document.addEventListener('themeSettingChanged', (ev) => {
    const { varId, value } = ev.detail || {};
    if (varId === 'rawCustomCss') {
        applyRawCustomCss(value);
    }
});

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

    applyThemeSetting(settingConfig.varId, settings[settingConfig.varId]);
    saveExtensionSettings(context);

    // Re-render settings panel
    const settingsContainer = document.querySelector(`#${settingsKey}-drawer .inline-drawer-content`);
    if (settingsContainer) {
        // Keep the original-avatar preference when adding custom controls.
        settingsContainer.querySelectorAll(':scope > .moonlit-tabs, :scope > .theme-setting-category').forEach(node => node.remove());
        createCustomSettingsUI(settingsContainer, settings);
    }
}

configureSettingsFactory({
    applyThemeSetting,
    applyRawCustomCss,
});

function initializeThemeColorOnDemand() {
    applyAppearanceStyles(getExtensionSettings());
    refreshLegacyThemeOptions();
}

function setupPublicMoonlitApi() {
    window.initializeThemeColorOnDemand = initializeThemeColorOnDemand;

    window.MoonlitEchoesTheme = {
        init: initializeThemeColorOnDemand,

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

                settings.presets[name] = withoutLegacyAppearanceToggle(settingsObj) || {};
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

                settings.presets[name] = withoutLegacyAppearanceToggle(settingsObj) || settings.presets[name];
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

                settings.presets[presetName] = withoutLegacyAppearanceToggle(jsonData.settings);
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
    await initThemeSettings(initThemeUI);
}

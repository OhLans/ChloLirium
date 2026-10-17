import { getContext } from '../../../context.js';
import { defaultSettings, ensureSettingsStructure } from '../config/default-settings.js';
import { settingsKey, getSettings as getExtensionSettings, saveSettings as saveExtensionSettings } from '../services/settings-service.js';

/**
 * Initialize the Moonlit Echoes theme settings and UI.
 * Handles settings bootstrapping, CSS toggling, and defers UI initialization
 * after core settings and DOM are ready.
 *
 * @param {{ initThemeUI: Function, toggleCss: Function }} dependencies - Startup dependencies provided by index.js.
 */
export async function initThemeSettings({ initThemeUI, toggleCss }) {
    const context = getContext();

    let extensionSettings = getExtensionSettings(context);
    if (!extensionSettings) {
        context.extensionSettings[settingsKey] = structuredClone(defaultSettings);
        extensionSettings = getExtensionSettings(context);
    }

    ensureSettingsStructure(extensionSettings);

    for (const key of Object.keys(defaultSettings)) {
        if (key !== 'presets' && key !== 'activePreset' && extensionSettings[key] === undefined) {
            extensionSettings[key] = defaultSettings[key];
        }
    }

    saveExtensionSettings(context);

    toggleCss(extensionSettings.enabled);

    await initThemeUI();
}

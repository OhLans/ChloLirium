import { getContext } from '../../../context.js';
import { defaultSettings, ensureSettingsStructure } from '../config/default-settings.js';
import { settingsKey, getSettings as getExtensionSettings, saveSettings as saveExtensionSettings } from '../services/settings-service.js';

/**
 * Restore native appearance settings after the account loads.
 * @param {Function} initThemeUI - Initialize the appearance controls.
 */
export async function initThemeSettings(initThemeUI) {
    const context = getContext();

    let changed = false;
    let extensionSettings = getExtensionSettings(context);
    if (!extensionSettings) {
        context.extensionSettings[settingsKey] = structuredClone(defaultSettings);
        extensionSettings = getExtensionSettings(context);
        changed = true;
    }

    changed = ensureSettingsStructure(extensionSettings) || changed;

    for (const key of Object.keys(defaultSettings)) {
        if (key !== 'presets' && key !== 'activePreset' && extensionSettings[key] === undefined) {
            extensionSettings[key] = extensionSettings.presets[extensionSettings.activePreset]?.[key] ?? defaultSettings[key];
            changed = true;
        }
    }

    if (changed) saveExtensionSettings(context);

    await initThemeUI();
}

import { eventSource, event_types, saveSettingsDebounced } from '../../../script.js';
import { extension_settings } from '../../extensions.js';
import { OpenAITabManager } from './components/openai-tab-manager.js';

let manager;

export function initCompletionTabs() {
    if (manager) return;
    const settings = extension_settings.ChatCompletionTabs ??= { enabled: true };
    settings.enabled ??= true;
    manager = new OpenAITabManager();
    manager.setEnabled(settings.enabled);
    const checkbox = document.getElementById('ChatCompletionTabs-enabled');
    checkbox.checked = settings.enabled;
    checkbox.addEventListener('change', () => {
        settings.enabled = checkbox.checked;
        manager.setEnabled(settings.enabled);
        saveSettingsDebounced();
    });
    for (const type of [event_types.MAIN_API_CHANGED, event_types.OAI_PRESET_CHANGED_AFTER, event_types.EXTENSION_SETTINGS_LOADED, event_types.APP_READY]) {
        eventSource.on(type, () => manager.refreshTabs());
    }
    // Retain the existing public debugging handle.
    window.ChatCompletionTabs = { openAITabManager: manager, VERSION: '1.0.0' };
}

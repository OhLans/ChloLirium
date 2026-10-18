import { extension_settings } from '../extensions.js';
import { saveSettingsDebounced } from '../../script.js';
import { addLocaleData, getCurrentLocale } from '../i18n.js';
import { migrateNativeInterfaceSettings } from './legacy-extensions.js';

let initialization;

async function loadInterfaceLocale() {
    const locale = getCurrentLocale();
    const sources = {
        'moonlit-echoes': ['zh-tw', 'zh-cn', 'ko-kr', 'vi-vn', 'th-th'],
        'chat-completion-tabs': ['zh-tw', 'zh-cn'],
    };
    await Promise.all(Object.entries(sources).map(async ([folder, languages]) => {
        if (!languages.includes(locale)) return;
        try {
            const response = await fetch(new URL(`./${folder}/i18n/${locale}.json`, import.meta.url));
            if (response.ok) addLocaleData(locale, await response.json());
        } catch (error) {
            console.warn('Could not load interface translations', error);
        }
    }));
}

/** Called by core settings startup, including when extensions are disabled.
 * The one shared promise prevents duplicate handlers on later settings loads. */
export function initChloLirium() {
    if (initialization) return initialization;
    initialization = (async () => {
        if (migrateNativeInterfaceSettings(extension_settings)) saveSettingsDebounced();
        await loadInterfaceLocale();
        // Theme definitions translate their labels at module evaluation. Import
        // after core localization is ready, avoiding the core module cycles.
        const [theme, tabs, courtyard, identity, emoji, persona, presets] = await Promise.all([
            import('./moonlit-echoes/index.js'),
            import('./chat-completion-tabs/index.js'),
            import('./courtyard/index.js'),
            import('./identity-switch/index.js'),
            import('./emoji-picker/index.js'),
            import('./quick-persona/index.js'),
            import('./presets/index.js'),
        ]);
        await theme.initMoonlitTheme();
        presets.initPresetPanel();
        tabs.initCompletionTabs();
        courtyard.initCourtyard();
        identity.initIdentityControls();
        emoji.initEmojiPicker();
        persona.initQuickPersona();
    })();
    return initialization;
}

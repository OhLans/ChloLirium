/** Former extension identities, used only to prevent duplicate implementations.
 * Core features have no manifests, loader entries, or extension enable flags. */
export const integratedFeatures = [
    { id: 'chlo-moonlit-echoes', folders: ['SillyTavern-MoonlitEchoesTheme'], titles: ['Moonlit Echoes Theme'] },
    { id: 'chlo-courtyard', folders: ['SillyTavern-MoonlitCourtyardSuit'], titles: ['Moonlit Courtyard Suit', 'Moonlit Courtyard Suite'] },
    { id: 'chlo-chat-completion-tabs', folders: ['SillyTavern-ChatCompletionTabs'], titles: ['Chat Completion Tabs'] },
    { id: 'chlo-identity-switch', folders: ['SillyTavern-IdentitySwitch', 'SillyTavern-PersonaIdentity'], titles: ['Identity Switch', 'Persona Identity'] },
    { id: 'chlo-emoji-picker', folders: ['Extension-EmojiPicker'], titles: ['Emoji Picker'] },
    { id: 'chlo-quick-persona', folders: ['Extension-QuickPersona'], titles: ['Quick Persona'] },
];

export function isIntegratedExtension(name, manifest) {
    const folder = name.split('/').at(-1).toLowerCase();
    return integratedFeatures.some(feature => name === feature.id || (name.startsWith('third-party/') && (
        feature.folders.some(alias => alias.toLowerCase() === folder) || feature.titles.includes(manifest?.display_name)
    )));
}

/** Remove only obsolete bundled-extension switches. The user's standalone
 * copies, checkbox choices and all feature settings remain untouched. */
export function migrateNativeInterfaceSettings(settings) {
    let changed = false;
    if (Array.isArray(settings.disabledExtensions)) {
        const disabled = settings.disabledExtensions.filter(name => !integratedFeatures.some(feature => feature.id === name));
        if (disabled.length !== settings.disabledExtensions.length) {
            settings.disabledExtensions = disabled;
            changed = true;
        }
    }
    if (Object.hasOwn(settings, 'chloliriumBuiltinsMigrated')) {
        delete settings.chloliriumBuiltinsMigrated;
        changed = true;
    }
    return changed;
}

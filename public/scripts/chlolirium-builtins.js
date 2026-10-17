/** Bundled features retain their original settings, but are updated with the fork. */
export const builtinFeatures = [
    { id: 'chlo-moonlit-echoes', folders: ['SillyTavern-MoonlitEchoesTheme'], titles: ['Moonlit Echoes Theme'] },
    { id: 'chlo-courtyard', folders: ['SillyTavern-MoonlitCourtyardSuit'], titles: ['Moonlit Courtyard Suit', 'Moonlit Courtyard Suite'] },
    { id: 'chlo-chat-completion-tabs', folders: ['SillyTavern-ChatCompletionTabs'], titles: ['Chat Completion Tabs'] },
    { id: 'chlo-identity-switch', folders: ['SillyTavern-IdentitySwitch', 'SillyTavern-PersonaIdentity'], titles: ['Identity Switch', 'Persona Identity'] },
    { id: 'chlo-emoji-picker', folders: ['Extension-EmojiPicker'], titles: ['Emoji Picker'] },
    { id: 'chlo-quick-persona', folders: ['Extension-QuickPersona'], titles: ['Quick Persona'] },
];

/**
 * Suppress installed copies before any scripts execute. Preserve each feature's
 * previous disabled state once, then let the built-in toggle own that choice.
 * No extension folders or saved feature settings are removed.
 * @param {string[]} names Discovered module names
 * @param {object} manifests Loaded manifests
 * @param {object} settings Existing extension settings
 * @returns {{names: string[], manifests: object, changed: boolean}}
 */
export function resolveBuiltinFeatures(names, manifests, settings) {
    const suppressed = new Set();
    let changed = false;
    const migrated = Array.isArray(settings.chloliriumBuiltinsMigrated) ? settings.chloliriumBuiltinsMigrated : [];
    for (const feature of builtinFeatures) {
        if (!manifests[feature.id]) continue;
        const legacy = names.filter(name => {
            if (!name.startsWith('third-party/')) return false;
            const folder = name.split('/').at(-1).toLowerCase();
            const title = manifests[name]?.display_name;
            return feature.folders.some(alias => alias.toLowerCase() === folder) || feature.titles.includes(title);
        });
        legacy.forEach(name => suppressed.add(name));
        if (!migrated.includes(feature.id)) {
            const disabled = settings.disabledExtensions ??= [];
            if (legacy.length && legacy.every(name => disabled.includes(name)) && !disabled.includes(feature.id)) {
                disabled.push(feature.id);
            }
            migrated.push(feature.id);
            changed = true;
        }
    }
    if (changed) settings.chloliriumBuiltinsMigrated = migrated;
    return {
        names: names.filter(name => !suppressed.has(name)),
        manifests: Object.fromEntries(Object.entries(manifests).filter(([name]) => !suppressed.has(name))),
        changed,
    };
}

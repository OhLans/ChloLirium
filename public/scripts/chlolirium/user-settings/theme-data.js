export const themeAppearanceKey = 'chlo_appearance';
export const appearanceOnlyKey = 'chlo_appearance_only';

/** Keep saved keys stable for snippets and existing theme files. */
export function themeDisplayName(name = '') {
    return String(name ?? '').replace(/\s*[-–—]\s*by Rivelle\s*$/i, '').trim();
}

export function isThemeObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Drop the retired master switch while keeping legacy preset values intact. */
export function withoutLegacyAppearanceToggle(values) {
    if (!isThemeObject(values) || !Object.hasOwn(values, 'enabled')) return values;
    const appearance = { ...values };
    delete appearance.enabled;
    return appearance;
}

/** Pick appearance values only; never copy settings such as the legacy library,
 * theme selection, or any other extension data into a portable theme. */
export function appearanceSnapshot(values, definitions, fallback = {}) {
    const entries = [
        { varId: 'useOriginalAvatarImages', default: false },
        ...definitions,
    ];
    return Object.fromEntries(entries.map(({ varId, default: initial }) => {
        const valid = value => typeof value === typeof initial && (typeof value !== 'number' || Number.isFinite(value));
        const own = Object.hasOwn(values ?? {}, varId) ? values[varId] : undefined;
        const inherited = Object.hasOwn(fallback, varId) ? fallback[varId] : undefined;
        return [varId, valid(own) ? own : valid(inherited) ? inherited : initial];
    }));
}

/** The extended part of a unified file takes precedence over a legacy pair. */
export function resolveThemeAppearance(theme, legacy) {
    if (isThemeObject(theme?.[themeAppearanceKey])) return withoutLegacyAppearanceToggle(theme[themeAppearanceKey]);
    return isThemeObject(legacy) ? withoutLegacyAppearanceToggle(legacy) : null;
}

export function readThemeImport(data) {
    if (!isThemeObject(data)) throw new Error('Choose a UI theme JSON file.');
    if (data.moonlitEchoesPreset === true) {
        if (typeof data.presetName !== 'string' || !isThemeObject(data.settings)) throw new Error('Invalid legacy appearance preset.');
        return { name: data.presetName.replace(/^\[Moonlit\]\s*/i, '').trim(), appearance: withoutLegacyAppearanceToggle(data.settings), legacyAppearance: true };
    }
    if (typeof data.name !== 'string') throw new Error('Missing theme name.');
    if (Object.hasOwn(data, themeAppearanceKey) && !isThemeObject(data[themeAppearanceKey])) {
        throw new Error('Invalid extended appearance settings.');
    }
    return { name: data.name.trim(), appearance: withoutLegacyAppearanceToggle(data[themeAppearanceKey]) ?? null, legacyAppearance: false };
}

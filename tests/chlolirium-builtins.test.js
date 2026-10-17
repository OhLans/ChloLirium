import { describe, test, expect, jest } from '@jest/globals';
import { builtinFeatures, resolveBuiltinFeatures } from '../public/scripts/chlolirium-builtins.js';

jest.unstable_mockModule('../public/scripts/i18n.js', () => ({ t: (strings, ...values) => String.raw({ raw: strings }, ...values) }));
const { themeCustomSettings } = await import('../public/scripts/extensions/chlo-moonlit-echoes/src/config/theme-settings.js');
const { defaultSettings, ensureSettingsStructure } = await import('../public/scripts/extensions/chlo-moonlit-echoes/src/config/default-settings.js');

describe('Built-in feature migration', () => {
    for (const feature of builtinFeatures) {
        test(`${feature.id} replaces only its matching standalone copy`, () => {
            const legacy = `third-party/${feature.folders[0]}`;
            const other = 'third-party/unrelated-extension';
            const settings = { disabledExtensions: [], identitySwitch: { numCards: 7 } };
            const manifests = { [feature.id]: {}, [legacy]: {}, [other]: {} };
            const result = resolveBuiltinFeatures(Object.keys(manifests), manifests, settings);
            expect(result.names).toEqual([feature.id, other]);
            expect(result.manifests[legacy]).toBeUndefined();
            expect(settings.identitySwitch).toEqual({ numCards: 7 });
        });
    }

    test('a renamed installed copy is recognized by its manifest title', () => {
        const manifests = { 'chlo-identity-switch': {}, 'third-party/MyIdentityCopy': { display_name: 'Identity Switch' } };
        expect(resolveBuiltinFeatures(Object.keys(manifests), manifests, {}).names).toEqual(['chlo-identity-switch']);
    });

    test('a previously disabled feature stays disabled, and later built-in choices survive reloads', () => {
        const legacy = 'third-party/SillyTavern-MoonlitEchoesTheme';
        const manifests = { 'chlo-moonlit-echoes': {}, [legacy]: {} };
        const settings = { disabledExtensions: [legacy] };
        resolveBuiltinFeatures(Object.keys(manifests), manifests, settings);
        expect(settings.disabledExtensions).toContain('chlo-moonlit-echoes');
        settings.disabledExtensions = [legacy]; // User enables the new built-in.
        const second = resolveBuiltinFeatures(Object.keys(manifests), manifests, settings);
        expect(second.changed).toBe(false);
        expect(settings.disabledExtensions).not.toContain('chlo-moonlit-echoes');
    });

    test('a missing built-in never suppresses a usable standalone extension', () => {
        const name = 'third-party/Extension-EmojiPicker';
        expect(resolveBuiltinFeatures([name], { [name]: {} }, {}).names).toEqual([name]);
    });
});

describe('Moonlit Echoes settings preservation', () => {
    test('every upstream control retains its default, preset entry, and stable setting key', () => {
        expect(themeCustomSettings).toHaveLength(59);
        for (const control of themeCustomSettings) {
            expect(defaultSettings[control.varId]).toEqual(control.default);
            expect(defaultSettings.presets[defaultSettings.activePreset][control.varId]).toEqual(control.default);
        }
    });

    test('existing named presets, selection, colors and custom CSS survive initialization', () => {
        const settings = {
            enabled: false,
            activePreset: 'My Courtyard',
            presets: { 'My Courtyard': { customThemeColor: 'rgba(174,149,149,1)', customTopBarColor: 'rgba(30,30,30,0.5)' } },
            customThemeColor: 'rgba(174,149,149,1)',
            rawCustomCss: '#chat { max-width: 950px; }',
            useOriginalAvatarImages: true,
        };
        const before = structuredClone(settings);
        ensureSettingsStructure(settings);
        expect(settings).toEqual(before);
    });

    test('legacy ungrouped settings seed a preset using existing values', () => {
        const settings = { customThemeColor: 'rgba(174,149,149,1)' };
        ensureSettingsStructure(settings);
        expect(settings.presets[settings.activePreset].customThemeColor).toBe(settings.customThemeColor);
    });
});

import { describe, test, expect, jest } from '@jest/globals';
import { integratedFeatures, isIntegratedExtension, migrateNativeInterfaceSettings } from '../public/scripts/chlolirium/legacy-extensions.js';

jest.unstable_mockModule('../public/scripts/i18n.js', () => ({ t: (strings, ...values) => String.raw({ raw: strings }, ...values) }));
const { themeCustomSettings } = await import('../public/scripts/chlolirium/moonlit-echoes/src/config/theme-settings.js');
const { defaultSettings, ensureSettingsStructure } = await import('../public/scripts/chlolirium/moonlit-echoes/src/config/default-settings.js');

describe('Native interface migration', () => {
    for (const feature of integratedFeatures) {
        test(`${feature.id} excludes its former bundle and standalone copy from extension loading`, () => {
            expect(isIntegratedExtension(feature.id, {})).toBe(true);
            expect(isIntegratedExtension(`third-party/${feature.folders[0]}`, {})).toBe(true);
            expect(isIntegratedExtension('third-party/unrelated-extension', {})).toBe(false);
        });
    }

    test('a renamed installed copy is recognized by its manifest title', () => {
        expect(isIntegratedExtension('third-party/MyIdentityCopy', { display_name: 'Identity Switch' })).toBe(true);
    });

    test('unchecked standalone copies do not disable core features; obsolete bundle flags are cleaned once', () => {
        const legacy = 'third-party/SillyTavern-MoonlitEchoesTheme';
        const settings = {
            disabledExtensions: [legacy, ...integratedFeatures.map(f => f.id), 'third-party/Other'],
            chloliriumBuiltinsMigrated: integratedFeatures.map(f => f.id),
            SillyTavernMoonlitEchoesTheme: { enabled: false, rawCustomCss: '#chat { width: 950px; }' },
            identitySwitch: { numCards: 7 },
        };
        const theme = structuredClone(settings.SillyTavernMoonlitEchoesTheme);
        expect(migrateNativeInterfaceSettings(settings)).toBe(true);
        expect(settings.disabledExtensions).toEqual([legacy, 'third-party/Other']);
        expect(settings.chloliriumBuiltinsMigrated).toBeUndefined();
        expect(settings.SillyTavernMoonlitEchoesTheme).toEqual(theme);
        expect(settings.identitySwitch).toEqual({ numCards: 7 });
        expect(migrateNativeInterfaceSettings(settings)).toBe(false);
    });

    test('fresh settings do not acquire extension flags', () => {
        const settings = {};
        expect(migrateNativeInterfaceSettings(settings)).toBe(false);
        expect(settings).toEqual({});
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

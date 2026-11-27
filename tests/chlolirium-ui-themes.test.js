import { describe, expect, test } from '@jest/globals';
import { appearanceSnapshot, readThemeImport, resolveThemeAppearance, themeAppearanceKey } from '../public/scripts/chlolirium/user-settings/theme-data.js';

describe('Unified UI theme format', () => {
    const controls = [
        { varId: 'customThemeColor', default: 'blue' },
        { varId: 'blur', default: 8 },
        { varId: 'rawCustomCss', default: '' },
    ];

    test('saves current appearance and valid false, zero, and empty values without saving the legacy catalog', () => {
        const current = { enabled: false, useOriginalAvatarImages: true, blur: 0, customThemeColor: 'rose', rawCustomCss: '', presets: { Old: {} }, activePreset: 'Old' };
        const snapshot = appearanceSnapshot(current, controls);
        expect(snapshot).toEqual({ enabled: false, useOriginalAvatarImages: true, blur: 0, customThemeColor: 'rose', rawCustomCss: '' });
        const combined = JSON.parse(JSON.stringify({ name: 'Combined', font_scale: 1.2, [themeAppearanceKey]: snapshot }));
        expect(readThemeImport(combined)).toEqual({ name: 'Combined', appearance: snapshot, legacyAppearance: false });
        expect(resolveThemeAppearance(combined, { customThemeColor: 'orange' })).toEqual(snapshot);
    });

    test('loads a same-name legacy pairing when a native theme does not have extended values', () => {
        const original = { name: 'Glimmer', font_scale: 1.1 };
        const legacy = { customThemeColor: 'rose', blur: 4 };
        expect(resolveThemeAppearance(original, legacy)).toBe(legacy);
        expect(resolveThemeAppearance(original, null)).toBeNull();
        expect(appearanceSnapshot({ blur: 'bad' }, controls, legacy)).toMatchObject({ blur: 4, customThemeColor: 'rose' });
    });

    test('recognizes both old export formats and rejects a malformed appearance payload', () => {
        const old = { moonlitEchoesPreset: true, presetName: '[Moonlit] Glimmer', settings: { blur: 5 } };
        expect(readThemeImport(old)).toEqual({ name: 'Glimmer', appearance: { blur: 5 }, legacyAppearance: true });
        expect(readThemeImport({ name: 'Ordinary' })).toEqual({ name: 'Ordinary', appearance: null, legacyAppearance: false });
        expect(() => readThemeImport({ name: 'Bad', [themeAppearanceKey]: [] })).toThrow('Invalid extended appearance');
    });
});

import { describe, test, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { pickPromptPreset } from '../public/scripts/chlolirium/presets/model.js';
import { convertLoomPreset, preparePresetImport } from '../public/scripts/chlolirium/presets/import.js';
import { presetCover, promptSection, presetBlockCount } from '../public/scripts/chlolirium/presets/presentation.js';

const defaults = JSON.parse(await readFile(new URL('../default/content/presets/openai/Default.json', import.meta.url), 'utf8'));
const loom = JSON.parse(await readFile(new URL('./fixtures/chlolirium/loom-example.loom', import.meta.url), 'utf8'));
const legacy = JSON.parse(await readFile(new URL('./fixtures/chlolirium/legacy-example.json', import.meta.url), 'utf8'));

describe('Shared generation parameters', () => {
    test('prompt presets exclude generation and connection values, including legacy files', () => {
        const result = pickPromptPreset({ ...defaults, temperature: 0.2, temp_openai: 0.2, custom_url: 'https://example.invalid', proxy_password: 'private', reasoning_effort: 'high', stream_openai: false, n: 8 });
        for (const key of ['temperature', 'temp_openai', 'openai_max_context', 'openai_max_tokens', 'custom_url', 'proxy_password', 'reasoning_effort', 'stream_openai', 'n']) expect(result).not.toHaveProperty(key);
        expect(result.prompts).toEqual(defaults.prompts);
        expect(result.prompt_order).toEqual(defaults.prompt_order);
    });

    test('native prompt fields, extension data and existing metadata are copied without modifying the source', () => {
        const source = { ...defaults, extensions: { regex_scripts: [{ id: 'regex1' }] }, chlo_preset: { description: 'Existing data' } };
        const result = pickPromptPreset(source);
        expect(result.extensions).toEqual(source.extensions);
        expect(result.chlo_preset).toEqual(source.chlo_preset);
        result.prompts[0].content = 'Changed';
        expect(source.prompts[0].content).not.toBe('Changed');
    });
});

describe('Native preset presentation', () => {
    test('explicit Loom/earlier-workspace categories take precedence over automatic marker sections', () => {
        expect(promptSection({ identifier: 'chatHistory' })).toBe('Conversation');
        expect(promptSection({ identifier: 'main' })).toBe('Core instructions');
        expect(promptSection({ identifier: 'charDescription' })).toBe('Character & persona');
        expect(promptSection({ identifier: 'worldInfoBefore' })).toBe('World & memory');
        expect(promptSection({ identifier: 'chatHistory', chlo_category: 'A custom section' })).toBe('A custom section');
    });

    test('covers accept existing raster data and HTTP images, rejecting active schemes and SVG uploads', () => {
        for (const cover of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'file:///private.png']) expect(presetCover({ chlo_preset: { cover } })).toBe('');
        expect(presetCover({ chlo_preset: { cover: 'data:image/png;base64,AAAA' } })).toBe('data:image/png;base64,AAAA');
        expect(presetCover({ metadata: { coverUrl: 'https://example.test/art.webp' } })).toBe('https://example.test/art.webp');
        expect(presetCover({ chlo_preset: { cover: '' }, coverUrl: 'https://example.test/art.webp' })).toBe('');
    });

    test('block counts describe ordered blocks, including disabled blocks, without counting missing references', () => {
        const preset = convertLoomPreset(loom);
        expect(presetBlockCount(preset)).toBe(8);
        preset.prompt_order[0].order.push({ identifier: 'missing', enabled: true });
        expect(presetBlockCount(preset)).toBe(8);
    });
});

describe('Supported Loom and legacy conversion', () => {
    test('Loom categories are presentation metadata, never model instructions or extra messages', () => {
        const source = structuredClone(loom);
        const result = convertLoomPreset(source);
        expect(result.prompts).toHaveLength(8);
        expect(result.prompts.map(prompt => prompt.identifier)).toEqual(['voice', 'pacing', 'charDescription', 'personaDescription', 'worldInfoBefore', 'dialogueExamples', 'chatHistory', 'continuity']);
        expect(result.prompts[0]).toMatchObject({ chlo_category: 'Core instructions', content: loom.blocks[1].content, role: 'system' });
        expect(result.prompt_order[0].order[1]).toEqual({ identifier: 'pacing', enabled: false });
        expect(result.prompts.at(-1)).toMatchObject({ injection_position: 1, injection_depth: 0, chlo_category: 'Reply guidance' });
        expect(source).toEqual(loom);
        expect(result).not.toHaveProperty('samplerOverrides');
    });

    test('explicit group ownership and category enabled state survive conversion without regrouping blocks', () => {
        const source = structuredClone(loom);
        source.blocks[0].enabled = false;
        source.blocks[2].group = 'people';
        source.blocks[2].enabled = true;
        const result = convertLoomPreset(source);
        expect(result.prompt_order[0].order[0].enabled).toBe(false);
        expect(result.prompt_order[0].order[1].enabled).toBe(true);
        expect(result.prompts[1].chlo_category).toBe('Character & persona');
    });

    test('native depth, roles and generation triggers map without changing shared generation parameters', () => {
        const source = structuredClone(loom);
        Object.assign(source.blocks[1], { role: 'assistant', position: 'in_history', depth: 7, injectionTrigger: ['continue'] });
        source.samplerOverrides = { enabled: true, temperature: 0.01, maxTokens: 12 };
        const result = convertLoomPreset(source);
        expect(result.prompts[0]).toMatchObject({ role: 'assistant', injection_position: 1, injection_depth: 7, injection_trigger: ['continue'] });
        expect(Object.keys(result)).toEqual(['prompts', 'prompt_order', 'chlo_preset']);
    });

    test('unsupported block semantics abort conversion before writing', () => {
        for (const change of [
            { variables: [{ name: 'voice' }] }, { role: 'user_append' }, { marker: 'long_term_memory' },
            { placementBinding: {} }, { sealed: true }, { characterTagTrigger: ['fantasy'] },
            { content: '{{loom::special}}' }, { depth: -1, position: 'in_history' },
            { marker: '__proto__' }, { injectionTrigger: ['unknown-trigger'] },
            { id: 'charDescription' },
        ]) {
            const source = structuredClone(loom);
            Object.assign(source.blocks[1], change);
            expect(() => convertLoomPreset(source)).toThrow();
        }
    });

    test('portable formatting survives, and positions needing dynamic Loom reordering are rejected', () => {
        const result = convertLoomPreset({ ...loom, promptBehavior: { continueNudge: 'Continue as {{char}}.' }, completionSettings: { assistantPrefill: 'A quiet pause.', useSystemPrompt: true } });
        expect(result).toMatchObject({ continue_nudge_prompt: 'Continue as {{char}}.', assistant_prefill: 'A quiet pause.', use_sysprompt: true });
        const misplaced = structuredClone(loom);
        misplaced.blocks.at(-1).position = 'pre_history';
        expect(() => convertLoomPreset(misplaced)).toThrow(/above Chat History/);
        expect(() => preparePresetImport({ engine: 'loom', prompt_order: loom.blocks }, defaults)).toThrow(/Loom JSON/);
    });

    test('radio rules, custom bodies, duplicate markers and missing chat history are rejected', () => {
        const source = structuredClone(loom);
        source.blocks[0].categoryMode = 'radio';
        expect(() => convertLoomPreset(source)).toThrow(/category rules/);
        expect(() => convertLoomPreset({ ...loom, customBody: { enabled: true } })).toThrow(/request bodies/);
        expect(() => convertLoomPreset({ ...loom, blocks: loom.blocks.filter(block => block.marker !== 'chat_history') })).toThrow(/Chat History/);
        const duplicate = { ...loom.blocks.find(block => block.marker === 'chat_history'), id: 'duplicate-history' };
        expect(() => convertLoomPreset({ ...loom, blocks: [...loom.blocks, duplicate] })).toThrow(/Duplicate/);
    });

    test('legacy text fields become real native prompts, not a second prompt engine', () => {
        const result = preparePresetImport(legacy, defaults);
        expect(result.prompts.find(prompt => prompt.identifier === 'main').content).toBe(legacy.main_prompt);
        expect(result.prompts.find(prompt => prompt.identifier === 'jailbreak').content).toBe(legacy.jailbreak_prompt);
        expect(result.prompt_order).toEqual(defaults.prompt_order);
        expect(result).not.toHaveProperty('main_prompt');
    });

    test('ordinary native extension data and category fields are preserved, including prompt-manager exports', () => {
        const source = { ...defaults, extensions: { regex_scripts: [{ id: 'r1' }] } };
        expect(preparePresetImport(source, defaults)).toEqual(source);
        const flat = { prompts: defaults.prompts, prompt_order: defaults.prompt_order[0].order };
        expect(preparePresetImport({ version: 1, data: flat }, defaults).prompt_order[0].character_id).toBe(100001);
    });

    for (const [name, fixture] of [['Loom', loom], ['Legacy', legacy]]) {
        test(`seeded ${name} example is the actual converted fixture with no provider or sampler fields`, async () => {
            const expected = pickPromptPreset(preparePresetImport(fixture, defaults));
            const seeded = JSON.parse(await readFile(new URL(`../default/content/presets/openai/Chlo - ${name} example.json`, import.meta.url), 'utf8'));
            expect(seeded).toEqual(expected);
        });
    }
});

import { describe, test, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { blockCategory, getBlocks, getOrder, importPromptPreset, pickPromptPreset } from '../public/scripts/chlolirium/presets/model.js';

const defaults = JSON.parse(await readFile(new URL('../default/content/presets/openai/Default.json', import.meta.url), 'utf8'));

describe('Prompt preset ownership and compatibility', () => {
    test('legacy sampling, connection, model and tool settings never belong to a prompt preset', () => {
        const preset = { ...defaults, temperature: 0.2, temp_openai: 0.2, custom_url: 'https://example.invalid', proxy_password: 'private', reasoning_effort: 'high', stream_openai: false, n: 8 };
        const result = pickPromptPreset(preset);
        for (const key of ['temperature', 'temp_openai', 'openai_max_context', 'openai_max_tokens', 'custom_url', 'proxy_password', 'reasoning_effort', 'stream_openai', 'n']) {
            expect(result).not.toHaveProperty(key);
        }
        expect(result.prompts).toEqual(defaults.prompts);
        expect(result.prompt_order).toEqual(defaults.prompt_order);
        result.prompts[0].content = 'changed';
        expect(preset.prompts[0].content).not.toBe('changed');
    });

    test('full ST presets preserve all block fields and every character order', () => {
        const preset = structuredClone(defaults);
        preset.prompts.push({ identifier: 'test', name: 'Voice', content: 'Text', role: 'assistant', injection_position: 1, injection_depth: 7, injection_order: 42, injection_trigger: ['normal', 'future-type'], forbid_overrides: true, chlo_category: 'Voice', custom_extension_field: { test: true } });
        preset.extensions = { regex_scripts: [{ id: 'regex1' }] };
        const result = importPromptPreset(preset, defaults);
        expect(result.prompts).toEqual(preset.prompts);
        expect(result.prompt_order).toEqual(preset.prompt_order);
        expect(result.extensions).toEqual(preset.extensions);
        expect(getBlocks(result).at(-1).entry).toBeNull();
        expect(getBlocks(result).at(-1).prompt.identifier).toBe('test');
    });

    test('a prompt-manager export retains its explicit enabled state and order', () => {
        const data = { prompts: [{ identifier: 'b', content: 'B' }, { identifier: 'a', content: 'A' }], prompt_order: [{ identifier: 'a', enabled: false }, { identifier: 'b', enabled: true }] };
        const result = importPromptPreset({ version: 1, data }, defaults);
        expect(getOrder(result)).toEqual(data.prompt_order);
        expect(getBlocks(result).map(block => block.prompt.identifier)).toEqual(['a', 'b']);
    });

    test('legacy text prompts migrate without changing the defaults or losing markers', () => {
        const original = structuredClone(defaults);
        const result = importPromptPreset({ main_prompt: 'Legacy main', jailbreak_prompt: 'Legacy footer', temperature: 0.1 }, defaults);
        expect(result.prompts.find(prompt => prompt.identifier === 'main').content).toBe('Legacy main');
        expect(result.prompts.find(prompt => prompt.identifier === 'jailbreak').content).toBe('Legacy footer');
        expect(result.prompts.some(prompt => prompt.identifier === 'chatHistory' && prompt.marker)).toBe(true);
        expect(result.prompt_order).toEqual(defaults.prompt_order);
        expect(defaults).toEqual(original);
    });

    test('legacy character order is copied to the active global order without modifying it', () => {
        const preset = { prompts: [{ identifier: 'a', content: '' }], prompt_order: [{ character_id: 100000, order: [{ identifier: 'a', enabled: false }] }] };
        const result = importPromptPreset(preset, defaults);
        expect(result.prompt_order[0]).toEqual(preset.prompt_order[0]);
        expect(result.prompt_order[1]).toEqual({ character_id: 100001, order: [{ identifier: 'a', enabled: false }] });
    });

    const invalidImports = [
        null, [], { blocks: [] }, { prompts: [null] },
        { prompts: [{ identifier: 'a' }, { identifier: 'a' }] },
        { prompts: [{ identifier: 'a', content: {} }] },
        { prompts: [], prompt_order: 'invalid' },
        { prompts: [], prompt_order: [{ character_id: 100001, order: 'invalid' }] },
    ];
    for (const [index, value] of invalidImports.entries()) {
        test(`invalid or unsupported import ${index + 1} is rejected before saving`, () => {
            expect(() => importPromptPreset(value, defaults)).toThrow();
        });
    }

    test('unsafe cover URLs are removed; native context markers have readable categories', () => {
        const result = importPromptPreset({ ...defaults, chlo_preset: { cover: 'javascript:alert(1)', description: 'Kept' } }, defaults);
        expect(result.chlo_preset).toEqual({ description: 'Kept' });
        expect(blockCategory({ identifier: 'worldInfoBefore' })).toBe('World & memory');
        expect(blockCategory({ identifier: 'personaDescription' })).toBe('Character & persona');
        expect(blockCategory({ identifier: 'chatHistory' })).toBe('Conversation');
    });
});

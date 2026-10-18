import { describe, test, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { pickPromptPreset } from '../public/scripts/chlolirium/presets/model.js';

const defaults = JSON.parse(await readFile(new URL('../default/content/presets/openai/Default.json', import.meta.url), 'utf8'));

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

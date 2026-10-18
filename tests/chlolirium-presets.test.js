import { describe, test, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { pickPromptPreset } from '../public/scripts/chlolirium/presets/model.js';
import { convertLoomPreset, preparePresetImport } from '../public/scripts/chlolirium/presets/import.js';
import { presetCover, promptSection, presetBlockCount } from '../public/scripts/chlolirium/presets/presentation.js';
import { createLoomResolver, parseLoomText } from '../public/scripts/chlolirium/presets/loom-macros.js';
import { convertLoomRegex, replaceLoomRegex } from '../public/scripts/chlolirium/presets/loom-regex.js';

const defaults = JSON.parse(await readFile(new URL('../default/content/presets/openai/Default.json', import.meta.url), 'utf8'));
const loom = JSON.parse(await readFile(new URL('./fixtures/chlolirium/loom-example.loom', import.meta.url), 'utf8'));
const legacy = JSON.parse(await readFile(new URL('./fixtures/chlolirium/legacy-example.json', import.meta.url), 'utf8'));
const stateful = JSON.parse(await readFile(new URL('./fixtures/chlolirium/loom-stateful.loom', import.meta.url), 'utf8'));

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
    test('empty Loom categories are presentation metadata, never extra messages', () => {
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

describe('Stateful Loom compatibility', () => {
    const native = text => ({ '{{char}}': 'Aster', '{{persona}}': 'A careful observer.' })[text] ?? '';
    test('category initialization and scoped captures assemble enabled blocks in order', () => {
        const preset = convertLoomPreset(stateful), chat = {};
        const resolve = createLoomResolver({ native, chat });
        const content = preset.prompt_order[0].order.filter(x => x.enabled).map(entry => resolve(preset.prompts.find(p => p.identifier === entry.identifier).content)).join('\n');
        expect(preset.prompts[0]).toMatchObject({ identifier: 'state', chlo_category: 'Initialization' });
        expect(content).toContain('Voice: Calm. Weather: clear. Persona is available.');
        expect(content).not.toContain('Alternate');
        expect(content).not.toContain('{{');
        expect(chat).toEqual({ mind: 'Calm' });
        const orders = preset.prompts.filter(p => p.injection_position === 1).map(p => p.injection_order);
        expect(orders[0]).toBeLessThan(orders[1]);
        expect(orders[1]).toBeLessThan(orders[2]);
    });

    test('locals reset on a new generation while chat state survives and stays chat scoped', () => {
        const chat = {}, resolve = createLoomResolver({ native, chat });
        resolve('{{setvar::x::old}}{{setchatvar::mind::Calm}}');
        expect(resolve('{{getvar::x}}')).toBe('old');
        expect(createLoomResolver({ native, chat })('{{getvar::x}}/{{getchatvar::mind}}')).toBe('/Calm');
        expect(createLoomResolver({ native, chat: {} })('{{getchatvar::mind}}')).toBe('');
        resolve('{{setchatvar::__proto__::safe}}');
        expect(Object.hasOwn(chat, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(chat)).toBe(Object.prototype);
    });

    test('nested conditionals evaluate only the chosen branch, including false/off/null and inversion', () => {
        const resolve = createLoomResolver({ native });
        for (const flag of ['', 'false', '0', 'off', 'no', 'null', 'undefined']) {
            expect(resolve(`{{setvar::flag::${flag}}}{{if !{{getvar::flag}}}}yes{{if {{persona}}}} persona{{/if}}{{else}}{{setvar::oops::bad}}{{/if}}{{getvar::oops}}`)).toBe('yes persona');
        }
        expect(resolve('{{if yes}}{{setvar::x::right}}{{else}}{{setvar::x::wrong}}{{/if}}{{getvar::x}}')).toBe('right');
    });

    test('captures preserve whitespace and identity values remain data', () => {
        const resolve = createLoomResolver({ native: () => '{{setvar::injected::bad}}' });
        expect(resolve('{{setvar::text}}\n body \n{{/setvar}}{{getvar::text}}')).toBe('\n body \n');
        expect(resolve('{{char}}{{getvar::injected}}')).toBe('{{setvar::injected::bad}}');
        expect(resolve('{{setvar::x::\n  framed\n}}{{getvar::x}}')).toBe('framed');
        expect(resolve('{{setvar::x:: - }}{{getvar::x}}')).toBe(' - ');
    });

    test('random list weights and dice use Loom semantics independently of ST macro engine', () => {
        const resolve = createLoomResolver({ native, random: () => 0.5 });
        expect(resolve('{{random::A::A::B}}/{{random::2::4}}/{{roll::1d20}}')).toBe('A/3/11');
    });

    test('unsupported macros and malformed scopes fail before import, including nested macros', () => {
        for (const content of ['{{if yes}}{{unknown}}{{/if}}', '{{if yes}}unclosed', '{{/setvar}}', '{{getvar::x', '{{setvar::x}}unclosed', '{{if .x == 1}}bad{{/if}}', '{{if yes}}a{{else}}b{{else}}c{{/if}}']) {
            expect(() => convertLoomPreset({ ...stateful, blocks: stateful.blocks.map((b, i) => i === 1 ? { ...b, content } : b) })).toThrow(/Nothing was imported/);
        }
        expect(() => parseLoomText('{{if yes}}'.repeat(66) + '{{/if}}'.repeat(66))).toThrow(/nesting/);
    });

    test('regex collections are deduplicated and retain flags, display/prompt targets and depth', () => {
        const scripts = convertLoomRegex(stateful);
        expect(scripts).toHaveLength(2);
        expect(scripts[0]).toMatchObject({ markdownOnly: true, promptOnly: false, placement: [2], chlo_loom: { mode: 'escaped' } });
        expect(scripts[1]).toMatchObject({ markdownOnly: false, promptOnly: true, minDepth: 2 });
        expect(scripts[1].findRegex).toBe('/<panel>[\\s\\S]*?<\\/panel>/g');
        expect(() => convertLoomRegex({ ...stateful, regex_scripts: [] })).toThrow(/Conflicting/);
        for (const extra of [{ actions: [{}] }, { substitute_macros: 'raw' }, { flags: 'bad' }, { placement: ['unknown'] }]) {
            expect(() => convertLoomRegex({ regex_scripts: [{ ...stateful.regex_scripts[0], ...extra }] })).toThrow(/Nothing was imported/);
        }
    });

    test('Loom regex replacements preserve JS captures and never evaluate captured chat prose', () => {
        const resolve = createLoomResolver({ native, chat: { mind: '$1 Calm' } });
        expect(replaceLoomRegex('((OOC hello', /\(\(OOC /g, stateful.regex_scripts[0].replace_string, 'escaped', resolve)).toBe('((OOC mind="$1 Calm": hello');
        expect(replaceLoomRegex('{{setvar::x::bad}}', /([\s\S]+)/, '$1 $$ $&', 'none', resolve)).toBe('{{setvar::x::bad}} $ {{setvar::x::bad}}');
        expect(resolve('{{getvar::x}}')).toBe('');
    });
});

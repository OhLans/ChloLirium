import { describe, test, expect } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { pickChatCompletionPreset, pickPromptPreset } from '../public/scripts/chlolirium/presets/model.js';
import { convertLoomPreset, preparePresetImport } from '../public/scripts/chlolirium/presets/import.js';
import { presetCover, promptEditorGroup, promptEditorGroups, promptEditorPlacement, insertPromptSection, organizePrompt, editorLayoutFromSequence, presetBlockCount } from '../public/scripts/chlolirium/presets/presentation.js';
import { createLoomResolver, parseLoomText } from '../public/scripts/chlolirium/presets/loom-macros.js';
import { convertLoomRegex, replaceLoomRegex } from '../public/scripts/chlolirium/presets/loom-regex.js';

const defaults = JSON.parse(await readFile(new URL('../default/content/presets/openai/Default.json', import.meta.url), 'utf8'));
const loom = JSON.parse(await readFile(new URL('./fixtures/chlolirium/loom-example.loom', import.meta.url), 'utf8'));
const legacy = JSON.parse(await readFile(new URL('./fixtures/chlolirium/legacy-example.json', import.meta.url), 'utf8'));
const stateful = JSON.parse(await readFile(new URL('./fixtures/chlolirium/loom-stateful.loom', import.meta.url), 'utf8'));

describe('Chat completion preset fields', () => {
    test('prompt-only example extraction excludes generation and connection values', () => {
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

    test('native saves normalize live aliases, retain falsy values and exclude connections and unknown fields', () => {
        const definitions = {
            temperature: ['', 'temp_openai', false, false], top_k: ['', 'top_k_openai', false, false],
            stream_openai: ['', 'stream_openai', true, false], prompts: ['', 'prompts', false, false],
            custom_url: ['', 'custom_url', false, true], proxy_password: ['', 'proxy_password', false, true],
        };
        const live = { temp_openai: 0.85, top_k_openai: 0, stream_openai: false, prompts: [{ content: 'Original' }], custom_url: 'https://example.invalid', proxy_password: 'private', unknown: 'ignored' };
        const saved = pickChatCompletionPreset(live, definitions);
        expect(saved).toEqual({ temperature: 0.85, top_k: 0, stream_openai: false, prompts: [{ content: 'Original' }] });
        expect(pickChatCompletionPreset(saved, definitions)).toEqual(saved);
        expect(pickChatCompletionPreset({ prompts: [] }, definitions)).toEqual({ prompts: [] });
        saved.prompts[0].content = 'Changed';
        expect(live.prompts[0].content).toBe('Original');
    });
});

describe('Native preset presentation', () => {
    test('context markers and structural wrappers are separated from real instructions and setting macros', () => {
        for (const prompt of [
            { identifier: 'chatHistory', content: '' }, { identifier: 'personaDescription' }, { identifier: 'worldInfoBefore' },
            { marker: true }, { content: '{{trim}}\n<roleplay_context>\n<characters>' },
            { content: '</characters>\n{{trim}}' }, { content: '{{summary}}' },
            { content: '<last_message>', injection_position: 1, injection_depth: 1 },
            { name: '| Identity', content: '{{getvar::identity}}' },
            { name: '┌ <characters>', content: '{{setvar::characters}}<characters>' },
            { name: '┌ <protagonist>', content: '{{setvar::protagonist}}<protagonist>' },
        ]) expect(promptEditorGroup(prompt)).toBe('context');
        for (const prompt of [
            { identifier: 'main', content: '' }, { content: 'Write' }, { content: '<style>Use a calm voice.</style>' },
            { content: '{{setvar::mode::co-writer}}{{trim}}' }, { content: '{{getvar::voice}}' },
            { content: 'Review the current turn.', injection_position: 1, injection_depth: 0 },
        ]) expect(promptEditorGroup(prompt)).toBe('instructions');
    });

    test('editor grouping keeps stable order and original references without changing source data or categories', () => {
        const prompts = [{ identifier: 'a', content: 'First.' }, { identifier: 'chatHistory', chlo_category: 'Custom' }, { identifier: 'b', content: 'Second.', chlo_category: 'Reply guidance' }, { identifier: 'close', content: '</context>' }];
        const before = structuredClone(prompts);
        const groups = promptEditorGroups(prompts);
        expect(groups.map(group => group.prompts.map(prompt => prompt.identifier))).toEqual([['a', 'b'], ['chatHistory', 'close']]);
        expect(groups[0].prompts[1]).toBe(prompts[2]);
        expect(prompts).toEqual(before);
        expect(promptEditorGroups([])).toEqual([]);
    });

    test('placement labels distinguish preset order from in-chat depth and role ordering', () => {
        expect(promptEditorPlacement({}, 8).label).toBe('Send order 9');
        const placement = promptEditorPlacement({ injection_position: 1, injection_depth: 0, injection_order: 20, role: 'assistant' }, 8);
        expect(placement.label).toBe('In chat · depth 0');
        expect(placement.title).toContain('role assistant, order 20');
    });

    test('manual editor assignment and ordering survive serialization without altering execution or source prompts', () => {
        const prompts = [{ identifier: 'first', content: 'First instruction.' }, { identifier: 'identity', name: 'Identity', content: '{{getvar::identity}}' }, { identifier: 'second', content: 'Second instruction.' }];
        const before = structuredClone(prompts);
        let layout = organizePrompt(prompts, {}, 'identity', { group: 'instructions' });
        layout = organizePrompt(prompts, layout, 'second', { direction: 'up' });
        expect(promptEditorGroups(prompts, JSON.parse(JSON.stringify(layout)))).toMatchObject([{ id: 'instructions', prompts: [{ identifier: 'first' }, { identifier: 'second' }, { identifier: 'identity' }] }]);
        expect(prompts).toEqual(before);
        expect(organizePrompt(prompts, layout, 'missing', { direction: 'down' }).order).toEqual(layout.order);
        layout = organizePrompt(prompts, layout, 'first', { group: 'context' });
        expect(promptEditorGroups(prompts, layout).find(group => group.id === 'context').prompts.map(prompt => prompt.identifier)).toEqual(['first']);
    });

    test('a grouped drag keeps native objects intact and rejects duplicate or unknown row references', () => {
        const prompts = [{ identifier: 'one', content: 'First.' }, { identifier: 'two', content: 'Second.' }, { identifier: 'chatHistory', marker: true }];
        const source = structuredClone(prompts);
        const layout = editorLayoutFromSequence(prompts, {}, [{ identifier: 'two', group: 'instructions' }, { identifier: 'one', group: 'context' }, { identifier: 'two', group: 'context' }, { identifier: 'missing', group: 'context' }]);
        expect(layout.order).toEqual(['two', 'one', 'chatHistory']);
        expect(layout.assignments).toEqual({ two: 'instructions', one: 'context' });
        expect(promptEditorGroups(prompts, layout).map(group => group.prompts.map(prompt => prompt.identifier))).toEqual([['two'], ['one', 'chatHistory']]);
        expect(prompts).toEqual(source);
    });

    test('inserting a section respects the editor order and moves only the remainder of the chosen group', () => {
        const prompts = ['one', 'two', 'three', 'chatHistory', 'extra'].map(identifier => ({ identifier }));
        const layout = {
            order: ['three', 'one', 'two', 'chatHistory', 'extra'],
            groups: [{ id: 'optional', label: 'Optional' }, { id: 'other', label: 'Other' }],
            group_order: ['optional', 'instructions', 'context', 'other'],
            assignments: { extra: 'other' },
        };
        const original = structuredClone(layout);
        const next = insertPromptSection(prompts, layout, 'one', { id: 'optional', label: 'Optional' });
        expect(promptEditorGroups(prompts, next).map(group => [group.id, group.prompts.map(prompt => prompt.identifier)])).toEqual([
            ['instructions', ['three']], ['optional', ['one', 'two']], ['context', ['chatHistory']], ['other', ['extra']],
        ]);
        expect(next.order).toEqual(layout.order);
        expect(layout).toEqual(original);
        expect(insertPromptSection(prompts, next, 'two', { id: 'other', label: 'Other' })).toBeUndefined();
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
        const result = preparePresetImport({ ...legacy, temperature: 0.85, stream_openai: false }, defaults);
        expect(result).toMatchObject({ temperature: 0.85, stream_openai: false });
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

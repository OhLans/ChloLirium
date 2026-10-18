import { pickPromptPreset } from './model.js';
import { presetCover } from './presentation.js';

const markers = {
    chat_history: 'chatHistory', world_info_before: 'worldInfoBefore', world_info_after: 'worldInfoAfter',
    char_description: 'charDescription', char_personality: 'charPersonality', persona_description: 'personaDescription',
    scenario: 'scenario', dialogue_examples: 'dialogueExamples', main_prompt: 'main',
    enhance_definitions: 'enhanceDefinitions', jailbreak: 'jailbreak', nsfw_prompt: 'nsfw',
};
const structural = new Set(['chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'charDescription', 'charPersonality', 'personaDescription', 'scenario', 'dialogueExamples']);
const portableMacros = new Set(['char', 'user', 'group', 'description', 'personality', 'scenario', 'persona', 'mesexamples', 'original', 'trim']);
const behaviorFields = { continueNudge: 'continue_nudge_prompt', impersonationPrompt: 'impersonation_prompt', groupNudge: 'group_nudge_prompt', newChatPrompt: 'new_chat_prompt', newGroupChatPrompt: 'new_group_chat_prompt', sendIfEmpty: 'send_if_empty' };
const completionFields = { assistantPrefill: 'assistant_prefill', assistantImpersonation: 'assistant_impersonation', continuePrefill: 'continue_prefill', continuePostfix: 'continue_postfix', namesBehavior: 'names_behavior', squashSystemMessages: 'squash_system_messages', useSystemPrompt: 'use_sysprompt' };

function checkPortableText(text, name) {
    for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        if (!match[1].trim().startsWith('//') && !portableMacros.has(match[1].trim().toLowerCase())) throw new Error(`“${name}” uses a macro outside the supported Loom subset. Nothing was imported.`);
    }
}

/** A deliberately limited conversion, not a Loom macro/runtime emulator. Reject
 * unsupported semantics before the native import writes or selects anything. */
export function convertLoomPreset(value) {
    const blocks = value.blocks;
    if (!Array.isArray(blocks) || !blocks.length) throw new Error('This Loom preset has no blocks.');
    if (value.customBody?.enabled || value.parameters?.customBody?.enabled) throw new Error('Loom custom request bodies need further conversion. Nothing was imported.');
    const categories = new Map();
    const ids = new Set();
    let afterHistory = false;
    for (const block of blocks) {
        if (!block || typeof block.id !== 'string' || !block.id || ids.has(block.id) || typeof block.name !== 'string' || typeof block.content !== 'string') throw new Error('Invalid or duplicate Loom block.');
        if (!block.marker && Object.values(markers).includes(block.id)) throw new Error(`“${block.name}” uses a reserved ST marker identifier. Nothing was imported.`);
        ids.add(block.id);
        if (block.variables?.length || block.placementBinding || block.sealed || block.characterTagTrigger?.length || block.categoryMode === 'radio') throw new Error(`“${block.name}” uses Loom variables, protected content or category rules that need further conversion. Nothing was imported.`);
        if (block.marker === 'category') categories.set(block.id, block);
        else if (block.marker && !Object.hasOwn(markers, block.marker)) throw new Error(`Unsupported Loom marker: ${block.marker}. Nothing was imported.`);
        if (block.role && !['system', 'user', 'assistant'].includes(block.role)) throw new Error(`“${block.name}” uses an append role that needs further conversion. Nothing was imported.`);
        if (block.marker === 'chat_history') afterHistory = true;
        // Loom can reorder these at generation time; a native static order
        // cannot represent that while preserving the visible block sequence.
        if (afterHistory && !block.marker && (block.position ?? 'pre_history') === 'pre_history') throw new Error(`Move “${block.name}” above Chat History in Loom before importing. Nothing was imported.`);
        checkPortableText(block.content, block.name);
    }
    const prompts = [], order = [], convertedIds = new Set();
    let category = null;
    for (const block of blocks) {
        if (block.marker === 'category') { category = block; continue; }
        const group = block.group === undefined ? category : categories.get(block.group);
        if (block.group && !group) throw new Error(`Unknown Loom category for “${block.name}”.`);
        const identifier = Object.hasOwn(markers, block.marker) ? markers[block.marker] : block.id;
        if (convertedIds.has(identifier)) throw new Error('Duplicate Loom content marker. Nothing was imported.');
        convertedIds.add(identifier);
        const position = block.position ?? 'pre_history';
        if (!['pre_history', 'post_history', 'in_history'].includes(position) || (position === 'in_history' && (!Number.isInteger(block.depth) || block.depth < 0))) throw new Error(`Invalid Loom placement for “${block.name}”.`);
        if (block.injectionTrigger !== undefined && (!Array.isArray(block.injectionTrigger) || block.injectionTrigger.some(trigger => !['normal', 'continue', 'impersonate', 'swipe', 'regenerate', 'quiet'].includes(trigger)))) throw new Error('Unsupported Loom generation triggers. Nothing was imported.');
        prompts.push({
            identifier, name: block.name, content: block.content, role: block.role ?? 'system',
            system_prompt: ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'].includes(identifier),
            marker: structural.has(identifier), injection_position: position === 'pre_history' ? 0 : 1,
            injection_depth: position === 'post_history' ? 0 : (block.depth ?? 4), injection_order: 100,
            injection_trigger: block.injectionTrigger ?? [], forbid_overrides: false,
            ...(group ? { chlo_category: group.name } : {}),
        });
        order.push({ identifier, enabled: block.enabled !== false && group?.enabled !== false });
    }
    if (!convertedIds.has('chatHistory')) throw new Error('Add a Chat History marker to this Loom preset before importing it.');
    const formatting = {};
    for (const [source, fields] of [[value.promptBehavior, behaviorFields], [value.completionSettings, completionFields]]) {
        for (const [key, nativeKey] of Object.entries(fields)) {
            if (source?.[key] === undefined) continue;
            const expected = ['continue_prefill', 'squash_system_messages', 'use_sysprompt'].includes(nativeKey) ? 'boolean' : nativeKey === 'names_behavior' ? 'number' : 'string';
            if (typeof source[key] !== expected || (expected === 'number' && !Number.isFinite(source[key]))) throw new Error(`Invalid Loom prompt formatting: ${key}.`);
            if (typeof source[key] === 'string') checkPortableText(source[key], key);
            formatting[nativeKey] = source[key];
        }
    }
    return {
        ...formatting,
        prompts, prompt_order: [{ character_id: 100001, order }],
        chlo_preset: { format: 'Loom', description: value.description ?? value.metadata?.description ?? '', cover: presetCover(value) },
    };
}

/** Keep normal ST imports intact; convert only recognizable alternate formats. */
export function preparePresetImport(input, defaults) {
    let value = input;
    if (value?.preset?.blocks) value = value.preset;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a Chat Completion preset.');
    if (Array.isArray(value.blocks)) return convertLoomPreset(value);
    if (value.engine === 'loom') throw new Error('Export this preset as Loom JSON in LumiVerse before importing it.');
    if (value.version && value.data?.prompts) value = value.data;
    const legacy = !Array.isArray(value.prompts) && ['main_prompt', 'nsfw_prompt', 'jailbreak_prompt'].some(key => typeof value[key] === 'string');
    if (legacy) {
        value = { ...pickPromptPreset(value), prompts: structuredClone(defaults.prompts), prompt_order: structuredClone(defaults.prompt_order), chlo_preset: { ...value.chlo_preset, format: 'Legacy' } };
        for (const [key, id] of [['main_prompt', 'main'], ['nsfw_prompt', 'nsfw'], ['jailbreak_prompt', 'jailbreak']]) {
            if (typeof value[key] === 'string') value.prompts.find(prompt => prompt.identifier === id).content = value[key];
            delete value[key];
        }
    }
    if (!Array.isArray(value.prompts)) throw new Error('This file has no supported Chat Completion prompt blocks.');
    if (value.prompt_order?.[0]?.identifier) value = { ...value, prompt_order: [{ character_id: 100001, order: value.prompt_order }] };
    const cover = presetCover(value);
    if (cover) value = { ...value, chlo_preset: { ...value.chlo_preset, cover } };
    return value;
}

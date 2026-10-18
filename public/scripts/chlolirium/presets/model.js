/** Prompt ownership is explicit: an old preset may contain any provider settings,
 * but selecting it must never replace the shared connection or sampling state. */
export const promptPresetKeys = new Set([
    'prompts', 'prompt_order', 'extensions', 'chlo_preset',
    'main_prompt', 'nsfw_prompt', 'jailbreak_prompt',
    'names_behavior', 'send_if_empty', 'impersonation_prompt', 'new_chat_prompt',
    'new_group_chat_prompt', 'new_example_chat_prompt', 'continue_nudge_prompt',
    'wi_format', 'scenario_format', 'personality_format', 'group_nudge_prompt',
    'assistant_prefill', 'assistant_impersonation', 'use_sysprompt',
    'squash_system_messages', 'continue_prefill', 'continue_postfix',
]);

export function pickPromptPreset(settings) {
    return structuredClone(Object.fromEntries(Object.entries(settings).filter(([key]) => promptPresetKeys.has(key))));
}

export function getOrder(preset) {
    return preset.prompt_order?.find(entry => String(entry.character_id) === '100001')?.order
        ?? preset.prompt_order?.[0]?.order ?? [];
}

export function getBlocks(preset) {
    const prompts = new Map((preset.prompts ?? []).filter(Boolean).map(prompt => [prompt.identifier, prompt]));
    const order = getOrder(preset);
    const used = new Set(order.map(entry => entry.identifier));
    return [
        ...order.filter(entry => prompts.has(entry.identifier)).map(entry => ({ prompt: prompts.get(entry.identifier), entry })),
        ...[...prompts.values()].filter(prompt => !used.has(prompt.identifier)).map(prompt => ({ prompt, entry: null })),
    ];
}

export function blockCategory(prompt, attached = true) {
    if (!attached) return 'Unused blocks';
    if (prompt.chlo_category) return prompt.chlo_category;
    if (['charDescription', 'charPersonality', 'scenario', 'personaDescription', 'enhanceDefinitions'].includes(prompt.identifier)) return 'Character & persona';
    if (['worldInfoBefore', 'worldInfoAfter'].includes(prompt.identifier)) return 'World & memory';
    if (['chatHistory', 'dialogueExamples'].includes(prompt.identifier)) return 'Conversation';
    return 'Core instructions';
}

/** Convert supported ST formats without flattening markers, triggers or extension
 * data. Unknown formats are rejected before anything is written to disk. */
export function importPromptPreset(value, defaults) {
    if (value?.version && value?.data?.prompts) value = value.data;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a SillyTavern chat-completion preset or prompt export.');
    const legacy = ['main_prompt', 'nsfw_prompt', 'jailbreak_prompt'].some(key => typeof value[key] === 'string');
    if (!Array.isArray(value.prompts) && !legacy) throw new Error('This file has no supported prompt blocks. Loom files need conversion before importing.');
    const preset = pickPromptPreset(value);
    preset.prompts ??= structuredClone(defaults.prompts ?? []);
    if (legacy && !value.prompts && !preset.prompt_order && defaults.prompt_order) preset.prompt_order = structuredClone(defaults.prompt_order);
    if (legacy) {
        for (const [key, identifier] of [['main_prompt', 'main'], ['nsfw_prompt', 'nsfw'], ['jailbreak_prompt', 'jailbreak']]) {
            if (typeof value[key] !== 'string') continue;
            const prompt = preset.prompts.find(block => block.identifier === identifier);
            if (prompt) prompt.content = value[key];
            else preset.prompts.push({ identifier, name: identifier, role: 'system', content: value[key], system_prompt: true });
            delete preset[key];
        }
    }
    const ids = new Set();
    for (const prompt of preset.prompts) {
        if (!prompt || typeof prompt.identifier !== 'string' || !prompt.identifier || ids.has(prompt.identifier)
            || (prompt.content !== undefined && typeof prompt.content !== 'string')) throw new Error('Prompt blocks must have unique identifiers and text content.');
        if (prompt.name !== undefined && typeof prompt.name !== 'string') throw new Error('Block names must be text.');
        if (prompt.role !== undefined && !['system', 'user', 'assistant'].includes(prompt.role)) throw new Error('A block has an unsupported message role.');
        if (prompt.injection_trigger !== undefined && (!Array.isArray(prompt.injection_trigger) || prompt.injection_trigger.some(trigger => typeof trigger !== 'string'))) throw new Error('Invalid generation conditions.');
        for (const key of ['injection_depth', 'injection_order', 'injection_position']) {
            if (prompt[key] !== undefined && !Number.isFinite(Number(prompt[key]))) throw new Error('Invalid block placement.');
        }
        ids.add(prompt.identifier);
    }
    if (preset.prompt_order !== undefined && !Array.isArray(preset.prompt_order)) throw new Error('Invalid prompt order.');
    // Prompt-manager exports store one flat order; full presets store a list of orders.
    if (preset.prompt_order?.length && preset.prompt_order[0] && !Object.hasOwn(preset.prompt_order[0], 'character_id')) {
        preset.prompt_order = [{ character_id: 100001, order: preset.prompt_order }];
    }
    preset.prompt_order ??= [{ character_id: 100001, order: preset.prompts.map(prompt => ({ identifier: prompt.identifier, enabled: prompt.enabled !== false })) }];
    for (const list of preset.prompt_order) {
        if (!Array.isArray(list?.order) || list.order.some(entry => !entry || typeof entry.identifier !== 'string')) throw new Error('Invalid block order.');
    }
    if (!preset.prompt_order.some(entry => String(entry.character_id) === '100001')) {
        preset.prompt_order.push({ character_id: 100001, order: structuredClone(getOrder(preset)) });
    }
    if (preset.chlo_preset !== undefined && (!preset.chlo_preset || typeof preset.chlo_preset !== 'object' || Array.isArray(preset.chlo_preset))) throw new Error('Invalid preset details.');
    // Do not accept remote URLs or active SVG/HTML as cover art.
    if (preset.chlo_preset?.cover && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(preset.chlo_preset.cover)) delete preset.chlo_preset.cover;
    return preset;
}

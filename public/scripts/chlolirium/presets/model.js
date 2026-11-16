/** Prompt-only fields for portable prompt examples and conversions. */
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

/** Serialize both live settings (temp_openai) and stored presets (temperature)
 * using the native field map. Connection profiles remain independent. */
export function pickChatCompletionPreset(settings, definitions) {
    const preset = {};
    for (const [key, [, setting, , isConnection]] of Object.entries(definitions)) {
        if (isConnection) continue;
        const value = Object.hasOwn(settings, setting) ? settings[setting] : settings[key];
        if (value !== undefined) preset[key] = value;
    }
    return structuredClone(preset);
}

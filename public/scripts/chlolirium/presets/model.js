/** Selecting a prompt preset never replaces shared generation or connection
 * settings, even when an older preset file includes those values. */
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

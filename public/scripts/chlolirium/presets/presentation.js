/** Presentation only: section headings never rearrange the native prompt order. */
export function promptSection(prompt) {
    if (typeof prompt.chlo_category === 'string' && prompt.chlo_category.trim()) return prompt.chlo_category;
    if (['charDescription', 'charPersonality', 'scenario', 'personaDescription', 'enhanceDefinitions'].includes(prompt.identifier)) return 'Character & persona';
    if (['worldInfoBefore', 'worldInfoAfter'].includes(prompt.identifier)) return 'World & memory';
    if (['chatHistory', 'dialogueExamples'].includes(prompt.identifier)) return 'Conversation';
    return 'Core instructions';
}

export function presetBlockCount(preset) {
    const order = preset.prompt_order?.find(entry => String(entry.character_id) === '100001')?.order ?? preset.prompt_order?.[0]?.order;
    const ids = new Set((preset.prompts ?? []).filter(Boolean).map(prompt => prompt.identifier));
    return order ? order.filter(entry => ids.has(entry.identifier)).length : ids.size;
}

/** Covers are images, never HTML or an active SVG document. */
export function safePresetCover(value) {
    if (typeof value !== 'string') return '';
    if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
}

export function presetCover(preset) {
    // The first key belongs to this fork; the others appear in portable presets.
    return safePresetCover(preset.chlo_preset?.cover ?? preset.coverUrl ?? preset.metadata?.coverUrl ?? preset.metadata?.cover_url);
}

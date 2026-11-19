/** Classify for editing only. Never evaluate macros or change stored prompts. */
export function promptEditorGroup(prompt) {
    if (prompt.marker || ['charDescription', 'charPersonality', 'scenario', 'personaDescription', 'worldInfoBefore', 'worldInfoAfter', 'chatHistory', 'dialogueExamples'].includes(prompt.identifier)) return 'context';

    // A wrapper can include whitespace control, but settings macros must stay
    // among the instructions even when they produce no visible prompt text.
    const content = String(prompt.content ?? '').replace(/\{\{trim\}\}/gi, '').trim();
    const tags = /<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\s*\/?>/g;
    if (content && content.replace(tags, '').trim() === '') return 'context';
    if (/^(?:\{\{(?:summary|persona|description|personality|scenario|mesExamples|wiBefore|wiAfter)\}\}\s*)+$/i.test(content)) return 'context';
    return 'instructions';
}

/** Stable editor groups holding the original objects; execution uses its own order. */
export function promptEditorGroups(prompts) {
    return [
        { id: 'instructions', label: 'Instructions' },
        { id: 'context', label: 'Context & structure' },
    ].map(group => ({ ...group, prompts: prompts.filter(prompt => promptEditorGroup(prompt) === group.id) }))
        .filter(group => group.prompts.length);
}

export function promptEditorPlacement(prompt, index) {
    if (prompt.injection_position === 1) {
        const depth = prompt.injection_depth ?? 4;
        return { label: `In chat · depth ${depth}`, title: `In-chat placement: depth ${depth}, role ${prompt.role ?? 'system'}, order ${prompt.injection_order ?? 100}. List position does not control this injection.` };
    }
    return { label: `Position ${index + 1}`, title: 'Position in the preset order. Context markers expand when the request is built.' };
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

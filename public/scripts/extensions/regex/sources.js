// Worldhopper writes these stable IDs directly into SillyTavern's global list.
// Its install receipts live at extensionSettings.worldhopper.codex.displayScripts.
const worldhopperRules = new Map([
    ['wh-possession-box', 'WH - Possession'],
    ['wh-release-box', 'WH - Release'],
    ['wh-moments', 'WH - Moments'],
    ['wh-place', 'WH - Place'],
    ['wh-stray-markers', 'WH - Stray markers'],
    ['wh-body-lines', 'WH - Body lines'],
]);

/**
 * Resolve provenance without inspecting or executing the rule's pattern.
 * Extensions and importers can supply chlo_regex_source: { type, name }.
 * @param {object} script Stored regex rule
 * @param {object} settings Account extension settings
 * @returns {{type: string, name: string, evidence: string}|null} Source and how it was identified
 */
export function getRegexSource(script, settings) {
    const source = script.chlo_regex_source;
    if (['extension', 'lorebook'].includes(source?.type) && typeof source.name === 'string' && source.name.trim()) {
        return { type: source.type, name: source.name.trim(), evidence: 'declared' };
    }

    const bundledName = worldhopperRules.get(script.id);
    if (!bundledName) return null;
    const receipts = settings.worldhopper?.codex?.displayScripts;
    if (receipts && Object.hasOwn(receipts, script.id) && typeof receipts[script.id] === 'string') {
        return { type: 'extension', name: 'Worldhopper Engine', evidence: 'installed' };
    }
    if (script.scriptName === bundledName) {
        return { type: 'extension', name: 'Worldhopper Engine', evidence: 'bundled' };
    }
    return null;
}

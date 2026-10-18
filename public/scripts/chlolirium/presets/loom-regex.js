import { parseLoomText } from './loom-macros.js';

const placements = { user_input: 1, ai_output: 2, slash_command: 3, world_info: 5, reasoning: 6 };

/** Convert portable Loom scripts to native preset-scoped regex records. */
export function convertLoomRegex(value) {
    const root = value.regex_scripts, embedded = value.extensions?.regex_scripts;
    if (root && embedded && JSON.stringify(root) !== JSON.stringify(embedded)) throw new Error('Conflicting Loom regex collections. Nothing was imported.');
    const scripts = embedded ?? root ?? [];
    if (!Array.isArray(scripts)) throw new Error('Invalid Loom regex collection.');
    return scripts.map((script, index) => ({ script, index })).sort((a, b) => (a.script.sort_order ?? a.index) - (b.script.sort_order ?? b.index)).map(({ script, index }) => {
        const error = reason => { throw new Error(`Regex “${script.name ?? index + 1}”: ${reason} Nothing was imported.`); };
        if (script.actions?.length || (script.scope && script.scope !== 'global')) error('Loom regex actions/scopes need further conversion.');
        if (!['none', 'escaped'].includes(script.substitute_macros ?? 'none')) error('This macro substitution mode needs further conversion.');
        if (!Array.isArray(script.placement) || !script.placement.length || script.placement.some(key => !Object.hasOwn(placements, key))) error('Unsupported placement.');
        if (!Array.isArray(script.target) || !script.target.length || script.target.some(key => !['display', 'prompt'].includes(key))) error('Unsupported target.');
        if (typeof script.find_regex !== 'string' || typeof script.replace_string !== 'string' || typeof script.flags !== 'string') error('Invalid pattern, replacement or flags.');
        let findRegex;
        try { findRegex = new RegExp(script.find_regex, script.flags).toString(); } catch { error('Invalid regular expression.'); }
        for (const depth of [script.min_depth, script.max_depth]) if (depth != null && (!Number.isInteger(depth) || depth < -1)) error('Invalid depth.');
        if (script.substitute_macros === 'escaped') {
            for (const template of [script.find_regex, script.replace_string]) {
                const ast = parseLoomText(template, script.name);
                // Display rules run outside generation; only persisted/identity reads
                // are meaningful here. Session writes must never run while rendering.
                const check = nodes => nodes.forEach(node => {
                    if (typeof node === 'string') return;
                    if (!['getchatvar', 'char', 'user', 'group', 'groupothers'].includes(node.name)) error(`{{${node.name}}} needs generation-time state.`);
                    node.args.forEach(check);
                });
                check(ast);
            }
        }
        return {
            id: script.metadata?.imported_script_id || script.script_id || `chlo-loom-regex-${index}`,
            scriptName: script.folder ? `${script.folder} / ${script.name}` : script.name,
            findRegex, replaceString: script.replace_string, trimStrings: [],
            placement: script.placement.map(key => placements[key]), disabled: script.disabled === true,
            markdownOnly: script.target.includes('display'), promptOnly: script.target.includes('prompt'),
            runOnEdit: script.run_on_edit === true, substituteRegex: script.substitute_macros === 'escaped' ? 2 : 0,
            minDepth: script.min_depth ?? null, maxDepth: script.max_depth ?? null,
            chlo_loom: { version: 1, mode: script.substitute_macros ?? 'none' },
        };
    });
}

/** JS replacement syntax, including $&, $$ and numbered captures. Resolve the
 * template only; text captured from the chat is never executed as a macro. */
export function replaceLoomRegex(text, regex, template, mode, resolve) {
    const replacement = mode === 'escaped' ? resolve(template).replace(/\$/g, '$$$$') : template;
    return text.replace(regex, replacement);
}

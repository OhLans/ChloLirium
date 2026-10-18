// Portable Loom compatibility, based on the documented macro behavior at
// LumiVerse 3ca135a. Deliberately isolated from ST's selectable macro engines.
const nativeNames = new Set(['char', 'user', 'group', 'groupothers', 'description', 'personality', 'scenario', 'persona', 'mesexamples', 'original']);
const variableNames = new Set(['setvar', 'getvar', 'setchatvar', 'getchatvar']);
const cache = new Map();

function fail(message) { throw new Error(message); }

/** Scan balanced headers first; a regex cannot parse nested {{if {{getvar::x}}}}. */
function tokens(text, depth) {
    if (depth > 64) fail('Macro nesting exceeds 64 levels.');
    const result = [];
    let literal = '';
    for (let i = 0; i < text.length;) {
        if (text[i] === '\\' && /[{}]/.test(text[i + 1] ?? '')) {
            literal += text[i + 1]; i += 2; continue;
        }
        if (!text.startsWith('{{', i)) { literal += text[i++]; continue; }
        if (literal) { result.push(literal); literal = ''; }
        const start = i + 2;
        const comment = /^\s*\/\//.test(text.slice(start));
        let nesting = 1, end = start;
        for (; end < text.length; end++) {
            if (!comment && text.startsWith('{{', end)) { nesting++; end++; } else if (text.startsWith('}}', end)) { if (--nesting === 0) break; end++; }
        }
        if (nesting) fail('Unclosed macro header.');
        const header = text.slice(start, end).trimStart();
        i = end + 2;
        if (comment) { result.push({ name: '//', args: [] }); continue; }
        const match = /^(\/?[a-z][\w-]*)([\s\S]*)$/i.exec(header);
        if (!match) fail(`Unsupported macro syntax: {{${header.slice(0, 60)}}}.`);
        const name = match[1].toLowerCase();
        let rest = match[2];
        const args = [];
        if (/^\s*::/.test(rest)) rest = rest.replace(/^\s*::/, '');
        else if (/^\s/.test(rest)) rest = rest.trimStart();
        else if (rest) fail(`Unsupported arguments for {{${name}}}.`);
        if (match[2].trim()) {
            let argStart = 0, level = 0;
            for (let j = 0; j <= rest.length; j++) {
                if (rest.startsWith('{{', j)) { level++; j++; } else if (rest.startsWith('}}', j)) { level--; j++; } else if (j === rest.length || (level === 0 && rest.startsWith('::', j))) {
                    // Loom strips multiline framing, preserving intentional inline spaces.
                    const arg = rest.slice(argStart, j).replace(/^\s*[\r\n]\s*/, '').replace(/\s*[\r\n]\s*$/, '');
                    args.push(parse(arg, depth + 1));
                    argStart = j + 2; j++;
                }
            }
        }
        result.push({ name, args });
    }
    if (literal) result.push(literal);
    return result;
}

function parse(text, depth = 0) {
    const stream = tokens(text, depth);
    let cursor = 0;
    function sequence(close = '', scopeDepth = 0) {
        if (scopeDepth > 64) fail('Macro nesting exceeds 64 levels.');
        const nodes = [];
        while (cursor < stream.length) {
            const node = stream[cursor++];
            if (typeof node === 'string') { nodes.push(node); continue; }
            if (node.name !== '//' && node.name.startsWith('/')) {
                if (node.name !== `/${close}` || node.args.length) fail(`Unexpected {{${node.name}}}.`);
                return nodes;
            }
            if (node.name === 'if' || (['setvar', 'setchatvar'].includes(node.name) && node.args.length === 1)) {
                node.body = sequence(node.name, scopeDepth + 1);
            }
            if (nativeNames.has(node.name) || ['trim', 'else', 'noop', 'newline', 'space', '//'].includes(node.name)) {
                if (node.args.length) fail(`Unsupported arguments for {{${node.name}}}.`);
                if (node.name === 'else' && close !== 'if') fail('{{else}} needs an enclosing {{if}}.');
            } else if (variableNames.has(node.name)) {
                const expected = node.name.startsWith('set') && !node.body ? 2 : 1;
                if (node.args.length !== expected) fail(`Unsupported arguments for {{${node.name}}}.`);
            } else if (node.name === 'if') {
                if (node.args.length !== 1) fail('Use one condition in {{if}}.');
                if (node.body.filter(x => x?.name === 'else').length > 1) fail('Use one {{else}} per condition.');
                const literalCondition = node.args[0].filter(x => typeof x === 'string').join('');
                if (/[<>=]|(?:^|\s)[.$@][\w-]/.test(literalCondition)) fail('Loom comparison/shorthand conditions need further conversion.');
            } else if (node.name === 'roll') {
                if (node.args.length !== 1 || node.args[0].length !== 1 || !/^\d+d\d+$/i.test(node.args[0][0])) fail('Use NdS notation for Loom dice.');
            } else if (node.name !== 'random') fail(`Unsupported Loom macro: {{${node.name}}}.`);
            nodes.push(node);
        }
        if (close) fail(`Missing {{/${close}}}.`);
        return nodes;
    }
    return sequence();
}

export function parseLoomText(text, label = 'Loom preset') {
    try {
        if (cache.has(text)) return cache.get(text);
        const ast = parse(text);
        if (cache.size >= 128) cache.delete(cache.keys().next().value);
        cache.set(text, ast);
        return ast;
    } catch (error) {
        throw new Error(`“${label}”: ${error.message} Nothing was imported.`);
    }
}

/** Local variables live for one collection build. Chat variables use the
 * caller's chat-scoped storage and survive generations without touching ST vars.
 * Native identity values and captured prose are returned as data, never re-run. */
export function createLoomResolver({ native, chat = {}, random = Math.random, onChatWrite = () => {}, transform = x => x }) {
    const local = new Map();
    const truthy = value => !['', '0', 'false', 'null', 'undefined', 'no', 'off'].includes(value.trim().toLowerCase());
    function evaluate(nodes, options) {
        return nodes.map(node => {
            if (typeof node === 'string') return node;
            const { name, args, body } = node;
            if (name === '//') return '';
            if (name === 'if') {
                let condition = evaluate(args[0], options).trim();
                const inverted = condition.startsWith('!');
                if (inverted) condition = condition.slice(1).trim();
                const yes = truthy(condition) !== inverted;
                const split = body.findIndex(x => x?.name === 'else');
                const branch = yes ? body.slice(0, split < 0 ? undefined : split) : split < 0 ? [] : body.slice(split + 1);
                return evaluate(branch, options);
            }
            const values = args.map(arg => evaluate(arg, options));
            if (variableNames.has(name)) {
                const key = values[0].trim();
                if (name === 'getvar') return transform(local.get(key) ?? '');
                if (name === 'getchatvar') return transform(Object.hasOwn(chat, key) ? String(chat[key]) : '');
                const value = body ? evaluate(body, options) : values[1];
                if (name === 'setvar') local.set(key, value);
                else if (!Object.hasOwn(chat, key) || chat[key] !== value) {
                    Object.defineProperty(chat, key, { value, enumerable: true, configurable: true, writable: true });
                    onChatWrite();
                }
                return '';
            }
            if (name === 'random') {
                if (!values.length) return String(Math.round(random()));
                if (values.length <= 2 && values.every(x => x.trim() && Number.isFinite(Number(x)))) {
                    const min = parseInt(values[0]) || 0, max = parseInt(values[1]) || 1;
                    return String(max < min ? min : Math.floor(random() * (max - min + 1)) + min);
                }
                return values[Math.floor(random() * values.length)];
            }
            if (name === 'roll') {
                const [count, sides] = values[0].toLowerCase().split('d').map(Number);
                if (count < 1 || sides < 1) return '0';
                let sum = 0;
                for (let i = 0; i < Math.min(count, 100); i++) sum += Math.floor(random() * sides) + 1;
                return String(sum);
            }
            if (name === 'trim' || name === 'noop') return '';
            if (name === 'space') return ' ';
            if (name === 'newline') return '\n';
            return transform(native(`{{${name}}}`, options));
        }).join('');
    }
    return (text, options = {}) => evaluate(parseLoomText(text), options);
}

/** The saved format is shared with the former CSS Snippets extension. */
export const legacySnippetFolder = 'SillyTavern-CssSnippets';
export const syncedSnippetKey = 'csss--syncedList';

const list = value => Array.isArray(value) ? value : [];
const keys = value => [...new Set(list(value).filter(id => typeof id === 'string' || typeof id === 'number').map(String))];
const isSnippet = value => value && typeof value === 'object' && typeof value.content === 'string';

export function normalizeSnippet(value, themeSnippets = {}, createId = () => crypto.randomUUID()) {
    const name = typeof value.name === 'string' ? value.name : '';
    const themeList = value.themeList ?? Object.keys(themeSnippets).filter(theme => list(themeSnippets[theme]).includes(name));
    return {
        id: value.id == null || value.id === '' ? createId() : String(value.id),
        name,
        content: value.content,
        isDisabled: Boolean(value.isDisabled),
        isGlobal: value.isGlobal !== false,
        isCollapsed: value.isCollapsed ?? value.isCollapsedd ?? false,
        isSynced: Boolean(value.isSynced),
        isDeleted: Boolean(value.isDeleted),
        modifiedOn: Number(value.modifiedOn) || 0,
        themeList: keys(themeList),
        charList: keys(value.charList),
        groupList: keys(value.groupList),
    };
}

export function readSnippetSettings(settings, createId) {
    const themeSnippets = settings?.themeSnippets ?? {};
    const used = new Set();
    const snippetList = list(settings?.snippetList).filter(isSnippet).map(value => {
        const snippet = normalizeSnippet(value, themeSnippets, createId);
        if (used.has(snippet.id)) snippet.id = createId();
        used.add(snippet.id);
        return snippet;
    }).filter(snippet => !snippet.isDeleted);
    return { ...settings, snippetList, themeSnippets, filters: settings?.filters ?? {} };
}

export function mergeSyncedSnippets(snippets, saved, createId) {
    const next = [...snippets];
    for (const entry of list(saved).filter(isSnippet)) {
        if (entry.id == null || entry.id === '') continue;
        const incoming = normalizeSnippet(entry, {}, createId);
        const index = next.findIndex(snippet => snippet.id === incoming.id);
        const current = next[index];
        if (!incoming.isSynced) {
            if (current?.isSynced && incoming.modifiedOn >= current.modifiedOn) next[index] = { ...current, isSynced: false };
        } else if (!current && !incoming.isDeleted) {
            next.push(incoming);
        } else if (current && incoming.modifiedOn > current.modifiedOn) {
            if (incoming.isDeleted) next.splice(index, 1);
            else next[index] = incoming;
        }
    }
    return next;
}

/** A global rule wins over its other scopes. Linked theme + chat must both
 * match. Apply global first, then matching themes, then chat-only rules. */
export function activeSnippets(snippets, { theme, character, group }) {
    const buckets = [[], [], []];
    for (const snippet of snippets) {
        if (snippet.isDisabled || snippet.isDeleted || !snippet.content.trim()) continue;
        const themeMatch = snippet.themeList.includes(theme);
        const chatMatch = group != null ? snippet.groupList.includes(String(group)) : character != null && snippet.charList.includes(character);
        const hasChatScope = snippet.charList.length > 0 || snippet.groupList.length > 0;
        if (snippet.isGlobal) buckets[0].push(snippet);
        else if (themeMatch && (!hasChatScope || chatMatch)) buckets[1].push(snippet);
        else if (chatMatch && !snippet.themeList.length) buckets[2].push(snippet);
    }
    return buckets.flat();
}

export function parseSnippetImport(text, fileName, createId) {
    if (!text.trim()) throw new Error('The file is empty.');
    if (fileName.toLowerCase().endsWith('.css')) {
        return [normalizeSnippet({ name: fileName.replace(/\.css$/i, ''), content: text, isDisabled: true }, {}, createId)];
    }
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed) ? parsed : parsed?.snippetList ?? (isSnippet(parsed) ? [parsed] : null);
    if (!Array.isArray(entries) || !entries.length || !entries.every(isSnippet)) {
        throw new Error('Choose a CSS file or a CSS Snippets export.');
    }
    return entries.filter(entry => !entry.isDeleted).map(entry => normalizeSnippet({ ...entry, isSynced: false }, parsed?.themeSnippets, createId));
}

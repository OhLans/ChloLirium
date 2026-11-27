import { describe, expect, test } from '@jest/globals';
import { activeSnippets, mergeSyncedSnippets, parseSnippetImport, readSnippetSettings } from '../public/scripts/chlolirium/user-settings/snippets-data.js';

const newId = () => 'generated-id';

describe('Native CSS Snippets migration', () => {
    test('reads the standalone settings without changing the source or losing disabled rules and legacy theme links', () => {
        const source = {
            themeSnippets: { Glimmer: ['Header', 'Second'], Midnight: ['Ignored'] },
            filters: { disabled: true },
            snippetList: [
                { id: 'a', name: 'Header', content: '#top-bar { opacity: .6; }\n', isDisabled: true, isGlobal: false, isCollapsedd: true, charList: ['hero.png'], groupList: [321] },
                { id: 'b', name: 'Second', content: '/* Keep whitespace */  \n', themeList: [] },
            ],
        };
        const before = structuredClone(source);
        const settings = readSnippetSettings(source, newId);
        expect(source).toEqual(before);
        expect(settings.filters).toEqual(source.filters);
        expect(settings.snippetList.map(item => item.id)).toEqual(['a', 'b']);
        expect(settings.snippetList[0]).toMatchObject({
            isDisabled: true, isGlobal: false, isCollapsed: true, content: source.snippetList[0].content,
            themeList: ['Glimmer'], charList: ['hero.png'], groupList: ['321'],
        });
        expect(settings.snippetList[1].themeList).toEqual([]);
    });

    test('keeps global, theme and context order and requires both links on a jointly scoped rule', () => {
        const snippet = (id, scopes = {}) => ({ id, name: id, content: 'x{}', isGlobal: false, ...scopes });
        const { snippetList } = readSnippetSettings({ snippetList: [
            snippet('chat', { charList: ['a.png'] }),
            snippet('theme+chat', { themeList: ['Glimmer'], charList: ['a.png'] }),
            snippet('global', { isGlobal: true, themeList: ['Other'] }),
            snippet('theme', { themeList: ['Glimmer'] }),
            snippet('group', { groupList: ['99'] }),
            snippet('disabled', { isGlobal: true, isDisabled: true }),
            snippet('unlinked'),
        ] }, newId);
        const ids = ctx => activeSnippets(snippetList, ctx).map(item => item.id);
        expect(ids({ theme: 'Glimmer', character: 'a.png' })).toEqual(['global', 'theme+chat', 'theme', 'chat']);
        expect(ids({ theme: 'Glimmer', character: 'b.png' })).toEqual(['global', 'theme']);
        expect(ids({ theme: 'Other', character: 'a.png' })).toEqual(['global', 'chat']);
        expect(ids({ theme: 'Glimmer', character: 'a.png', group: 99 })).toEqual(['global', 'theme', 'group']);
    });

    test('honors more recent synced changes and deletions while leaving newer saved rules alone', () => {
        const entry = (id, modifiedOn, extra = {}) => ({ id, content: `${id}-${modifiedOn}`, isSynced: true, modifiedOn, ...extra });
        const { snippetList } = readSnippetSettings({ snippetList: [entry('newer', 30), entry('replace', 10), entry('delete', 1)] }, newId);
        const synced = [entry('newer', 20), entry('replace', 20), entry('delete', 5, { isDeleted: true }), entry('append', 10)];
        expect(mergeSyncedSnippets(snippetList, synced, newId).map(item => item.content)).toEqual(['newer-30', 'replace-20', 'append-10']);
    });

    test('round-trips an extension JSON export and pauses loose CSS until it is enabled', () => {
        const [imported] = parseSnippetImport(JSON.stringify([{ name: 'Layout', content: 'a { color: red; }', isSynced: true, themeList: ['My theme'], isGlobal: false }]), 'Snippets.json', newId);
        expect(imported).toMatchObject({ id: 'generated-id', name: 'Layout', content: 'a { color: red; }', isSynced: false, isGlobal: false, themeList: ['My theme'] });
        expect(parseSnippetImport('a { color: blue; }', 'palette.css', newId)[0]).toMatchObject({ name: 'palette', isDisabled: true });
        expect(() => parseSnippetImport('{"wrong":true}', 'unknown.json', newId)).toThrow('CSS Snippets export');
    });
});

import { describe, test, expect, jest } from '@jest/globals';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const mapping = JSON.parse(await readFile(new URL('src/chlolirium/lucide-map.json', root), 'utf8'));

async function findMissingIcons(directory, mapping, compatibility, missing = new Set()) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
        if (entry.isDirectory()) {
            if (!['lib', 'third-party', 'node_modules', 'icons'].includes(entry.name)) await findMissingIcons(path, mapping, compatibility, missing);
        } else if (/\.(?:html|js|css)$/.test(entry.name) && !entry.name.includes('.min.') && !entry.name.startsWith('chlolirium-')) {
            const content = await readFile(path, 'utf8');
            if (content.length > 2000000) continue;
            for (const [icon] of content.matchAll(/\bfa-[a-z0-9]+(?:-[a-z0-9]+)*/g)) {
                if (!mapping[icon] && !compatibility.has(icon)) missing.add(icon);
            }
        }
    }
    return missing;
}

describe('ChloLirium icon assets', () => {
    test('generated stylesheet and picker catalog match the bundled source', () => {
        expect(() => execFileSync(process.execPath, ['src/chlolirium/build-icons.mjs', '--check'], {
            cwd: fileURLToPath(root),
            stdio: 'pipe',
        })).not.toThrow();
    });

    test('all native icon classes are mapped or explicitly kept as compatibility icons', async () => {
        const compatibility = new Set([
            'fa-brands', 'fa-discord', 'fa-github', 'fa-markdown', 'fa-wikipedia-w', 'fa-youtube',
            'fa-solid', 'fa-regular', 'fa-fw', 'fa-xs', 'fa-sm', 'fa-lg', 'fa-xl',
            'fa-1x', 'fa-2x', 'fa-3x', 'fa-4x', 'fa-spin', 'fa-fade', 'fa-flip-horizontal',
        ]);
        const missing = await findMissingIcons(new URL('public/', root), mapping, compatibility);
        expect([...missing].sort()).toEqual([]);
    });

    test('opposing control states retain distinct artwork', () => {
        for (const [a, b] of [
            ['fa-eye', 'fa-eye-slash'], ['fa-toggle-on', 'fa-toggle-off'],
            ['fa-lock', 'fa-unlock'], ['fa-check', 'fa-xmark'],
            ['fa-play', 'fa-pause'], ['fa-volume-high', 'fa-volume-xmark'],
        ]) {
            expect(mapping[a]).toBeDefined();
            expect(mapping[b]).toBeDefined();
            expect(mapping[a]).not.toBe(mapping[b]);
        }
    });
});

describe('Lucide picker compatibility', () => {
    test('failed catalog loads can retry, and saved values remain fa-* classes', async () => {
        const originalFetch = global.fetch;
        const catalog = JSON.parse(await readFile(new URL('public/icons/lucide/catalog.json', root), 'utf8'));
        const fetchMock = jest.fn()
            .mockResolvedValueOnce({ ok: false })
            .mockResolvedValue({ ok: true, json: async () => catalog });
        global.fetch = fetchMock;
        try {
            const { getLucideIconChoices } = await import('../public/scripts/chlolirium-icons.js');
            await expect(getLucideIconChoices()).rejects.toThrow('catalog');
            const choices = await getLucideIconChoices();
            expect(choices).toHaveLength(catalog.length);
            for (const group of choices) {
                expect(group[0]).toMatch(/^fa-/);
                expect(mapping[group[0]]).toBe(group.at(-1).replace('cl-icon-', ''));
            }
            expect(choices.some(group => group.includes('cl-icon-settings'))).toBe(true);
            expect(await getLucideIconChoices()).toBe(choices);
            expect(fetchMock).toHaveBeenCalledTimes(2);
        } finally {
            global.fetch = originalFetch;
        }
    });
});

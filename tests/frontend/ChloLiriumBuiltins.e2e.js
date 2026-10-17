import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pageErrors = new WeakMap();
let dataRoot, server, url;
let serverLog = '';
test.use({ video: 'off' });

test.beforeAll(async () => {
    test.setTimeout(60000);
    dataRoot = await mkdtemp(path.join(tmpdir(), 'chlolirium-native-'));
    const user = path.join(dataRoot, 'default-user');
    await mkdir(user, { recursive: true });
    const settings = JSON.parse(await readFile(path.join(root, 'default/content/settings.json'), 'utf8'));
    settings.main_api = 'openai';
    settings.firstRun = false;
    const { integratedFeatures } = await import('../../public/scripts/chlolirium/legacy-extensions.js');
    settings.extension_settings.disabledExtensions = integratedFeatures.flatMap(f => [f.id, `third-party/${f.folders[0]}`]);
    settings.extension_settings.chloliriumBuiltinsMigrated = integratedFeatures.map(f => f.id);
    settings.extension_settings.SillyTavernMoonlitEchoesTheme = {
        enabled: true,
        activePreset: 'Courtyard QA',
        presets: { 'Courtyard QA': { customThemeColor: 'rgba(174, 149, 149, 1)', customTopBarColor: 'rgba(30, 30, 30, 0.5)', rawCustomCss: ':root { --qa-preserved-css: 1; }' } },
    };
    await writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
    await mkdir(path.join(user, 'User Avatars'), { recursive: true });
    await copyFile(path.join(root, 'default/content/user-default.png'), path.join(user, 'User Avatars/qa-second.png'));
    // Installed originals remain untouched; none may execute alongside core.
    for (const feature of integratedFeatures) {
        const legacy = path.join(user, 'extensions', feature.folders[0]);
        await mkdir(legacy, { recursive: true });
        await writeFile(path.join(legacy, 'manifest.json'), JSON.stringify({ display_name: feature.titles[0], js: 'index.js', loading_order: 65 }));
        await writeFile(path.join(legacy, 'index.js'), 'throw new Error("Duplicate standalone copy executed");');
    }
    const port = 19000 + Math.floor(Math.random() * 10000);
    url = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server.js', '--dataRoot', dataRoot, '--port', String(port), '--browserLaunchEnabled', 'false', '--listen', 'false'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => serverLog += chunk);
    server.stderr.on('data', chunk => serverLog += chunk);
    for (let i = 0; i < 400; i++) {
        try { if ((await fetch(url)).ok) return; } catch { /* Server is starting. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not start: ${serverLog.slice(-2000)}`);
});

test.afterAll(async () => {
    if (server && server.exitCode === null) {
        const stopped = new Promise(resolve => server.once('exit', resolve));
        server.kill('SIGTERM');
        await stopped;
    }
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true });
});

test.beforeEach(async ({ page }) => {
    pageErrors.set(page, []);
    page.on('pageerror', error => pageErrors.get(page).push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById('preloader'), { timeout: 30000 });
    await page.waitForFunction(async () => (await import('/script.js')).settingsReady);
    await page.waitForFunction(async () => (await import('/scripts/events.js')).eventSource.autoFireLastArgs.has('app_ready'));
    await page.evaluate(() => document.querySelectorAll('dialog[open] .popup-button-ok').forEach(button => button.click()));
    await page.locator('#rn-left-rail').waitFor();
    await page.locator('#SillyTavernMoonlitEchoesTheme-drawer').waitFor({ state: 'attached' });
});

test.afterEach(async ({ page }) => {
    expect(pageErrors.get(page), 'Unexpected browser errors').toEqual([]);
});

test('core features load with all old extension boxes unchecked and retain settings without extension entries', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const result = await page.evaluate(async () => {
        const { extensionNames } = await import('/scripts/extensions.js');
        const s = SillyTavern.getContext().extensionSettings.SillyTavernMoonlitEchoesTheme;
        return {
            names: extensionNames.filter(name => name.startsWith('chlo-')),
            duplicate: extensionNames.includes('third-party/SillyTavern-MoonlitCourtyardSuit'),
            activePreset: s.activePreset,
            color: getComputedStyle(document.documentElement).getPropertyValue('--customThemeColor').trim(),
            rawCss: getComputedStyle(document.documentElement).getPropertyValue('--qa-preserved-css').trim(),
        };
    });
    expect(result.names).toHaveLength(0);
    expect(result.duplicate).toBe(false);
    expect(result.activePreset).toBe('Courtyard QA');
    expect(result.color).toBe('rgba(174, 149, 149, 1)');
    expect(result.rawCss).toBe('1');
    await expect(page.locator('#quickPersona')).toHaveCount(1);
    await expect(page.locator('#addEmojiButton')).toHaveCount(1);
    await expect(page.locator('#user-settings-block #SillyTavernMoonlitEchoesTheme-drawer')).toHaveCount(1);
    await expect(page.locator('#openai_api-presets #ChatCompletionTabs-enabled')).toHaveCount(1);
    await expect(page.locator('#extensions_settings2 #SillyTavernMoonlitEchoesTheme-drawer')).toHaveCount(0);
    const native = await page.evaluate(async () => {
        const { initChloLirium } = await import('/scripts/chlolirium/index.js');
        await initChloLirium();
        await initChloLirium();
        const settings = SillyTavern.getContext().extensionSettings;
        return {
            obsoleteFlags: settings.disabledExtensions.filter(name => name.startsWith('chlo-')),
            marker: settings.chloliriumBuiltinsMigrated,
            extensionResources: performance.getEntriesByType('resource').map(r => r.name).filter(name => /\/scripts\/extensions\/chlo-/.test(name)),
        };
    });
    expect(native.obsoleteFlags).toEqual([]);
    expect(native.marker).toBeUndefined();
    expect(native.extensionResources).toEqual([]);
    await expect(page.locator('#quickPersona')).toHaveCount(1);
    for (const name of ['SillyTavern-MoonlitEchoesTheme', 'SillyTavern-MoonlitCourtyardSuit', 'SillyTavern-ChatCompletionTabs', 'SillyTavern-IdentitySwitch', 'Extension-EmojiPicker', 'Extension-QuickPersona']) {
        expect(await readFile(path.join(dataRoot, 'default-user/extensions', name, 'index.js'), 'utf8')).toContain('Duplicate standalone copy executed');
    }
    expect(errors).toEqual([]);
});

test('all native interface features work when the entire extension system is disabled', async ({ page }) => {
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const data = await response.json();
        data.enable_extensions = false;
        await route.fulfill({ response, json: data });
    });
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.locator('#rn-left-rail').waitFor();
    await expect(page.locator('#quickPersona')).toHaveCount(1);
    await expect(page.locator('#openai-tab-btn-prompts')).toBeAttached();
    await expect(page.locator('#user-settings-block #SillyTavernMoonlitEchoesTheme-drawer')).toBeAttached();
    await expect(page.locator('#persona-management-button > .stis--identity-toggle')).toHaveCount(1);
    expect(await page.evaluate(async () => (await import('/scripts/extensions.js')).extensionNames)).toEqual([]);
    await page.locator('#quickPersona').click();
    await expect(page.locator('#quickPersonaMenu')).toBeVisible();
    await page.locator('#addEmojiButton').click();
    await expect(page.locator('em-emoji-picker').locator('input[type="search"]')).toBeVisible();
});

test('native settings are accessible, theme popout clears the rail, and extension management has no integrated feature entries', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-rn-key="usersettings"]').click();
    await expect(page.locator('#user-settings-block')).toHaveClass(/openDrawer/);
    await expect(page.locator('#moonlit-theme-buttons-hint')).toBeVisible();
    await page.locator('#moonlit-theme-buttons-hint').click();
    const popout = page.locator('#moonlit_echoes_popout');
    await expect(popout).toBeVisible();
    const rail = await page.locator('#rn-left-rail').boundingBox();
    const box = await popout.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    await expect(popout.locator('#cts-customTopBarColor-text')).toHaveCount(1);
    await popout.locator('.dragClose').click();
    await expect(popout).toHaveCount(0);
    await expect(page.locator('#user-settings-block #cts-customTopBarColor-text')).toHaveCount(1);
    await page.locator('[data-rn-key="extensions"]').click();
    await page.locator('#extensions_details').click();
    await expect(page.locator('.extensions_info')).toBeVisible();
    const names = await page.locator('.extensions_info .extension_block').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.some(name => /Moonlit|Identity Switch|Chat Completion Tabs|Emoji Picker|Quick Persona/.test(name))).toBe(false);
});

test('native portrait preferences update immediately and persist without extension switches', async ({ page }) => {
    await page.evaluate(() => {
        const checkbox = document.getElementById('chlo-persona-portrait');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#persona-management-button > .drawer-toggle')).not.toHaveClass(/stcs--char/);
    await expect.poll(async () => JSON.parse(await readFile(path.join(dataRoot, 'default-user/settings.json'), 'utf8')).extension_settings.identitySwitch.showPersonaAvatar).toBe(false);
    await page.reload();
    await page.locator('#rn-left-rail').waitFor();
    await expect(page.locator('#chlo-persona-portrait')).not.toBeChecked();
    await expect(page.locator('#persona-management-button > .drawer-toggle')).not.toHaveClass(/stcs--char/);
    await page.evaluate(() => {
        const checkbox = document.getElementById('chlo-persona-portrait');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#persona-management-button > .drawer-toggle')).toHaveClass(/stcs--char/);
    await expect.poll(async () => JSON.parse(await readFile(path.join(dataRoot, 'default-user/settings.json'), 'utf8')).extension_settings.identitySwitch.showPersonaAvatar).toBe(true);
});

test('theme color, alpha, layout and checkbox controls still apply and save', async ({ page }) => {
    const result = await page.evaluate(async () => {
        const { themeCustomSettings } = await import('/scripts/chlolirium/moonlit-echoes/src/config/theme-settings.js');
        const ids = themeCustomSettings.filter(s => s.varId).map(s => {
            const prefix = s.type === 'color' ? `cts-${s.varId}-text` : s.type === 'slider' ? `cts-slider-${s.varId}` : s.type === 'checkbox' ? `cts-checkbox-${s.varId}` : `cts-${s.varId}`;
            return { id: s.varId, type: s.type, found: !!document.getElementById(prefix) };
        });
        const color = document.getElementById('cts-customTopBarColor-text');
        color.value = '#403020'; color.dispatchEvent(new Event('change', { bubbles: true }));
        const alpha = document.getElementById('cts-customTopBarColor-alpha');
        alpha.value = '40'; alpha.dispatchEvent(new Event('input', { bubbles: true }));
        const checkbox = document.getElementById('cts-checkbox-hideAvatarBorder');
        checkbox.checked = true; checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        const s = SillyTavern.getContext().extensionSettings.SillyTavernMoonlitEchoesTheme;
        return { ids, color: s.customTopBarColor, railColor: getComputedStyle(document.getElementById('rn-left-rail')).backgroundColor, borderRule: document.getElementById('css-block-hideAvatarBorder')?.textContent };
    });
    expect(result.ids).toHaveLength(59);
    expect(result.ids.filter(control => !control.found)).toEqual([]);
    expect(result.color).toBe('rgba(64, 48, 32, 0.4)');
    expect(result.railColor).toBe('rgba(64, 48, 32, 0.4)');
    expect(result.borderRule).toContain('border: unset');
    await expect.poll(async () => {
        const settings = JSON.parse(await readFile(path.join(dataRoot, 'default-user/settings.json'), 'utf8'));
        return settings.extension_settings.SillyTavernMoonlitEchoesTheme.customTopBarColor;
    }).toBe('rgba(64, 48, 32, 0.4)');
});

test('portrait circles share geometry in Navigator, clean toolbar and scaled layouts', async ({ page }) => {
    for (const scale of [1, 1.25, 1.5]) {
        for (const navigator of [true, false]) {
            const rects = await page.evaluate(({ scale, navigator }) => {
                document.documentElement.style.zoom = String(scale);
                document.body.classList.toggle('rivelle-navigator-enabled', navigator);
                return ['rightNavHolder', 'persona-management-button'].map(id => {
                    const e = document.querySelector(`#${id} > .drawer-toggle`);
                    e.classList.add('stcs--char'); e.style.setProperty('--stcs--avatar', 'url("/img/ai4.png")');
                    const r = e.getBoundingClientRect(), p = getComputedStyle(e, '::after');
                    return { center: r.y + r.height / 2, width: r.width, height: r.height, pseudoWidth: p.width, pseudoHeight: p.height, inset: p.top, transform: p.transform };
                });
            }, { scale, navigator });
            expect(rects[0], `${scale}, Navigator ${navigator}`).toEqual(rects[1]);
            expect(rects[0].height).toBe(rects[0].width);
            expect(rects[0].transform).toBe('none');
            expect(rects[0].inset).toBe('0px');
            expect(rects[0].center).toBeGreaterThan(rects[0].height / 2);
        }
    }
});

test('emoji picker loads on demand, inserts repeatedly at the caret, and stays open during typing', async ({ page }) => {
    expect(await page.locator('em-emoji-picker').count()).toBe(0);
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name));
    expect(resources.some(name => name.includes('vendor/data.json'))).toBe(false);
    const textarea = page.locator('#send_textarea');
    await textarea.evaluate(e => {
        e.value = 'Hello there';
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.focus(); e.setSelectionRange(5, 5);
    });
    await expect(textarea).toHaveValue('Hello there');
    await page.locator('#addEmojiButton').click();
    const picker = page.locator('em-emoji-picker');
    await picker.locator('input[type="search"]').waitFor();
    const emoji = picker.getByRole('button', { name: '😀', exact: true }).first();
    await emoji.click();
    await expect(textarea).toHaveValue('Hello😀 there');
    await expect(page.locator('#chlo-emoji-panel')).toBeVisible();
    await emoji.click();
    await expect(textarea).toHaveValue('Hello😀😀 there');
    await textarea.click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect(textarea).toHaveValue('Hello😀😀 there!');
    await expect(page.locator('#chlo-emoji-panel')).toBeVisible();
    const instance = await picker.elementHandle();
    await page.keyboard.press('Escape');
    await expect(page.locator('#chlo-emoji-panel')).toBeHidden();
    await page.locator('#addEmojiButton').click();
    expect(await picker.evaluate((element, original) => element === original, instance)).toBe(true);
    await page.getByRole('button', { name: 'Close emoji picker', exact: true }).click();
    await expect(page.locator('#chlo-emoji-panel')).toBeHidden();
});

test('emoji styling replaces the former snippet and stays inside a phone viewport', async ({ page }) => {
    await page.addStyleTag({ content: 'em-emoji-picker{position:fixed!important;bottom:3px!important;right:124px!important;transform:none!important;}' });
    await page.locator('#addEmojiButton').click();
    await page.locator('em-emoji-picker').locator('input[type="search"]').waitFor();
    const desktop = await page.locator('#chlo-emoji-panel').evaluate(e => ({ right: getComputedStyle(e).right, bottom: getComputedStyle(e).bottom, radius: getComputedStyle(e).borderRadius }));
    expect(desktop).toEqual({ right: '124px', bottom: '3px', radius: '12px' });
    await page.setViewportSize({ width: 390, height: 844 });
    const box = await page.locator('#chlo-emoji-panel').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(await page.locator('em-emoji-picker').evaluate(e => getComputedStyle(e).position)).toBe('relative');
});

test('chat completion tabs preserve native controls through tab switching and disable/enable', async ({ page }) => {
    await page.locator('[data-rn-key="aiconfig"]').click();
    await page.locator('#openai-tab-btn-prompts').waitFor();
    const original = await page.locator('#completion_prompt_manager').elementHandle();
    await page.locator('#openai-tab-btn-prompts').click();
    await expect(page.locator('#openai-tab-content-prompts')).toHaveClass(/active/);
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(false));
    expect(await page.locator('#completion_prompt_manager').evaluate((e, original) => e === original, original)).toBe(true);
    await expect(page.locator('.openai-tab-buttons')).toHaveCount(0);
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(true));
    await page.locator('#openai-tab-btn-parameters').click();
    await expect(page.locator('#openai-tab-content-parameters')).toHaveClass(/active/);
    await expect(page.locator('#completion_prompt_manager')).toHaveCount(1);
});

test('Quick Persona switches the native persona and updates both portrait controls', async ({ page }) => {
    await page.locator('#quickPersona').click();
    await page.locator('#quickPersonaMenu').waitFor();
    const second = page.locator('#quickPersonaMenu img[src*="qa-second.png"]');
    await second.click();
    await expect.poll(async () => page.evaluate(() => document.querySelector('#persona-management-button > .drawer-toggle').style.getPropertyValue('--stcs--avatar'))).toContain('qa-second.png');
    await expect(page.locator('#quickPersonaImg')).toHaveAttribute('src', /qa-second\.png/);
});

test('native character and persona drawers, Courtyard layouts and character switching remain usable', async ({ page }) => {
    await page.locator('#rightNavHolder > .drawer-toggle').click();
    await expect(page.locator('#right-nav-panel')).toHaveClass(/openDrawer/);
    await page.locator('#rightNavHolder > .drawer-toggle').click();
    await expect(page.locator('#right-nav-panel')).toHaveClass(/closedDrawer/);
    await page.locator('#persona-management-button > .drawer-toggle').click();
    await expect(page.locator('#PersonaManagement')).toHaveClass(/openDrawer/);
    await page.locator('#rpp-current-view-toggle').click();
    await expect(page.locator('#PersonaManagement')).toHaveClass(/rpp-banner-header/);
    await page.locator('#rpp-current-view-toggle').click();
    await expect(page.locator('#PersonaManagement')).not.toHaveClass(/rpp-banner-header/);
    await page.locator('#persona-management-button > .drawer-toggle').click();
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const form = new FormData();
        form.set('ch_name', 'QA Second Character');
        form.set('first_mes', 'Hello from the QA fixture.');
        const response = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders({ omitContentType: true }), body: form });
        if (!response.ok) throw new Error(`Could not create QA character: ${response.status}`);
        await ctx.getCharacters();
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'Seraphina'));
    });
    await page.locator('#rightNavHolder > .drawer-toggle').click({ button: 'right' });
    const choice = page.locator('.stis--ctxItem').filter({ hasText: 'QA Second Character' });
    await choice.click();
    await expect.poll(() => page.evaluate(() => SillyTavern.getContext().name2)).toBe('QA Second Character');
    await expect(page.locator('.stis--ctxMenu')).toHaveCount(0);
});

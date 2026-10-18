import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
let dataRoot, server, url;
let serverLog = '';
const errors = new WeakMap();
test.use({ video: 'off', viewport: { width: 1440, height: 1000 } });

test.beforeAll(async () => {
    test.setTimeout(60000);
    dataRoot = await mkdtemp(path.join(tmpdir(), 'chlo-left-presets-'));
    const user = path.join(dataRoot, 'default-user');
    await mkdir(path.join(user, 'OpenAI Settings'), { recursive: true });
    const settings = JSON.parse(await readFile(path.join(root, 'default/content/settings.json'), 'utf8'));
    settings.main_api = 'openai';
    settings.firstRun = false;
    settings.extension_settings.SillyTavernMoonlitEchoesTheme = { enabled: true, customThemeColor: 'rgba(174, 149, 149, 1)', activePreset: 'QA', presets: { QA: { customThemeColor: 'rgba(174, 149, 149, 1)' } } };
    Object.assign(settings.oai_settings, { chat_completion_source: 'custom', custom_model: 'qa-model', custom_url: 'http://127.0.0.1:9', preset_settings_openai: 'Banana QA', temp_openai: 0.73, top_p_openai: 0.91, openai_max_context: 1000000, max_context_unlocked: true, openai_max_tokens: 11500, stream_openai: false });
    const preset = JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8'));
    preset.prompts.push({ identifier: 'voice-qa', name: 'Narrative voice', role: 'system', content: 'QA narrative voice.', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] });
    preset.prompt_order.find(entry => entry.character_id === 100001).order.unshift({ identifier: 'voice-qa', enabled: true });
    Object.assign(settings.oai_settings, { prompts: structuredClone(preset.prompts), prompt_order: structuredClone(preset.prompt_order) });
    preset.temperature = 0.03;
    preset.openai_max_context = 2048;
    preset.openai_max_tokens = 20;
    preset.stream_openai = true;
    preset.chat_completion_source = 'claude';
    preset.custom_url = 'https://do-not-contact.invalid';
    await writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
    await writeFile(path.join(user, 'OpenAI Settings/Banana QA.json'), JSON.stringify(preset));
    const other = structuredClone(preset);
    other.chlo_preset = { cover: `data:image/png;base64,${(await readFile(path.join(root, 'public/img/logo.png'))).toString('base64')}` };
    other.prompts.find(prompt => prompt.identifier === 'voice-qa').content = 'Sola QA voice.';
    await writeFile(path.join(user, 'OpenAI Settings/Sola QA.json'), JSON.stringify(other));
    const port = 20000 + Math.floor(Math.random() * 10000);
    url = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ['server.js', '--dataRoot', dataRoot, '--port', String(port), '--browserLaunchEnabled', 'false', '--listen', 'false'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', data => serverLog += data);
    server.stderr.on('data', data => serverLog += data);
    for (let i = 0; i < 400; i++) {
        try { if ((await fetch(url)).ok) return; } catch { /* Starting server. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(serverLog.slice(-3000));
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
    errors.set(page, []);
    page.on('pageerror', error => errors.get(page).push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.waitForFunction(async () => (await import('/scripts/events.js')).eventSource.autoFireLastArgs.has('app_ready'));
    await page.evaluate(() => document.querySelectorAll('dialog[open] .popup-button-ok').forEach(button => button.click()));
    await page.locator('[data-rn-key="aiconfig"]').click();
    await expect(page.locator('#left-nav-panel')).toHaveClass(/openDrawer/);
});

test.afterEach(async ({ page }) => {
    expect(errors.get(page), 'Unexpected page errors').toEqual([]);
});

const shared = async page => page.evaluate(async () => {
    const { oai_settings: s } = await import('/scripts/openai.js');
    return { temperature: s.temp_openai, topP: s.top_p_openai, context: s.openai_max_context, reply: s.openai_max_tokens, stream: s.stream_openai, source: s.chat_completion_source, model: s.custom_model, endpoint: s.custom_url };
});

test('preset cards open inside the existing drawer at its native width without a separate workspace', async ({ page }) => {
    await expect(page.locator('#openai-tab-content-presets')).toHaveClass(/active/);
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' })).toBeVisible();
    await expect(page.locator('#chlo-preset-workspace, #chlo-preset-library-button, [data-rn-key="presets"]')).toHaveCount(0);
    const geometry = await page.evaluate(() => {
        const panel = document.getElementById('left-nav-panel');
        const before = panel.getBoundingClientRect().toJSON();
        const chatBefore = document.getElementById('sheld').getBoundingClientRect().toJSON();
        panel.classList.remove('chlo-preset-panel');
        const native = panel.getBoundingClientRect().toJSON();
        const chatNative = document.getElementById('sheld').getBoundingClientRect().toJSON();
        panel.classList.add('chlo-preset-panel');
        return { before, native, chatBefore, chatNative };
    });
    expect(geometry.before).toEqual(geometry.native);
    expect(geometry.chatBefore).toEqual(geometry.chatNative);
    await page.screenshot({ path: path.join(root, '../chlo-native-preset-collection.png') });
});

test('card and dropdown selections use native prompts without replacing shared generation settings', async ({ page }) => {
    const before = await shared(page);
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-open').click();
    await expect(page.locator('#openai-tab-content-prompts')).toHaveClass(/active/);
    expect(await shared(page)).toEqual(before);
    await page.evaluate(async () => {
        const { openai_setting_names, getPresetApplicationPromise } = await import('/scripts/openai.js');
        $('#settings_preset_openai').val(openai_setting_names['Banana QA']).trigger('change');
        await getPresetApplicationPromise();
    });
    expect(await shared(page)).toEqual(before);
});

test('parameters reuse the same native input and preserve its event handler through page changes', async ({ page }) => {
    const input = await page.locator('#temp_openai').elementHandle();
    await page.locator('#openai-tab-btn-parameters').click();
    await page.locator('#temp_counter_openai').fill('0.82');
    await page.locator('#temp_counter_openai').press('Tab');
    expect((await shared(page)).temperature).toBe(0.82);
    await page.locator('#openai-tab-btn-presets').click();
    await page.locator('#openai-tab-btn-parameters').click();
    expect(await page.locator('#temp_openai').evaluate((node, original) => node === original, input)).toBe(true);
    await expect(page.locator('#temp_counter_openai')).toHaveValue('0.82');
    await page.screenshot({ path: path.join(root, '../chlo-native-preset-parameters.png') });
});

test('native prompt edit form stays within the drawer and saves roles, content and depth normally', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-open').click();
    const block = page.locator('[data-pm-identifier="voice-qa"]');
    await block.locator('.prompt-manager-edit-action').click();
    const popup = page.locator('#left-nav-panel #completion_prompt_manager_popup');
    await expect(popup).toBeVisible();
    await expect(page.locator('#completion_prompt_manager')).toBeHidden();
    const panel = await page.locator('#left-nav-panel').boundingBox();
    const editor = await popup.boundingBox();
    expect(editor.x).toBeGreaterThanOrEqual(panel.x);
    expect(editor.x + editor.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Native editor instructions.');
    await page.screenshot({ path: path.join(root, '../chlo-native-preset-editor.png') });
    await page.locator('.chlo-inline-prompt-options > summary').click();
    await page.locator('#completion_prompt_manager_popup_entry_form_role').selectOption('assistant');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_position').selectOption('1');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_depth').fill('7');
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await expect(popup).toBeHidden();
    const prompt = await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.prompts.find(prompt => prompt.identifier === 'voice-qa'));
    expect(prompt).toMatchObject({ role: 'assistant', content: 'Native editor instructions.', injection_position: 1, injection_depth: 7 });
    const response = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await response;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Sola QA.json'), 'utf8'));
    expect(stored.prompts.find(prompt => prompt.identifier === 'voice-qa')).toMatchObject({ content: 'Native editor instructions.' });
    expect(stored).not.toHaveProperty('temperature');
});

test('disabling the existing tab layout restores the original native editor and controls', async ({ page }) => {
    const input = await page.locator('#temp_openai').elementHandle();
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(false));
    await expect(page.locator('.openai-tab-buttons')).toHaveCount(0);
    await expect(page.locator('#chlo-preset-collection')).toBeHidden();
    await expect(page.locator('#left-nav-panel #completion_prompt_manager_popup')).toHaveCount(0);
    await expect(page.locator('#completion_prompt_manager_popup')).toHaveCount(1);
    expect(await page.locator('#temp_openai').evaluate((node, original) => node === original, input)).toBe(true);
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(true));
    await expect(page.locator('#left-nav-panel #completion_prompt_manager_popup')).toHaveCount(1);
});

test('collection, parameters and native prompt form fit a 390px phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ['presets', 'parameters', 'prompts']) {
        await page.locator(`#openai-tab-btn-${view}`).click();
        await expect(page.locator(`#openai-tab-content-${view}`)).toHaveClass(/active/);
        const overflow = await page.locator('#left-nav-panel').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth, right: node.getBoundingClientRect().right }));
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
        expect(overflow.right).toBeLessThanOrEqual(391);
    }
    await expect(page.locator('#completion_prompt_manager_list .completion_prompt_manager_prompt').first()).toBeVisible();
    await page.locator('[data-pm-identifier="voice-qa"] .prompt-manager-edit-action').click();
    await expect(page.locator('#left-nav-panel #completion_prompt_manager_popup')).toBeVisible();
    const editor = await page.locator('#completion_prompt_manager_popup').boundingBox();
    expect(editor.x + editor.width).toBeLessThanOrEqual(391);
    await page.screenshot({ path: path.join(root, '../chlo-native-preset-phone.png') });
});

test('native import and export remain available and the collection follows the native preset options', async ({ page }) => {
    const preset = JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8'));
    const before = await shared(page);
    await page.locator('#openai_preset_import_file').setInputFiles({ name: 'Native import QA.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ prompts: preset.prompts, prompt_order: preset.prompt_order, temperature: 0.01 })) });
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'Native import QA' });
    await expect(card.locator('.chlo-preset-open')).toHaveAttribute('aria-pressed', 'true');
    expect(await shared(page)).toEqual(before);
    await page.locator('#export_oai_preset').click();
    await expect(page.locator('dialog[open]')).toContainText('export connection data');
    const downloaded = page.waitForEvent('download');
    await page.locator('dialog[open] .popup-button-ok').click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('Native import QA.json');
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
    expect(exported.prompts).toEqual(preset.prompts);
});

test('the duplicate toolbar is replaced by native actions in their respective pages', async ({ page }) => {
    await expect(page.locator('#chlo-native-preset-toolbar')).toBeHidden();
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-use').click();
    await expect(page.locator('#openai-tab-content-presets')).toHaveClass(/active/);
    await expect(page.locator('#chlo-preset-current')).toHaveText('Active: Sola QA');
    for (const id of ['import_oai_preset', 'export_oai_preset', 'delete_oai_preset']) {
        await expect(page.locator(`#chlo-preset-library-actions #${id}`)).toBeVisible();
        await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    await page.locator('#openai-tab-btn-prompts').click();
    for (const selector of ['#update_oai_preset', '[data-preset-manager-rename="openai"]', '#new_oai_preset']) await expect(page.locator(`#chlo-preset-editor-actions ${selector}`)).toBeVisible();
    await page.locator('#openai-tab-btn-parameters').click();
    await page.locator('#chlo-preset-layout-setting summary').click();
    await page.locator('#ChatCompletionTabs-enabled').uncheck();
    await expect(page.locator('#chlo-native-preset-toolbar')).toBeVisible();
    await expect(page.locator('#chlo-native-preset-toolbar #update_oai_preset')).toBeVisible();
    await page.locator('#ChatCompletionTabs-enabled').check();
    await expect(page.locator('#chlo-native-preset-toolbar')).toBeHidden();
});

test('both examples are seeded and show real grouped native blocks without replacing shared parameters', async ({ page }) => {
    const before = await shared(page);
    for (const type of ['Legacy', 'Loom']) {
        const card = page.locator('.chlo-preset-card').filter({ hasText: `Chlo - ${type} example` });
        await expect(card).toBeVisible();
        await card.locator('.chlo-preset-open').click();
        await expect(page.locator('#chlo-preset-editor-title')).toHaveText(`Chlo - ${type} example`);
        await expect(page.locator('.chlo-prompt-section').filter({ hasText: 'Core instructions' }).first()).toBeVisible();
        await expect(page.locator('.chlo-prompt-section').filter({ hasText: 'Conversation' })).toBeVisible();
        await expect(page.locator('.chlo-prompt-section').filter({ hasText: 'Character & persona' }).first()).toBeVisible();
        await expect.poll(() => page.evaluate(async () => {
            const { oai_settings: s } = await import('/scripts/openai.js');
            const stored = s.prompt_order.find(entry => entry.character_id === 100001).order.map(entry => entry.identifier);
            const rendered = [...document.querySelectorAll('#completion_prompt_manager_list [data-pm-identifier]')].map(row => row.dataset.pmIdentifier);
            return JSON.stringify(stored) === JSON.stringify(rendered);
        })).toBe(true);
        expect(await shared(page)).toEqual(before);
        await page.screenshot({ path: path.join(root, `../chlo-grouped-${type.toLowerCase()}.png`) });
        await page.locator('#openai-tab-btn-presets').click();
    }
});

test('group headings stay out of native drag order and native toggles and saves persist', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Chlo - Loom example' }).locator('.chlo-preset-open').click();
    const row = page.locator('[data-pm-identifier="pacing"]');
    await expect(row).toHaveClass(/prompt_disabled/);
    await row.locator('.prompt-manager-toggle-action').click();
    await expect(row).not.toHaveClass(/prompt_disabled/);
    const start = await row.locator('.drag-handle').boundingBox();
    const end = await page.locator('[data-pm-identifier="voice"]').boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    // Native jQuery sortable enforces a configured drag delay.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(150);
    await page.mouse.move(end.x + 20, end.y + 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.locator('#completion_prompt_manager_list [data-pm-identifier]').first()).toHaveAttribute('data-pm-identifier', 'pacing');
    const response = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await response;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Chlo - Loom example.json'), 'utf8'));
    expect(stored.prompt_order[0].order[0]).toEqual({ identifier: 'pacing', enabled: true });
    expect(stored.prompt_order[0].order.every(entry => typeof entry?.identifier === 'string')).toBe(true);
    expect(stored.prompts.find(prompt => prompt.identifier === 'pacing').chlo_category).toBe('Core instructions');
});

test('Loom import uses the same Import control and rejects unsupported macros before saving', async ({ page }) => {
    const before = await shared(page);
    const loom = JSON.parse(await readFile(path.join(root, 'tests/fixtures/chlolirium/loom-example.loom'), 'utf8'));
    await page.locator('#openai_preset_import_file').setInputFiles({ name: 'Loom import QA.loom', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(loom)) });
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'Loom import QA' });
    await expect(card.locator('.chlo-preset-open')).toHaveAttribute('aria-pressed', 'true');
    expect(await shared(page)).toEqual(before);
    await card.locator('.chlo-preset-open').click();
    await expect(page.locator('.chlo-prompt-section').filter({ hasText: 'Reply guidance' })).toBeVisible();
    const selected = await page.locator('#chlo-preset-editor-title').textContent();
    loom.blocks[1].content = '{{loom::unsupported}}';
    await page.locator('#openai_preset_import_file').setInputFiles({ name: 'Unsupported QA.loom', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(loom)) });
    await expect(page.locator('.toast-error')).toContainText('Nothing was imported');
    await expect(page.locator('#chlo-preset-editor-title')).toHaveText(selected);
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Unsupported QA' })).toHaveCount(0);
    await expect(readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Unsupported QA.json'))).rejects.toThrow();
});

test('cover upload saves an inactive preset without switching it and survives rename, save-as and export', async ({ page }) => {
    const before = await shared(page);
    const active = await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.preset_settings_openai);
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' });
    await card.locator('.chlo-preset-cover').click();
    const data = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 80; canvas.height = 100;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ae9595'; ctx.fillRect(0, 0, 80, 100);
        ctx.fillStyle = '#403938'; ctx.fillRect(12, 12, 56, 76);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('Choose preset image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
    await expect(page.locator('.chlo-preset-cover-dialog [role="status"]')).toHaveText('');
    const response = page.waitForResponse('**/api/presets/save');
    await page.locator('dialog[open] .popup-button-ok').click();
    await response;
    await expect(card.locator('img')).toBeVisible();
    const cover = await card.locator('img').getAttribute('src');
    expect(cover).toMatch(/^data:image\/jpeg;base64,/);
    expect(await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.preset_settings_openai)).toBe(active);
    expect(await shared(page)).toEqual(before);
    await card.locator('.chlo-preset-open').click();
    await page.locator('#new_oai_preset').click();
    await page.locator('dialog[open] textarea').fill('Cover copy QA');
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('#chlo-preset-editor-title')).toHaveText('Cover copy QA');
    await page.locator('[data-preset-manager-rename="openai"]').click();
    await page.locator('dialog[open] textarea').fill('Cover renamed QA');
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('#chlo-preset-editor-title')).toHaveText('Cover renamed QA');
    await expect.poll(async () => JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Cover renamed QA.json'), 'utf8')).chlo_preset.cover).toBe(cover);
    await page.locator('#openai-tab-btn-presets').click();
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Cover renamed QA' }).locator('img')).toHaveAttribute('src', cover);
    await page.locator('#export_oai_preset').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('dialog[open] .popup-button-ok').click();
    const file = await downloaded;
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
    expect(exported.chlo_preset.cover).toBe(cover);
    await page.screenshot({ path: path.join(root, '../chlo-preset-cover.png') });
    await page.locator('#delete_oai_preset').click();
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Cover renamed QA' })).toHaveCount(0);
});

test('a saved image loads on reload, and removing it restores the book tile', async ({ page }) => {
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' });
    await expect(card.locator('img')).toBeVisible();
    await card.locator('.chlo-preset-cover').click();
    await page.getByRole('button', { name: 'Remove image', exact: true }).click();
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(card.locator('img')).toHaveCount(0);
    await expect(card.locator('.fa-book-open')).toBeVisible();
    await expect.poll(async () => JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Sola QA.json'), 'utf8')).chlo_preset.cover).toBe('');
});

test('invalid image input cannot save, and cancelling leaves the preset file intact', async ({ page }) => {
    const file = path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json');
    const before = await readFile(file, 'utf8');
    await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-cover').click();
    await page.getByLabel('Choose preset image').setInputFiles({ name: 'invalid.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') });
    await expect(page.locator('.chlo-preset-cover-dialog [role="status"]')).toContainText('Choose a PNG');
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('dialog[open]')).toBeVisible();
    await page.locator('dialog[open] .popup-button-cancel').click();
    expect(await readFile(file, 'utf8')).toBe(before);
});

test('stateful Loom import generates through native controls with either macro engine and keeps preset regex scoped', async ({ page }) => {
    const before = await shared(page);
    await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const form = new FormData();
        form.set('ch_name', 'Loom QA Actor');
        form.set('first_mes', 'A quiet afternoon.');
        const response = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders({ omitContentType: true }), body: form });
        if (!response.ok) throw new Error('Could not create Loom QA character');
        await ctx.getCharacters();
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'Loom QA Actor'));
    });
    await page.locator('#openai_preset_import_file').setInputFiles(path.join(root, 'tests/fixtures/chlolirium/loom-stateful.loom'));
    await expect(page.locator('dialog[open]')).toContainText('regex');
    await page.locator('dialog[open] .popup-button-ok').click();
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'loom-stateful' });
    await expect(card.locator('.chlo-preset-open')).toHaveAttribute('aria-pressed', 'true');
    await card.locator('.chlo-preset-open').click();
    await expect(page.locator('[data-pm-identifier="state"]')).toBeVisible();
    expect(await shared(page)).toEqual(before);
    const requests = [];
    await page.route('**/api/backends/chat-completions/generate', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: '((OOC hello)) <panel>Weather</panel>' }, finish_reason: 'stop' }] } });
    });
    for (const [engine, mind, widget, toggles, count] of [
        [false, 'Calm', true, [], 1],
        [true, 'Alternate', false, ['widget', 'calm', 'riot'], 2],
    ]) {
        for (const id of toggles) await page.locator(`[data-pm-identifier="${id}"] .prompt-manager-toggle-action`).click();
        await page.evaluate(async engine => {
            (await import('/scripts/power-user.js')).power_user.experimental_macro_engine = engine;
            const script = await import('/script.js');
            script.setOnlineStatus('Connected');
            document.getElementById('send_textarea').value = 'Continue the afternoon.';
            await script.Generate('normal');
        }, engine);
        expect(requests).toHaveLength(count);
        const messages = requests.at(-1).messages;
        const text = messages.map(message => message.content).join('\n');
        expect(messages.every(message => message.content.trim().length > 0)).toBe(true);
        expect(text).toContain(`Voice: ${mind}.`);
        expect(text.includes('Weather: clear.')).toBe(widget);
        expect(text).not.toContain('{{');
        const post = messages.filter(message => /POST_(SYSTEM|USER)_/.test(message.content));
        expect(post.map(message => message.role)).toEqual(['system', 'user', 'system']);
        expect(post.map(message => message.content)).toEqual(['POST_SYSTEM_A', 'POST_USER_B', 'POST_SYSTEM_C']);
        const regex = await page.evaluate(async () => {
            const { getRegexedString, regex_placement, getScriptsByType, SCRIPT_TYPES } = await import('/scripts/extensions/regex/engine.js');
            const source = '((OOC hi)) <panel>Weather</panel>';
            return {
                count: getScriptsByType(SCRIPT_TYPES.PRESET).length,
                display: getRegexedString(source, regex_placement.AI_OUTPUT, { isMarkdown: true, depth: 0 }),
                recent: getRegexedString(source, regex_placement.AI_OUTPUT, { isPrompt: true, depth: 0 }),
                old: getRegexedString(source, regex_placement.AI_OUTPUT, { isPrompt: true, depth: 2 }),
                state: SillyTavern.getContext().chatMetadata.chlo_loom_variables,
            };
        });
        expect(regex.count).toBe(2);
        expect(regex.display).toContain(`mind="${mind}"`);
        expect(regex.recent).toContain('<panel>');
        expect(regex.old).not.toContain('<panel>');
        expect(regex.state).toEqual({ mind });
    }
    // Exercise the native regex editor's existing handler, even with its drawer closed.
    await page.evaluate(() => document.querySelector('#saved_preset_scripts .edit_existing_regex').click());
    const regexEditor = page.locator('dialog[open]');
    await expect(regexEditor.locator('.regex_script_name')).toBeVisible();
    await expect(regexEditor.locator('select[name="substitute_regex"] option[value="1"]')).toHaveJSProperty('disabled', true);
    await regexEditor.locator('.regex_script_name').fill('Edited Loom note');
    await regexEditor.locator('#regex_test_mode_toggle').click();
    await regexEditor.locator('#regex_test_input').fill('((OOC hello');
    await expect(regexEditor.locator('#regex_test_output')).toContainText('mind="Alternate"');
    const regexSaved = page.waitForResponse('**/api/presets/save');
    await regexEditor.locator('.popup-button-ok').click();
    await regexSaved;
    await page.locator('#update_oai_preset').click();
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/loom-stateful.json'), 'utf8'));
    expect(stored.chlo_preset.loom_compat).toBe(1);
    expect(stored.extensions.regex_scripts).toHaveLength(2);
    expect(stored.extensions.regex_scripts[0]).toMatchObject({ scriptName: 'Edited Loom note', chlo_loom: { version: 1, mode: 'escaped' } });
    expect(await shared(page)).toEqual(before);
    await page.evaluate(async () => (await import('/script.js')).saveMetadata());
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.waitForFunction(async () => (await import('/scripts/events.js')).eventSource.autoFireLastArgs.has('app_ready'));
    await page.evaluate(async () => {
        document.querySelectorAll('dialog[open] .popup-button-ok').forEach(button => button.click());
        const ctx = SillyTavern.getContext();
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'Loom QA Actor'));
    });
    expect(await page.evaluate(() => SillyTavern.getContext().chatMetadata.chlo_loom_variables)).toEqual({ mind: 'Alternate' });
    await page.locator('[data-rn-key="aiconfig"]').click();
    await page.locator('#openai-tab-btn-presets').click();
    await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-use').click();
    const ordinary = await page.evaluate(async () => {
        const { getScriptsByType, SCRIPT_TYPES, getRegexedString, regex_placement } = await import('/scripts/extensions/regex/engine.js');
        return { count: getScriptsByType(SCRIPT_TYPES.PRESET).length, text: getRegexedString('((OOC hi))', regex_placement.AI_OUTPUT, { isMarkdown: true }) };
    });
    expect(ordinary).toEqual({ count: 0, text: '((OOC hi))' });
});

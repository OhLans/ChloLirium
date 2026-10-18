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
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).click();
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
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).click();
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
    await expect(card).toHaveAttribute('aria-pressed', 'true');
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

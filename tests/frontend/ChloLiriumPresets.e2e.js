import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickPromptPreset } from '../../public/scripts/chlolirium/presets/model.js';

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
    const preset = pickPromptPreset(JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8')));
    preset.prompts.push({ identifier: 'voice-qa', name: 'Narrative voice', role: 'system', content: 'QA narrative voice.', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] });
    preset.prompt_order.find(entry => entry.character_id === 100001).order.unshift({ identifier: 'voice-qa', enabled: true });
    Object.assign(settings.oai_settings, { prompts: structuredClone(preset.prompts), prompt_order: structuredClone(preset.prompt_order) });
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

const openPromptTools = async page => {
    const button = page.getByRole('button', { name: 'Prompt tools', exact: true });
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
};

const openPresetTools = async page => {
    const button = page.getByRole('button', { name: 'Preset tools', exact: true });
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
};

const dragHandle = async (page, handle, point) => {
    const start = await handle.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    // jQuery UI deliberately waits before initiating a drag.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(150);
    await page.mouse.move(point.x, point.y, { steps: 18 });
    await page.mouse.up();
};

test('configuration keeps the native drawer width and a single vertical library', async ({ page }) => {
    await expect(page.locator('#openai-tab-content-presets')).toHaveClass(/active/);
    const drawer = page.locator('#left-nav-panel');
    for (const width of [1440, 1920]) {
        await page.setViewportSize({ width, height: 1080 });
        const geometry = await drawer.evaluate(node => {
            const styled = node.getBoundingClientRect().toJSON();
            node.classList.remove('chlo-preset-panel');
            const native = node.getBoundingClientRect().toJSON();
            node.classList.add('chlo-preset-panel');
            return { styled, native };
        });
        expect(geometry.styled.x).toBe(geometry.native.x);
        expect(geometry.styled.y).toBe(geometry.native.y);
        expect(geometry.styled.width).toBe(geometry.native.width);
        expect(geometry.styled.width).toBeLessThan(width / 2);
        await expect(page.locator('#sheld')).toBeVisible();
        const rows = await page.locator('.chlo-preset-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().toJSON()));
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].x).toBe(rows[0].x);
            expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].bottom);
        }
    }
    const before = await shared(page);
    const sola = page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' });
    const title = sola.locator('.chlo-preset-open');
    await title.click();
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    await expect(sola.locator('#chlo-preset-preview h3')).toHaveText('Sola QA');
    expect(await shared(page)).toEqual(before);
    await title.click();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await expect(sola.locator('#chlo-preset-preview')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search presets' }).fill('Sola');
    await expect(page.locator('.chlo-preset-card:visible')).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search presets' }).clear();
    await expect(drawer.locator('.chlo-column-divider')).toHaveCount(0);
    await page.screenshot({ path: path.join(root, '../chlo-native-preset-collection.png') });
    await page.getByRole('button', { name: 'Close configuration' }).click();
    await expect(drawer).not.toHaveClass(/openDrawer/);
    await expect(page.locator('#sheld')).toBeVisible();
    await page.locator('[data-rn-key="aiconfig"]').click();
    await expect(page.locator('#openai-tab-content-presets')).toHaveClass(/active/);
});

test('all tabs share a compact header with their main content immediately below', async ({ page }) => {
    const panel = page.locator('#left-nav-panel');
    const header = panel.locator('#chlo-config-header');
    const libraryTools = panel.locator('#chlo-preset-library-tools');
    for (const width of [1920, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const sizes = [];
        for (const [tab, content] of [
            ['presets', '.chlo-preset-card'],
            ['parameters', '#openai_max_context'],
            ['prompts', '#completion_prompt_manager_list [data-pm-identifier]'],
        ]) {
            await page.locator(`#openai-tab-btn-${tab}`).click();
            await expect(panel).toHaveAttribute('data-preset-view', tab);
            await expect(header.locator('.openai-tab-button.active')).toHaveAttribute('id', `openai-tab-btn-${tab}`);
            const size = await header.boundingBox();
            sizes.push(size.height);
            const contentBox = await panel.locator(content).first().boundingBox();
            expect(contentBox.y - (size.y + size.height)).toBeLessThan(135);
            expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(size.x + size.width + 1);
            expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        }
        expect(sizes).toEqual([sizes[0], sizes[0], sizes[0]]);
        await page.locator('#openai-tab-btn-presets').click();
        const buttons = await panel.locator('.chlo-preset-card.selected .chlo-preset-card-buttons button')
            .evaluateAll(items => items.map(item => ({ label: item.textContent.trim(), y: item.getBoundingClientRect().y })));
        expect(buttons.map(item => item.label)).toEqual(['Use', 'Edit', 'Delete']);
        expect(new Set(buttons.map(item => item.y)).size).toBe(1);
    }
    await expect(libraryTools).toBeHidden();
    const button = page.getByRole('button', { name: 'Preset tools', exact: true });
    await button.press('Enter');
    await expect(libraryTools).toBeVisible();
    await button.press('Escape');
    await expect(libraryTools).toBeHidden();
    await expect(button).toBeFocused();
});

test('prompt-only card and dropdown selections keep unspecified parameters and the active connection', async ({ page }) => {
    const before = await shared(page);
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-edit').click();
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
    const firstFields = await page.locator('#range_block_openai > .range-block:visible').evaluateAll(rows => rows.slice(0, 5).map(row => row.querySelector('input')?.id));
    expect(firstFields).toEqual(['openai_max_context', 'openai_max_tokens', 'stream_toggle', 'temp_openai', 'top_p_openai']);
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
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-edit').click();
    const block = page.locator('[data-pm-identifier="voice-qa"]');
    await block.locator('.prompt-manager-edit-action').click();
    const popup = page.locator('#left-nav-panel #completion_prompt_manager_popup');
    await expect(popup).toBeVisible();
    await expect(page.locator('#completion_prompt_manager')).toBeHidden();
    await expect(page.locator('#chlo-preset-editor-header')).toBeHidden();
    const panel = await page.locator('#left-nav-panel').boundingBox();
    const editor = await popup.boundingBox();
    expect(editor.x).toBeGreaterThanOrEqual(panel.x);
    expect(editor.x + editor.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    const field = await page.locator('#completion_prompt_manager_popup_entry_form_prompt').boundingBox();
    expect(field.width).toBeGreaterThanOrEqual(Math.min(700, editor.width - 80));
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Native editor instructions.');
    await page.screenshot({ path: path.join(root, '../chlo-native-preset-editor.png') });
    await page.locator('.chlo-inline-prompt-options > summary').click();
    await page.locator('#completion_prompt_manager_popup_entry_form_role').selectOption('assistant');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_position').selectOption('1');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_depth').fill('7');
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await expect(popup).toBeVisible();
    const prompt = await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.prompts.find(prompt => prompt.identifier === 'voice-qa'));
    expect(prompt).toMatchObject({ role: 'assistant', content: 'Native editor instructions.', injection_position: 1, injection_depth: 7 });
    await page.locator('#completion_prompt_manager_popup_entry_form_close').click();
    await openPromptTools(page);
    const response = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await response;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Sola QA.json'), 'utf8'));
    expect(stored.prompts.find(prompt => prompt.identifier === 'voice-qa')).toMatchObject({ content: 'Native editor instructions.' });
    expect(stored.temperature).toBe((await shared(page)).temperature);
});

test('disabling the existing tab layout restores the original native editor and controls', async ({ page }) => {
    const input = await page.locator('#temp_openai').elementHandle();
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(false));
    await expect(page.locator('.openai-tab-buttons')).toHaveCount(0);
    await expect(page.locator('#chlo-preset-collection')).toBeHidden();
    await expect(page.locator('#left-nav-panel #completion_prompt_manager_popup')).toHaveCount(0);
    await expect(page.locator('#completion_prompt_manager_popup')).toHaveCount(1);
    await expect(page.locator('#completion_prompt_manager_list')).toHaveAttribute('data-editor-view', 'order');
    expect(await page.locator('#completion_prompt_manager_list').evaluate(node => $(node).sortable('option', 'disabled'))).toBe(false);
    expect(await page.locator('#temp_openai').evaluate((node, original) => node === original, input)).toBe(true);
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(true));
    await expect(page.locator('#left-nav-panel #completion_prompt_manager_popup')).toHaveCount(1);
    await expect(page.locator('#completion_prompt_manager_list')).toHaveAttribute('data-editor-view', 'grouped');
});

for (const width of [1440, 390]) {
    test(`prompt Save and Close retain middle/end list positions at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-edit').click();
        await page.evaluate(async () => {
            const { promptManager, oai_settings } = await import('/scripts/openai.js');
            const extra = Array.from({ length: 120 }, (_, i) => ({ identifier: `scroll-qa-${i}`, name: `Scroll block ${i + 1}`, content: `Neutral instructions for block ${i + 1}.`, role: 'system', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] }));
            oai_settings.prompts = oai_settings.prompts.filter(prompt => !prompt.identifier.startsWith('scroll-qa-')).concat(extra);
            const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
            order.splice(0, order.length, ...order.filter(entry => !entry.identifier.startsWith('scroll-qa-')), ...extra.map(prompt => ({ identifier: prompt.identifier, enabled: true })));
            promptManager.render(false);
        });
        await expect(page.locator('[data-pm-identifier="scroll-qa-119"]')).toHaveCount(1);
        const position = () => page.locator('#left-nav-panel > .scrollableInner').evaluate(node => node.scrollTop);
        const popup = page.locator('#completion_prompt_manager_popup');
        for (const index of [55, 119]) {
            const row = page.locator(`[data-pm-identifier="scroll-qa-${index}"]`);
            // Pointer actions retry if a pending native token refresh replaces the row.
            await row.hover();
            const before = await position();
            const metrics = await page.locator('#completion_prompt_manager').evaluate(node => ({ classes: node.className, height: node.clientHeight, content: node.scrollHeight, overflow: getComputedStyle(node).overflowY, pageHeight: getComputedStyle(node.closest('.openai-tab-content')).height }));
            expect(before, JSON.stringify(metrics)).toBeGreaterThan(1000);
            await row.locator('.prompt-manager-edit-action').click();
            await expect(popup).toBeVisible();
            await expect.poll(position).toBe(0);
            await page.locator('#completion_prompt_manager_popup_entry_form_name').fill(`Scroll block ${index + 1} saved`);
            await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill(`Edited block ${index + 1}.`);
            await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
            await expect(popup).toBeVisible();
            await page.locator('#completion_prompt_manager_popup_entry_form_close').click();
            await expect(popup).toBeHidden();
            await expect(row.locator('.completion_prompt_manager_prompt_name')).toContainText('saved');
            await expect.poll(position).toBeCloseTo(before, 0);
            expect(await page.evaluate(async id => (await import('/scripts/openai.js')).promptManager.getPromptById(id).content, `scroll-qa-${index}`)).toBe(`Edited block ${index + 1}.`);
            const savedPosition = await position();
            await row.locator('.prompt-manager-edit-action').click();
            await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Discard this unsaved edit.');
            await page.locator('#completion_prompt_manager_popup_entry_form_close').click();
            await page.locator('dialog[open] .popup-button-ok').click();
            await expect(popup).toBeHidden();
            await expect.poll(position).toBeCloseTo(savedPosition, 0);
            expect(await page.evaluate(async id => (await import('/scripts/openai.js')).promptManager.getPromptById(id).content, `scroll-qa-${index}`)).toBe(`Edited block ${index + 1}.`);
        }
    });
}

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

test('prompt cards start immediately after the compact toolbar on desktop and phone', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-edit').click();
    const title = page.locator('#chlo-preset-editor-title');
    await title.evaluate(node => node.textContent = 'A long preset title that should fit on a single line without pushing the toolbar or the prompt cards down');
    const tools = page.getByRole('button', { name: 'Prompt tools', exact: true });
    const toolsPanel = page.locator('#chlo-prompt-tools-panel');
    for (const [width, view] of [[1440, 'grouped'], [390, 'order'], [320, 'grouped']]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(toolsPanel).toBeHidden();
        await openPromptTools(page);
        await page.locator(`[data-pm-view="${view}"]`).click();
        const list = page.locator('#completion_prompt_manager_list');
        await expect(list).toHaveAttribute('data-editor-view', view);
        await expect(toolsPanel).toBeHidden();
        const drawer = await page.locator('#left-nav-panel').boundingBox();
        const toolbar = await page.locator('#chlo-preset-editor-header .chlo-block-navigation').boundingBox();
        const row = await list.locator('[data-pm-identifier]').first().boundingBox();
        const name = await title.boundingBox();
        const gap = row.y - (toolbar.y + toolbar.height);
        expect(name.height).toBeLessThan(26);
        expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(drawer.x + drawer.width);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThan(50);
        expect(row.y - drawer.y).toBeLessThan(215);
        expect(toolbar.x).toBeCloseTo(row.x, 0);
        expect(toolbar.width).toBeCloseTo(row.width, 0);
    }
    await tools.focus();
    await tools.press('Enter');
    await expect(toolsPanel).toBeVisible();
    await tools.press('Tab');
    await page.keyboard.press('Escape');
    await expect(toolsPanel).toBeHidden();
    await expect(tools).toBeFocused();
});

test('native import and export remain available and the collection follows the native preset options', async ({ page }) => {
    const preset = JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8'));
    const before = await shared(page);
    const parameters = { temperature: 0.85, frequency_penalty: 0.2, presence_penalty: 0, top_p: 0.95, top_k: 64, openai_max_context: 64000, openai_max_tokens: 16384, stream_openai: true, function_calling: false };
    await page.locator('#openai_preset_import_file').setInputFiles({ name: 'Native import QA.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ prompts: preset.prompts, prompt_order: preset.prompt_order, ...parameters })) });
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'Native import QA' });
    await expect(card.locator('.chlo-preset-use')).toHaveAttribute('aria-pressed', 'true');
    const applied = { ...before, temperature: 0.85, topP: 0.95, context: 64000, reply: 16384, stream: true };
    expect(await shared(page)).toEqual(applied);
    await page.locator('#openai-tab-btn-parameters').click();
    await expect(page.locator('#temp_counter_openai')).toHaveValue('0.85');
    await expect(page.locator('#top_p_openai')).toHaveValue('0.95');
    await expect(page.locator('#top_k_openai')).toHaveValue('64');
    await expect(page.locator('#freq_pen_openai')).toHaveValue('0.2');
    await expect(page.locator('#pres_pen_openai')).toHaveValue('0');
    await expect(page.locator('#stream_toggle')).toBeChecked();
    await expect(page.locator('#openai_function_calling')).not.toBeChecked();
    await page.locator('#temp_counter_openai').fill('0.72');
    await page.locator('#temp_counter_openai').press('Tab');
    await page.locator('#openai-tab-btn-prompts').click();
    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Native import QA.json'), 'utf8'));
    expect(stored).toMatchObject({ ...parameters, temperature: 0.72 });
    for (const key of ['custom_url', 'custom_model', 'chat_completion_source']) expect(stored).not.toHaveProperty(key);
    await page.locator('#openai-tab-btn-parameters').click();
    await page.locator('#temp_counter_openai').fill('1');
    await page.locator('#temp_counter_openai').press('Tab');
    await page.locator('#openai-tab-btn-presets').click();
    await card.locator('.chlo-preset-use').click();
    await expect.poll(async () => (await shared(page)).temperature).toBe(0.72);
    // Both the native selector and the collection must apply saved parameters.
    await page.evaluate(async () => {
        const { openai_setting_names, getPresetApplicationPromise } = await import('/scripts/openai.js');
        $('#settings_preset_openai').val(openai_setting_names['Banana QA']).trigger('change');
        await getPresetApplicationPromise();
    });
    await page.locator('#openai-tab-btn-parameters').click();
    await page.locator('#temp_counter_openai').fill('1');
    await page.locator('#temp_counter_openai').press('Tab');
    await page.evaluate(async () => {
        const { openai_setting_names, getPresetApplicationPromise } = await import('/scripts/openai.js');
        $('#settings_preset_openai').val(openai_setting_names['Native import QA']).trigger('change');
        await getPresetApplicationPromise();
    });
    expect(await shared(page)).toEqual({ ...applied, temperature: 0.72 });
    await page.locator('#openai-tab-btn-presets').click();
    await openPresetTools(page);
    await page.locator('#export_oai_preset').click();
    await expect(page.locator('dialog[open]')).toContainText('export connection data');
    const downloaded = page.waitForEvent('download');
    await page.locator('dialog[open] .popup-button-ok').click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('Native import QA.json');
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
    expect(exported.prompts).toEqual(preset.prompts);
    expect(exported).toMatchObject({ ...parameters, temperature: 0.72 });
});

test('the duplicate toolbar is replaced by native actions in their respective pages', async ({ page }) => {
    await expect(page.locator('#chlo-native-preset-toolbar')).toBeHidden();
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-use').click();
    await expect(page.locator('#openai-tab-content-presets')).toHaveClass(/active/);
    await openPresetTools(page);
    await expect(page.locator('#chlo-preset-current')).toHaveText('Active: Sola QA');
    for (const id of ['import_oai_preset', 'export_oai_preset']) {
        await expect(page.locator(`#chlo-preset-library-actions #${id}`)).toBeVisible();
        await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(page.locator('#chlo-preset-library-actions #delete_oai_preset')).toHaveCount(0);
    await page.locator('#openai-tab-btn-prompts').click();
    await openPromptTools(page);
    for (const selector of ['#update_oai_preset', '[data-preset-manager-rename="openai"]', '#new_oai_preset']) await expect(page.locator(`#chlo-preset-editor-actions ${selector}`)).toBeVisible();
    await expect(page.locator('#chlo-prompt-tools-panel .completion_prompt_manager_header')).toContainText('Total Tokens:');
    await page.locator('.chlo-available-blocks summary').click();
    await expect(page.locator('#completion_prompt_manager_footer_append_prompt')).toBeVisible();
    await expect(page.locator('#prompt-manager-import')).toBeVisible();
    await page.locator('#openai-tab-btn-parameters').click();
    await page.locator('#chlo-preset-layout-setting summary').click();
    const storedSetting = async () => {
        const settings = JSON.parse(await readFile(path.join(dataRoot, 'default-user/settings.json'), 'utf8'));
        return settings.extension_settings.ChatCompletionTabs?.enabled;
    };
    await page.locator('#ChatCompletionTabs-enabled').uncheck();
    await expect(page.locator('#chlo-native-preset-toolbar')).toBeVisible();
    await expect(page.locator('#chlo-native-preset-toolbar #update_oai_preset')).toBeVisible();
    await expect(page.locator('#chlo-native-preset-toolbar #delete_oai_preset')).toBeVisible();
    await expect(page.locator('#range_block_openai > .range-block').first().locator('#oai_max_context_unlocked')).toBeVisible();
    await expect.poll(storedSetting).toBe(false);
    await page.locator('#ChatCompletionTabs-enabled').check();
    await expect(page.locator('#chlo-native-preset-toolbar')).toBeHidden();
    // This worker reuses its fixture directory. Let the debounced save finish.
    await expect.poll(storedSetting).toBe(true);
});

test('both examples are seeded and show real grouped native blocks without replacing shared parameters', async ({ page }) => {
    const before = await shared(page);
    for (const type of ['Legacy', 'Loom']) {
        const card = page.locator('.chlo-preset-card').filter({ hasText: `Chlo - ${type} example` });
        await expect(card).toBeVisible();
        await card.locator('.chlo-preset-edit').click();
        await expect(page.locator('#chlo-preset-editor-title')).toHaveText(`Chlo - ${type} example`);
        await expect(page.locator('.chlo-prompt-section')).toHaveCount(2);
        await expect(page.locator('[data-pm-group="instructions"]')).toContainText('Instructions');
        await expect(page.locator('[data-pm-group="context"]')).toContainText('Context & structure');
        await expect.poll(() => page.evaluate(async () => {
            const { promptManager } = await import('/scripts/openai.js');
            const { promptEditorGroups } = await import('/scripts/chlolirium/presets/presentation.js');
            const grouped = promptEditorGroups(promptManager.getPromptsForCharacter(promptManager.activeCharacter)).flatMap(group => group.prompts.map(prompt => prompt.identifier));
            const rendered = [...document.querySelectorAll('#completion_prompt_manager_list [data-pm-identifier]')].map(row => row.dataset.pmIdentifier);
            return JSON.stringify(grouped) === JSON.stringify(rendered);
        })).toBe(true);
        expect(await shared(page)).toEqual(before);
        await page.screenshot({ path: path.join(root, `../chlo-grouped-${type.toLowerCase()}.png`) });
        await page.locator('#openai-tab-btn-presets').click();
    }
});

test('Prompt order enables native dragging, and toggles and saves preserve the resulting order', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Chlo - Loom example' }).locator('.chlo-preset-edit').click();
    const row = page.locator('[data-pm-identifier="pacing"]');
    await expect(row).toHaveClass(/prompt_disabled/);
    await row.locator('.prompt-manager-toggle-action').click();
    await expect(row).not.toHaveClass(/prompt_disabled/);
    await openPromptTools(page);
    await page.locator('[data-pm-view="order"]').click();
    await expect(page.locator('#completion_prompt_manager_list')).toHaveAttribute('data-editor-view', 'order');
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
    await openPromptTools(page);
    const response = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await response;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Chlo - Loom example.json'), 'utf8'));
    expect(stored.prompt_order[0].order[0]).toEqual({ identifier: 'pacing', enabled: true });
    expect(stored.prompt_order[0].order.every(entry => typeof entry?.identifier === 'string')).toBe(true);
    expect(stored.prompts.find(prompt => prompt.identifier === 'pacing').chlo_category).toBe('Core instructions');
});

test('grouping wrappers and late instructions preserves saved order and the actual generated request', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-edit').click();
    const before = await shared(page);
    const original = await page.evaluate(async () => {
        const ctx = SillyTavern.getContext();
        const form = new FormData();
        form.set('ch_name', 'Editor QA Archivist');
        form.set('description', 'An archivist in a quiet library.');
        form.set('first_mes', 'The reading room is open.');
        const response = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders({ omitContentType: true }), body: form });
        if (!response.ok) throw new Error('Could not create editor QA character');
        await ctx.getCharacters();
        await ctx.selectCharacterById(ctx.characters.findIndex(c => c.name === 'Editor QA Archivist'));
        const { promptManager, oai_settings } = await import('/scripts/openai.js');
        const make = (identifier, content, extra = {}) => ({ identifier, name: identifier, content, role: 'system', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [], ...extra });
        const extra = [make('editor-state', '{{setvar::editor_voice::Calm}}'), make('editor-open', '{{trim}}<library_context>'), make('editor-close', '</library_context>{{trim}}'), make('editor-reader', 'Editor voice: {{getvar::editor_voice}}.'), make('editor-check', 'Check the current library scene.', { injection_position: 1, injection_depth: 0, injection_order: 20 })];
        oai_settings.prompts.push(...extra);
        const order = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
        order.unshift(...extra.slice(0, 4).map(prompt => ({ identifier: prompt.identifier, enabled: true })));
        order.push({ identifier: 'editor-check', enabled: true });
        promptManager.render(false);
        return structuredClone({ prompts: oai_settings.prompts, prompt_order: oai_settings.prompt_order });
    });
    const list = page.locator('#completion_prompt_manager_list');
    await expect(list).toHaveAttribute('data-editor-view', 'grouped');
    await expect(page.locator('[data-pm-identifier="editor-reader"] .chlo-prompt-placement')).toContainText('Send order 4');
    await expect(page.locator('[data-pm-identifier="editor-check"] .chlo-prompt-placement')).toContainText('In chat · depth 0');
    expect(await list.evaluate(node => $(node).sortable('option', 'disabled'))).toBe(false);
    const groupedIds = await list.locator('[data-pm-identifier]').evaluateAll(rows => rows.map(row => row.dataset.pmIdentifier));
    expect(groupedIds.indexOf('editor-reader')).toBeLessThan(groupedIds.indexOf('editor-open'));
    expect(groupedIds.indexOf('editor-check')).toBeLessThan(groupedIds.indexOf('editor-open'));
    await page.screenshot({ path: path.join(root, '../chlo-prompt-editor-grouped.png') });

    const requests = [];
    await page.route('**/api/backends/chat-completions/generate', async route => {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'The archivist checks the catalogue.' }, finish_reason: 'stop' }] } });
    });
    for (const [view, earlier, later] of [['grouped', 'editor-reader', 'editor-open'], ['order', 'editor-open', 'editor-reader'], ['grouped', 'editor-reader', 'editor-open']]) {
        await openPromptTools(page);
        await page.locator(`[data-pm-view="${view}"]`).click();
        await expect(list).toHaveAttribute('data-editor-view', view);
        const ids = await list.locator('[data-pm-identifier]').evaluateAll(rows => rows.map(row => row.dataset.pmIdentifier));
        expect(ids.indexOf(earlier)).toBeLessThan(ids.indexOf(later));
        await page.evaluate(async () => {
            const script = await import('/script.js');
            script.setOnlineStatus('Connected');
            await script.generateQuietPrompt({ quietPrompt: 'Describe the library briefly.' });
        });
        const current = await page.evaluate(async () => {
            const { oai_settings: s } = await import('/scripts/openai.js');
            return { prompts: s.prompts, prompt_order: s.prompt_order };
        });
        expect(current).toEqual(original);
    }
    expect(requests).toHaveLength(3);
    expect(requests[1].messages).toEqual(requests[0].messages);
    expect(requests[2].messages).toEqual(requests[0].messages);
    expect(requests[0].messages.map(message => message.content).join('\n')).toContain('Editor voice: Calm.');
    expect(requests[0].messages.map(message => message.content).join('\n')).toContain('Check the current library scene.');
    await openPromptTools(page);
    await page.getByRole('checkbox', { name: 'Show group controls' }).check();
    const reader = page.locator('[data-pm-identifier="editor-reader"]');
    await reader.getByRole('combobox', { name: 'Editor group for editor-reader' }).selectOption('context');
    await reader.getByRole('button', { name: 'Move up in editor' }).click();
    await page.evaluate(async () => {
        const script = await import('/script.js');
        script.setOnlineStatus('Connected');
        await script.generateQuietPrompt({ quietPrompt: 'Describe the library briefly.' });
    });
    expect(requests).toHaveLength(4);
    expect(requests[3].messages).toEqual(requests[0].messages);
    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json'), 'utf8'));
    expect(stored.prompts).toEqual(original.prompts);
    expect(stored.prompt_order).toEqual(original.prompt_order);
    expect(await shared(page)).toEqual(before);
});

test('editor organization persists separately, search opens collapsed matches, and new blocks save in place', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-edit').click();
    const original = await page.evaluate(async () => {
        const { oai_settings: s } = await import('/scripts/openai.js');
        return structuredClone({ prompts: s.prompts, order: s.prompt_order });
    });
    await openPromptTools(page);
    await page.getByRole('checkbox', { name: 'Show group controls' }).check();
    const row = page.locator('[data-pm-identifier="voice-qa"]');
    await row.getByRole('combobox', { name: 'Editor group for Narrative voice' }).selectOption('context');
    await expect(row).toHaveAttribute('data-editor-group', 'context');
    await row.getByRole('button', { name: 'Move down in editor' }).click();
    await expect.poll(() => page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.chlo_preset.editor_layout.order)).not.toEqual(original.order[0].order.map(entry => entry.identifier));
    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json'), 'utf8'));
    expect(stored.prompts).toEqual(original.prompts);
    expect(stored.prompt_order).toEqual(original.order);
    expect(stored.chlo_preset.editor_layout.assignments['voice-qa']).toBe('context');
    await page.locator('[data-pm-group="context"] button').click();
    await expect(row).toBeHidden();
    await page.getByRole('searchbox', { name: 'Find a block' }).fill('Narrative voice');
    await expect(row).toBeVisible();
    await expect(page.locator('#completion_prompt_manager_list [data-pm-identifier]:visible')).toHaveCount(1);
    await row.locator('.chlo-select-prompt').click();
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Unsaved editor text.');
    const closeEditor = page.locator('#completion_prompt_manager_popup_entry_form_close');
    await closeEditor.click();
    await expect(page.locator('dialog[open]')).toContainText('Discard unsaved block changes?');
    await page.locator('dialog[open] .popup-button-cancel').click();
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_prompt')).toHaveValue('Unsaved editor text.');
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await closeEditor.click();
    await page.locator('.chlo-add-block').click();
    await page.locator('#completion_prompt_manager_popup_entry_form_name').fill('New workspace block');
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Neutral workspace instructions.');
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await expect(page.locator('#completion_prompt_manager_popup')).toBeVisible();
    await closeEditor.click();
    await expect(page.getByRole('searchbox', { name: 'Find a block' })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'New workspace block', exact: true })).toBeVisible();
    const created = await page.evaluate(async () => {
        const { oai_settings: s, promptManager: pm } = await import('/scripts/openai.js');
        const prompt = s.prompts.find(item => item.name === 'New workspace block');
        return { prompt, entry: pm.getPromptOrderForCharacter(pm.activeCharacter).find(item => item.identifier === prompt.identifier) };
    });
    expect(created.prompt.content).toBe('Neutral workspace instructions.');
    expect(created.entry.enabled).toBe(true);
});

test('custom prompt sections can be arranged, filled and removed without changing sending order', async ({ page }) => {
    const openPreset = name => page.locator('.chlo-preset-card').filter({ hasText: name }).locator('.chlo-preset-edit').click();
    const getNativePrompts = () => page.evaluate(async () => {
        const { oai_settings: s } = await import('/scripts/openai.js');
        return { prompts: s.prompts, order: s.prompt_order };
    });
    await openPreset('Banana QA');
    const original = await getNativePrompts();
    const manage = page.getByRole('button', { name: 'Manage sections' });
    const headings = page.locator('[data-pm-group] button');
    await expect(manage).toBeHidden();
    const openManager = async () => {
        await openPromptTools(page);
        await manage.click();
    };
    await openManager();
    const dialog = page.locator('dialog[open]').filter({ hasText: 'Manage sections' });
    const sectionRows = dialog.locator('[data-section-id]');
    const names = dialog.getByRole('textbox', { name: 'Section name' });
    const add = dialog.getByRole('button', { name: 'Add section' });
    const apply = dialog.getByRole('button', { name: 'Apply sections' });
    const row = page.locator('[data-pm-identifier="voice-qa"]');
    await expect(names).toHaveCount(2);
    await names.first().fill('Core instructions');
    await add.click();
    await apply.click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name for each section.');
    await names.last().fill('Style & voice');
    await add.click();
    await names.last().fill('Reference notes');
    await expect.poll(() => sectionRows.first().evaluate(el => Boolean($(el.parentElement).data('ui-sortable')))).toBe(true);
    const first = await sectionRows.first().boundingBox();
    await dragHandle(page, sectionRows.last().locator('.chlo-section-drag'), { x: first.x + 8, y: first.y + 3 });
    await expect(names.first()).toHaveValue('Reference notes');
    await apply.click();
    await expect(headings).toHaveText([/Reference notes\s*0/, /Core instructions/, /Context & structure/, /Style & voice\s*0/]);
    await openPromptTools(page);
    await page.getByRole('checkbox', { name: 'Show group controls' }).check();
    const groupPicker = row.getByRole('combobox', { name: 'Editor group for Narrative voice' });
    await groupPicker.selectOption({ label: 'Style & voice' });
    await expect(headings.last()).toHaveText(/Style & voice\s*1/);
    await headings.last().click();
    await expect(row).toBeHidden();
    await page.getByRole('searchbox', { name: 'Find a block' }).fill('Narrative voice');
    await expect(row).toBeVisible();
    await page.getByRole('searchbox', { name: 'Find a block' }).clear();

    await page.setViewportSize({ width: 390, height: 844 });
    await openManager();
    expect(await dialog.evaluate(el => el.scrollWidth)).toBeLessThanOrEqual(390);
    await sectionRows.last().getByRole('button', { name: 'Remove section' }).click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(headings.last()).toHaveText(/Style & voice\s*1/);
    await openManager();
    await sectionRows.last().getByRole('button', { name: 'Remove section' }).click();
    await sectionRows.first().getByRole('button', { name: 'Move section down' }).click();
    await apply.click();
    await expect(headings).toHaveText([/Core instructions/, /Reference notes\s*0/, /Context & structure/]);
    await expect(row).toHaveAttribute('data-editor-group', 'instructions');
    await groupPicker.selectOption({ label: 'Reference notes' });
    await expect(headings.nth(1)).toHaveText(/Reference notes\s*1/);
    expect(await getNativePrompts()).toEqual(original);

    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const file = path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json');
    const data = JSON.parse(await readFile(file, 'utf8'));
    expect(data.prompts).toEqual(original.prompts);
    expect(data.prompt_order).toEqual(original.order);
    const sections = data.chlo_preset.editor_layout;
    expect(sections.group_order).toEqual(['instructions', sections.assignments['voice-qa'], 'context']);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.waitForFunction(async () => (await import('/scripts/events.js')).eventSource.autoFireLastArgs.has('app_ready'));
    await page.locator('#ai-config-button > .drawer-toggle').click();
    await openPreset('Sola QA');
    await expect(headings).toHaveText([/Instructions/, /Context & structure/]);
    await page.locator('#openai-tab-btn-presets').click();
    await openPreset('Banana QA');
    await expect(headings).toHaveText([/Core instructions/, /Reference notes\s*1/, /Context & structure/]);
    await expect(row).toHaveAttribute('data-editor-group', sections.assignments['voice-qa']);
    await openPromptTools(page);
    await page.locator('[data-pm-view="order"]').click();
    await expect(headings).toHaveCount(0);
    expect(await getNativePrompts()).toEqual(original);
});

test('dragging a divider changes its boundary while every prompt card stays in place', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1800 });
    await page.locator('.chlo-preset-card').filter({ hasText: 'Sola QA' }).locator('.chlo-preset-edit').click();
    const list = page.locator('#completion_prompt_manager_list');
    const row = id => list.locator(`[data-pm-identifier="${id}"]`);
    const cards = () => list.locator('[data-pm-identifier]').evaluateAll(rows => rows.map(row => row.dataset.pmIdentifier));
    const before = await cards();
    const native = await page.evaluate(async () => {
        const { oai_settings: s } = await import('/scripts/openai.js');
        return { prompts: s.prompts, order: s.prompt_order };
    });
    await openPromptTools(page);
    await page.getByRole('button', { name: 'Manage sections' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Add section' }).click();
    await dialog.getByRole('textbox', { name: 'Section name' }).last().fill('Divider notes');
    await dialog.getByRole('button', { name: 'Apply sections' }).click();
    const divider = list.locator('[data-pm-group]').filter({ hasText: 'Divider notes' });
    const handle = divider.locator('.chlo-section-handle');
    await expect(handle).toBeVisible();
    await list.locator('[data-pm-group="context"] button').click();
    const main = await row('main').boundingBox();
    await dragHandle(page, handle, { x: main.x + 14, y: main.y + 4 });
    const above = item => item.evaluate(el => ({ heading: el.previousElementSibling?.textContent, before: el.previousElementSibling?.previousElementSibling?.dataset.pmIdentifier }));
    await expect.poll(() => above(row('main'))).toMatchObject({ heading: expect.stringContaining('Divider notes'), before: 'voice-qa' });
    await expect(list.locator('[data-pm-group="context"] button')).toHaveAttribute('aria-expanded', 'false');
    expect(await cards()).toEqual(before);

    await handle.press('ArrowDown');
    await expect.poll(() => above(row('enhanceDefinitions'))).toMatchObject({ heading: expect.stringContaining('Divider notes'), before: 'main' });
    await expect(handle).toBeFocused();
    expect(await cards()).toEqual(before);

    // The first divider can move too. The card above it stays visibly ungrouped.
    await list.locator('[data-pm-group="instructions"] .chlo-section-handle').press('ArrowDown');
    await expect(row('voice-qa')).toHaveAttribute('data-editor-group', 'ungrouped');
    await expect.poll(() => above(row('main'))).toMatchObject({ heading: expect.stringContaining('Instructions'), before: 'voice-qa' });
    expect(await cards()).toEqual(before);

    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Sola QA.json'), 'utf8'));
    expect(stored.prompts).toEqual(native.prompts);
    expect(stored.prompt_order).toEqual(native.order);
    expect(stored.chlo_preset.editor_layout.order).toEqual(before);
    expect(stored.chlo_preset.editor_layout.assignments['voice-qa']).toBe('ungrouped');
});

test('a separator can be inserted at a specific prompt without moving either neighboring block', async ({ page }) => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Banana QA' }).locator('.chlo-preset-edit').click();
    await openPromptTools(page);
    await page.getByRole('button', { name: 'Manage sections' }).click();
    const manage = page.locator('dialog[open]');
    await manage.getByRole('button', { name: 'Add section' }).click();
    await manage.getByRole('textbox', { name: 'Section name' }).last().fill('Optional modules');
    await manage.getByRole('button', { name: 'Apply sections' }).click();
    const list = page.locator('#completion_prompt_manager_list');
    await expect(list.locator('[data-pm-group] button').last()).toHaveText(/Optional modules\s*0/);
    const ids = () => list.locator('[data-pm-identifier]').evaluateAll(rows => rows.map(row => row.dataset.pmIdentifier));
    const before = await ids();
    const original = await page.evaluate(async () => {
        const { oai_settings: s } = await import('/scripts/openai.js');
        return { prompts: s.prompts, order: s.prompt_order };
    });
    const anchor = list.locator('[data-pm-identifier="main"]');
    const insertAbove = anchor.getByRole('button', { name: 'Insert section above this block' });
    await expect(insertAbove).toBeHidden();
    await openPromptTools(page);
    await page.getByRole('checkbox', { name: 'Show group controls' }).check();
    await insertAbove.press('Enter');
    const dialog = page.locator('dialog[open]').filter({ hasText: 'Insert section above this block' });
    await expect(dialog).toContainText('“Main Prompt” and the next');
    await dialog.getByRole('combobox', { name: 'Section to insert' }).selectOption({ label: 'Optional modules' });
    await dialog.getByRole('button', { name: 'Insert section', exact: true }).click();
    const above = row => row.evaluate(el => ({ heading: el.previousElementSibling?.textContent, previous: el.previousElementSibling?.previousElementSibling?.dataset.pmIdentifier }));
    await expect.poll(() => above(anchor)).toMatchObject({ heading: expect.stringContaining('Optional modules'), previous: 'voice-qa' });
    expect(await ids()).toEqual(before);

    await page.setViewportSize({ width: 320, height: 844 });
    const search = page.getByRole('searchbox', { name: 'Find a block' });
    await search.fill('Enhance Definitions');
    const nestedAnchor = list.locator('[data-pm-identifier="enhanceDefinitions"]');
    await nestedAnchor.getByRole('button', { name: 'Insert section above this block' }).click();
    await expect(dialog.getByRole('combobox', { name: 'Section to insert' })).toBeHidden();
    await dialog.getByRole('textbox', { name: 'Section name' }).fill('Style notes');
    await dialog.getByRole('button', { name: 'Insert section', exact: true }).click();
    await search.clear();
    await expect.poll(() => above(nestedAnchor)).toMatchObject({ heading: expect.stringContaining('Style notes'), previous: 'main' });
    expect(await ids()).toEqual(before);
    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json'), 'utf8'));
    expect(stored.prompts).toEqual(original.prompts);
    expect(stored.prompt_order).toEqual(original.order);
    const layout = stored.chlo_preset.editor_layout;
    const sectionNames = new Map(layout.groups.map(group => [group.id, group.label]));
    expect(layout.group_order.map(id => sectionNames.get(id))).toEqual(['Instructions', 'Optional modules', 'Style notes', 'Context & structure']);
    expect(sectionNames.get(layout.assignments.main)).toBe('Optional modules');
    expect(sectionNames.get(layout.assignments.enhanceDefinitions)).toBe('Style notes');
});

test('Loom import uses the same Import control and rejects unsupported macros before saving', async ({ page }) => {
    const before = await shared(page);
    const loom = JSON.parse(await readFile(path.join(root, 'tests/fixtures/chlolirium/loom-example.loom'), 'utf8'));
    await page.locator('#openai_preset_import_file').setInputFiles({ name: 'Loom import QA.loom', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(loom)) });
    const card = page.locator('.chlo-preset-card').filter({ hasText: 'Loom import QA' });
    await expect(card.locator('.chlo-preset-use')).toHaveAttribute('aria-pressed', 'true');
    expect(await shared(page)).toEqual(before);
    await card.locator('.chlo-preset-edit').click();
    await expect(page.locator('[data-pm-identifier="continuity"] .chlo-prompt-placement')).toContainText('Reply guidance');
    const selected = await page.locator('#chlo-preset-editor-title').textContent();
    loom.blocks[1].content = '{{loom::unsupported}}';
    await page.locator('#openai_preset_import_file').setInputFiles({ name: 'Unsupported QA.loom', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(loom)) });
    await expect(page.locator('.toast-error')).toContainText('Nothing was imported');
    await expect(page.locator('#chlo-preset-editor-title')).toHaveText(selected);
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Unsupported QA' })).toHaveCount(0);
    await expect(readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Unsupported QA.json'))).rejects.toThrow();
});

test('card deletion confirms the named inactive preset and leaves the active settings alone', async ({ page }) => {
    const name = 'Delete & keep active QA';
    const active = await page.evaluate(async name => {
        const { oai_settings, saveChatCompletionPromptPreset } = await import('/scripts/openai.js');
        await saveChatCompletionPromptPreset(name, { ...oai_settings, temp_openai: 0.19 });
        return oai_settings.preset_settings_openai;
    }, name);
    const before = await shared(page);
    const card = page.getByRole('article', { name, exact: true });
    const remove = card.getByRole('button', { name: `Delete ${name}` });
    const dialog = page.locator('dialog[open]');
    const file = path.join(dataRoot, 'default-user/OpenAI Settings', `${name}.json`);
    await expect(card.getByRole('button', { name: 'Use', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await remove.press('Enter');
    await expect(dialog.getByRole('heading')).toHaveText(`Delete “${name}”?`);
    await dialog.locator('.popup-button-cancel').click();
    await expect(card).toBeVisible();
    expect(await readFile(file, 'utf8')).toBeTruthy();

    await page.route('**/api/presets/delete', route => route.fulfill({ status: 500, body: 'Unavailable' }), { times: 1 });
    await remove.click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.toast-warning')).toContainText('Preset was not deleted from server');
    await expect(card).toBeVisible();

    await remove.click();
    const request = page.waitForRequest('**/api/presets/delete');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    expect((await request).postDataJSON()).toEqual({ apiId: 'openai', name });
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('article', { name: active, exact: true }).getByRole('button', { name: 'Use', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(readFile(file, 'utf8')).rejects.toHaveProperty('code', 'ENOENT');
    expect(await shared(page)).toEqual(before);
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
    await card.locator('.chlo-preset-edit').click();
    await openPromptTools(page);
    await page.locator('#new_oai_preset').click();
    await page.locator('dialog[open] textarea').fill('Cover copy QA');
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('#chlo-preset-editor-title')).toHaveText('Cover copy QA');
    await openPromptTools(page);
    await page.locator('[data-preset-manager-rename="openai"]').click();
    await page.locator('dialog[open] textarea').fill('Cover renamed QA');
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('#chlo-preset-editor-title')).toHaveText('Cover renamed QA');
    await expect.poll(async () => JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Cover renamed QA.json'), 'utf8')).chlo_preset.cover).toBe(cover);
    await page.locator('#openai-tab-btn-presets').click();
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Cover renamed QA' }).locator('img')).toHaveAttribute('src', cover);
    await openPresetTools(page);
    await page.locator('#export_oai_preset').click();
    const downloaded = page.waitForEvent('download');
    await page.locator('dialog[open] .popup-button-ok').click();
    const file = await downloaded;
    const exported = JSON.parse(await readFile(await file.path(), 'utf8'));
    expect(exported.chlo_preset.cover).toBe(cover);
    await page.screenshot({ path: path.join(root, '../chlo-preset-cover.png') });
    await page.getByRole('button', { name: 'Delete Cover renamed QA', exact: true }).click();
    await expect(page.locator('dialog[open]')).toContainText('Another preset will be selected');
    await page.locator('dialog[open]').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('.chlo-preset-card').filter({ hasText: 'Cover renamed QA' })).toHaveCount(0);
    await expect(page.locator('.chlo-preset-card .chlo-preset-use[aria-pressed="true"]')).toHaveCount(1);
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
    await expect(card.locator('.chlo-preset-use')).toHaveAttribute('aria-pressed', 'true');
    await card.locator('.chlo-preset-edit').click();
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
    await openPromptTools(page);
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

test('visible grouped handles reorder and regroup blocks without modifying native sending order', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1800 });
    await page.locator('.chlo-preset-card').filter({ hasText: 'Chlo - Loom example' }).locator('.chlo-preset-edit').click();
    const original = await page.evaluate(async () => {
        const { oai_settings: s } = await import('/scripts/openai.js');
        return structuredClone({ prompts: s.prompts, order: s.prompt_order });
    });
    const row = page.locator('[data-pm-identifier="continuity"]');
    await expect(row.locator('.drag-handle')).toBeVisible();
    const widget = await page.locator('#completion_prompt_manager_list').evaluate(node => $(node).data('ui-sortable').uuid);
    const first = await page.locator('[data-pm-identifier][data-editor-group="instructions"]').first().boundingBox();
    await dragHandle(page, row.locator('.drag-handle'), { x: first.x + 25, y: first.y + 2 });
    await expect(page.locator('#completion_prompt_manager_list [data-pm-identifier]').first()).toHaveAttribute('data-pm-identifier', 'continuity');
    await expect.poll(() => page.locator('#completion_prompt_manager_list').evaluate(node => $(node).data('ui-sortable')?.uuid)).not.toBe(widget);
    const context = await page.locator('[data-pm-identifier="charDescription"]').boundingBox();
    await dragHandle(page, row.locator('.drag-handle'), { x: context.x + 25, y: context.y + context.height - 3 });
    await expect(row).toHaveAttribute('data-editor-group', 'context');
    const current = await page.evaluate(async () => {
        const { oai_settings: s } = await import('/scripts/openai.js');
        return { prompts: s.prompts, order: s.prompt_order, layout: s.chlo_preset.editor_layout };
    });
    expect(current.prompts).toEqual(original.prompts);
    expect(current.order).toEqual(original.order);
    expect(current.layout.assignments.continuity).toBe('context');
    await page.getByRole('searchbox', { name: 'Find a block' }).fill('No matching text');
    expect(await page.locator('#completion_prompt_manager_list').evaluate(node => $(node).sortable('option', 'disabled'))).toBe(true);
    await page.getByRole('searchbox', { name: 'Find a block' }).clear();
    expect(await page.locator('#completion_prompt_manager_list').evaluate(node => $(node).sortable('option', 'disabled'))).toBe(false);
    await openPromptTools(page);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Chlo - Loom example.json'), 'utf8'));
    expect(stored.prompts).toEqual(original.prompts);
    expect(stored.prompt_order).toEqual(original.order);
    expect(stored.chlo_preset.editor_layout.assignments.continuity).toBe('context');
});

test('preset rows can be reordered and retain their library order after a reload', async ({ page }) => {
    const cards = page.locator('#chlo-preset-cards .chlo-preset-card');
    const firstName = await cards.first().getAttribute('data-name');
    const before = await shared(page);
    await cards.first().locator('.chlo-preset-drag').focus();
    await cards.first().locator('.chlo-preset-drag').press('ArrowDown');
    await expect(cards.nth(1)).toHaveAttribute('data-name', firstName);
    const second = await cards.nth(1).boundingBox();
    await dragHandle(page, cards.first().locator('.chlo-preset-drag'), { x: second.x + 12, y: second.y + second.height - 3 });
    await expect(cards.first()).toHaveAttribute('data-name', firstName);
    const expected = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.name));
    expect(await shared(page)).toEqual(before);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('preloader'));
    await page.waitForFunction(async () => (await import('/scripts/events.js')).eventSource.autoFireLastArgs.has('app_ready'));
    await page.evaluate(() => document.querySelectorAll('dialog[open] .popup-button-ok').forEach(button => button.click()));
    await page.locator('[data-rn-key="aiconfig"]').click();
    expect(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.name))).toEqual(expected);
});

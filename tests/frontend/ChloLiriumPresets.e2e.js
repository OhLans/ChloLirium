import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
let dataRoot, server, url, savedOriginal;
let serverLog = '';
const errors = new WeakMap();
test.use({ video: 'off', viewport: { width: 1440, height: 1000 } });

test.beforeAll(async () => {
    test.setTimeout(60000);
    dataRoot = await mkdtemp(path.join(tmpdir(), 'chlo-presets-'));
    const user = path.join(dataRoot, 'default-user');
    await mkdir(path.join(user, 'OpenAI Settings'), { recursive: true });
    const settings = JSON.parse(await readFile(path.join(root, 'default/content/settings.json'), 'utf8'));
    settings.main_api = 'openai';
    settings.firstRun = false;
    Object.assign(settings.oai_settings, { chat_completion_source: 'custom', custom_model: 'qa-model', custom_url: 'http://127.0.0.1:9', preset_settings_openai: 'Banana QA', temp_openai: 0.73, top_p_openai: 0.91, openai_max_context: 1000000, max_context_unlocked: true, openai_max_tokens: 11500, stream_openai: false });
    const preset = JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8'));
    preset.prompts.push({ identifier: 'voice-qa', name: 'Narrative voice', role: 'system', content: 'QA narrative voice. Keep {{char}} consistent.', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [], chlo_category: 'Voice & style' });
    preset.prompt_order.find(entry => entry.character_id === 100001).order.unshift({ identifier: 'voice-qa', enabled: true });
    Object.assign(settings.oai_settings, { prompts: structuredClone(preset.prompts), prompt_order: structuredClone(preset.prompt_order) });
    preset.temperature = 0.03;
    preset.openai_max_context = 2048;
    preset.openai_max_tokens = 20;
    preset.stream_openai = true;
    preset.chat_completion_source = 'claude';
    preset.custom_url = 'https://do-not-contact.invalid';
    preset.chlo_preset = { description: 'Character-driven stories, with room to breathe.' };
    await writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
    savedOriginal = JSON.stringify(preset);
    await writeFile(path.join(user, 'OpenAI Settings/Banana QA.json'), savedOriginal);
    const other = structuredClone(preset);
    other.prompts.find(prompt => prompt.identifier === 'voice-qa').content = 'Sola QA voice.';
    other.temperature = 1.9;
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
    // Each browser starts from the same shared current generation values.
    await page.evaluate(async () => {
        const { oai_settings } = await import('/scripts/openai.js');
        Object.assign(oai_settings, { temp_openai: 0.73, top_p_openai: 0.91, openai_max_context: 1000000, max_context_unlocked: true, openai_max_tokens: 11500, stream_openai: false });
        $('#temp_openai').val(0.73).trigger('input');
        $('#top_p_openai').val(0.91).trigger('input');
        $('#oai_max_context_unlocked').prop('checked', true).trigger('input');
        $('#openai_max_context').val(1000000).trigger('input');
        $('#openai_max_tokens').val(11500).trigger('input');
        $('#stream_toggle').prop('checked', false).trigger('input');
    });
    await page.locator('[data-rn-key="presets"]').click();
    await expect(page.locator('#chlo-preset-workspace')).toBeVisible();
});

test.afterEach(async ({ page }) => {
    expect(errors.get(page), 'Unexpected page errors').toEqual([]);
});

const shared = async page => page.evaluate(async () => {
    const { oai_settings: s } = await import('/scripts/openai.js');
    return { temperature: s.temp_openai, topP: s.top_p_openai, context: s.openai_max_context, reply: s.openai_max_tokens, stream: s.stream_openai, source: s.chat_completion_source, model: s.custom_model, endpoint: s.custom_url, reasoning: s.reasoning_effort, n: s.n };
});

test('collection is the landing page, supports search and preview, and never activates a preview', async ({ page }) => {
    await expect(page.locator('#pw-title')).toHaveText('Preset Library');
    await expect(page.locator('[data-select="Banana QA"]')).toBeVisible();
    const active = await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.preset_settings_openai);
    await page.locator('[data-select="Sola QA"]').click();
    await expect(page.locator('#pw-preset-details h3')).toHaveText('Sola QA');
    expect(await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.preset_settings_openai)).toBe(active);
    await page.locator('#pw-search').fill('Banana');
    await expect(page.locator('.pw-preset-card')).toHaveCount(1);
    await page.screenshot({ path: path.join(root, '../chlo-presets-library.png') });
});

test('library and native quick switching preserve all shared settings and leave original files intact', async ({ page }) => {
    const before = await shared(page);
    await page.locator('[data-use="Sola QA"]').first().click();
    await expect(page.locator('#chlo-preset-workspace')).toBeHidden();
    expect(await shared(page)).toEqual(before);
    await page.evaluate(async () => {
        const { openai_setting_names, getPresetApplicationPromise } = await import('/scripts/openai.js');
        $('#settings_preset_openai').val(openai_setting_names['Banana QA']).trigger('change');
        await getPresetApplicationPromise();
    });
    expect(await shared(page)).toEqual(before);
    expect(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json'), 'utf8')).toBe(savedOriginal);
});

test('shared parameter controls keep their handlers and restore exactly, including when tabs are disabled', async ({ page }) => {
    const original = await page.evaluate(() => document.getElementById('range_block_openai').parentElement.id);
    await page.locator('.pw-tabs [data-view="parameters"]').click();
    await expect(page.locator('#pw-title')).toHaveText('Generation settings');
    await page.locator('#pw-parameter-controls #temp_counter_openai').fill('0.82');
    await page.locator('#pw-parameter-controls #temp_counter_openai').press('Tab');
    expect((await shared(page)).temperature).toBe(0.82);
    await page.locator('.pw-tabs [data-view="library"]').click();
    expect(await page.evaluate(() => document.getElementById('range_block_openai').parentElement.id)).toBe(original);
    await page.locator('.pw-tabs [data-view="parameters"]').click();
    await expect(page.locator('#pw-parameter-controls #temp_counter_openai')).toHaveValue('0.82');
    await page.screenshot({ path: path.join(root, '../chlo-presets-parameters.png') });
    await page.locator('[data-action="close"]').click();
    await page.evaluate(() => $('#ChatCompletionTabs-enabled').prop('checked', false).trigger('change'));
    await page.locator('[data-rn-key="presets"]').click();
    await page.locator('.pw-tabs [data-view="parameters"]').click();
    await page.locator('#pw-parameter-controls #openai_max_tokens').fill('12345');
    expect((await shared(page)).reply).toBe(12345);
    await page.locator('[data-action="close"]').click();
    await expect(page.locator('#left-nav-panel #openai_max_tokens')).toHaveCount(1);
    await page.evaluate(() => $('#ChatCompletionTabs-enabled').prop('checked', true).trigger('change'));
});

test('block drafts support native properties, macros, ordering, save and reload without per-preset parameters', async ({ page }) => {
    const before = await shared(page);
    await page.locator('[data-edit="Banana QA"]').first().click();
    await page.locator('[data-block="voice-qa"]').click();
    await expect(page.locator('#pw-content')).toContainText('QA narrative voice');
    await page.locator('[data-action="add-block"]').click();
    await page.locator('#pw-block-editor [data-field="name"]').fill('A gentle voice');
    await page.locator('#pw-content').fill('Remember the emotional context. ');
    await page.locator('[data-macro="{{user}}"]' ).click();
    await expect(page.locator('#pw-content')).toHaveValue('Remember the emotional context. {{user}}');
    await page.locator('[data-field="role"]').selectOption('assistant');
    await page.locator('[data-field="injection_position"]').selectOption('1');
    await page.locator('.pw-advanced > summary').click();
    await page.locator('[data-field="injection_depth"]').fill('7');
    await page.locator('[data-trigger="continue"]').check();
    await page.locator('[data-action="move-up"]').click();
    await page.screenshot({ path: path.join(root, '../chlo-presets-editor.png') });
    // Save the active draft through the same action used in the interface.
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#pw-draft-state')).toHaveText('Saved');
    expect(await shared(page)).toEqual(before);
    const body = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Banana QA.json'), 'utf8'));
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('openai_max_context');
    expect(body).not.toHaveProperty('custom_url');
    expect(body.prompts.find(prompt => prompt.name === 'A gentle voice')).toMatchObject({ role: 'assistant', injection_position: 1, injection_depth: 7, injection_trigger: ['continue'] });
    await page.locator('[data-action="close"]').click();
    await page.reload();
    await page.locator('[data-rn-key="presets"]').click();
    await page.locator('[data-edit="Banana QA"]').first().click();
    await expect(page.locator('#pw-block-list')).toContainText('A gentle voice');
});

test('unsaved changes require explicit discard and a failed save keeps the draft', async ({ page }) => {
    await page.locator('[data-edit="Sola QA"]').first().click();
    await page.locator('[data-block="voice-qa"]').click();
    await page.locator('#pw-content').fill('Do not lose this draft.');
    await page.locator('[data-action="close"]').click();
    await expect(page.locator('dialog[open]')).toContainText('Unsaved prompt changes');
    await page.locator('dialog[open] .popup-button-cancel').click();
    await expect(page.locator('#pw-content')).toHaveValue('Do not lose this draft.');
    await page.route('**/api/presets/save', route => route.fulfill({ status: 500, body: 'QA failure' }));
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('.pw-status')).toContainText('Failed to save preset');
    await expect(page.locator('#pw-content')).toHaveValue('Do not lose this draft.');
    await expect(page.locator('#pw-draft-state')).toHaveText('Unsaved prompt changes');
});

test('JSON imports open a review draft and exclude embedded API and sampling values', async ({ page }) => {
    await page.locator('#pw-import-file').setInputFiles({ name: 'Imported voice.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ temperature: 0.1, custom_url: 'https://do-not-contact.invalid', prompts: [{ identifier: 'import-qa', name: 'Imported block', role: 'system', content: 'Imported instructions', system_prompt: false }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'import-qa', enabled: true }] }] })) });
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('#pw-title')).toHaveText('Imported voice');
    await expect(page.locator('#pw-content')).toHaveValue('Imported instructions');
    await expect(page.locator('#pw-draft-state')).toHaveText('Unsaved prompt changes');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#pw-draft-state')).toHaveText('Saved');
    const preset = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Imported voice.json'), 'utf8'));
    expect(preset).not.toHaveProperty('custom_url');
    expect(preset).not.toHaveProperty('temperature');
});

test('phone library, editor and parameters fit the viewport and keep controls reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(root, '../chlo-presets-phone.png') });
    for (const view of ['library', 'editor', 'parameters']) {
        await page.locator(`.pw-tabs [data-view="${view}"]`).click();
        const overflow = await page.locator('#chlo-preset-workspace').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth, right: node.getBoundingClientRect().right }));
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
        expect(overflow.right).toBeLessThanOrEqual(390);
        await expect(page.locator('[data-action="close"]')).toBeVisible();
    }
});

test('favorites persist, new presets start as drafts, and cover art is saved with the prompt', async ({ page }) => {
    await page.locator('[data-favorite="Sola QA"]').click();
    await page.locator('[data-filter="favorites"]').click();
    await expect(page.locator('[data-select="Sola QA"]')).toBeVisible();
    await page.locator('[data-action="new"]').click();
    await page.locator('dialog[open] .popup-input').fill('Personal QA');
    await page.locator('dialog[open] .popup-button-ok').click();
    await expect(page.locator('#pw-title')).toHaveText('Personal QA');
    await expect(page.locator('#pw-draft-state')).toHaveText('Unsaved prompt changes');
    await page.locator('#pw-cover-file').setInputFiles(path.join(root, 'default/content/user-default.png'));
    await expect(page.locator('.pw-status')).toContainText('Cover added');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#pw-draft-state')).toHaveText('Saved');
    const preset = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Personal QA.json'), 'utf8'));
    expect(preset.chlo_preset.cover).toMatch(/^data:image\/webp;base64,/);
    await page.locator('[data-action="close"]').click();
    await page.reload();
    await page.locator('[data-rn-key="presets"]').click();
    await expect(page.locator('[data-favorite="Sola QA"]')).toHaveAttribute('aria-pressed', 'true');
});

test('native prompt assembly and streaming/non-streaming requests use selected blocks and shared parameters', async ({ page }) => {
    const requests = [];
    await page.route('**/api/backends/chat-completions/generate', async route => {
        const body = route.request().postDataJSON();
        requests.push(body);
        if (body.stream) {
            await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"index":0,"delta":{"content":"QA response"}}]}\n\ndata: [DONE]\n\n' });
        } else {
            await route.fulfill({ json: { choices: [{ message: { role: 'assistant', content: 'QA response' } }] } });
        }
    });
    const before = await shared(page);
    await page.locator('[data-use="Sola QA"]').first().click();
    const replies = await page.evaluate(async () => {
        const { prepareOpenAIMessages, sendOpenAIRequest, oai_settings } = await import('/scripts/openai.js');
        const [messages] = await prepareOpenAIMessages({ name2: 'QA Character', charDescription: 'QA character description', charPersonality: '', scenario: 'Tea at dusk.', worldInfoBefore: '', worldInfoAfter: '', bias: '', type: 'normal', quietPrompt: '', quietImage: null, extensionPrompts: {}, cyclePrompt: '', systemPromptOverride: '', jailbreakPromptOverride: '', messages: [{ role: 'user', content: 'Please continue the scene.' }], messageExamples: [] }, false);
        const normal = await sendOpenAIRequest('quiet', messages);
        oai_settings.stream_openai = true;
        const generator = await sendOpenAIRequest('normal', messages);
        let streamed;
        for await (const result of generator()) streamed = result.text;
        return { normal: normal.choices[0].message.content, streamed };
    });
    expect(replies).toEqual({ normal: 'QA response', streamed: 'QA response' });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
        expect(request.temperature).toBe(before.temperature);
        expect(request.top_p).toBe(before.topP);
        expect(request.max_tokens).toBe(before.reply);
        expect(request.messages.some(message => message.content?.includes('Sola QA voice.'))).toBe(true);
        expect(request.messages.some(message => message.content?.includes('QA character description'))).toBe(true);
    }
});

test('new edits typed during a pending save stay in the draft', async ({ page }) => {
    await page.locator('[data-edit="Sola QA"]').first().click();
    await page.locator('[data-block="voice-qa"]').click();
    await page.locator('#pw-content').fill('First saved text.');
    let release;
    const gate = new Promise(resolve => release = resolve);
    await page.route('**/api/presets/save', async route => {
        await gate;
        await route.continue();
    });
    const request = page.waitForRequest('**/api/presets/save');
    await page.locator('[data-action="save"]').click();
    await request;
    await page.locator('#pw-content').fill('Newer unsaved text.');
    release();
    await expect(page.locator('.pw-status')).toContainText('newest edits are still in the draft');
    await expect(page.locator('#pw-content')).toHaveValue('Newer unsaved text.');
    await expect(page.locator('#pw-draft-state')).toHaveText('Unsaved prompt changes');
    await page.locator('[data-action="save"]').click();
    await expect(page.locator('#pw-draft-state')).toHaveText('Saved');
});

test('navigation closes a clean dock and restores native controls before another drawer opens', async ({ page }) => {
    await page.locator('.pw-tabs [data-view="parameters"]').click();
    const chat = await page.locator('#sheld').boundingBox();
    const dock = await page.locator('#chlo-preset-workspace').boundingBox();
    expect(chat.x).toBeGreaterThan(dock.x + dock.width);
    await page.locator('[data-rn-key="api"]').click();
    await expect(page.locator('#chlo-preset-workspace')).toBeHidden();
    await expect(page.locator('#left-nav-panel #temp_openai')).toHaveCount(1);
    await expect(page.locator('#rm_api_block')).toHaveClass(/openDrawer/);
});

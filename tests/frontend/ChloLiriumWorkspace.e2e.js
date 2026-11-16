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
    Object.assign(settings.oai_settings, { chat_completion_source: 'custom', custom_model: 'qa-model', custom_url: 'http://127.0.0.1:9', preset_settings_openai: 'Workspace QA', temp_openai: 0.73, top_p_openai: 0.91, openai_max_context: 1000000, max_context_unlocked: true, openai_max_tokens: 11500, stream_openai: false });
    const preset = pickPromptPreset(JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8')));
    const custom = Array.from({ length: 120 }, (_, i) => ({ identifier: `block-${i}`, name: `Block ${String(i + 1).padStart(3, '0')}`, role: 'system', content: i === 75 ? Array.from({ length: 100 }, (_, n) => `Paragraph ${n}: Quiet details and consistent characterization.`).join('\n\n') : `Instructions for block ${i + 1}. ${i === 5 ? 'An orchard hidden among the hills.' : 'Leave the user’s choices open.'}`, chlo_category: i < 40 ? 'Core instructions' : i < 80 ? 'World & memory' : 'Conversation', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] }));
    preset.prompts.push(...custom, { identifier: 'library-unused', name: 'Library atmosphere', content: 'A copper lantern beside the window.', role: 'system', system_prompt: false, marker: false, injection_position: 0, injection_depth: 4, injection_order: 100, injection_trigger: [] });
    preset.prompt_order = [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, ...custom.map(p => ({ identifier: p.identifier, enabled: true })), { identifier: 'chatHistory', enabled: true }] }];
    Object.assign(settings.oai_settings, { prompts: structuredClone(preset.prompts), prompt_order: structuredClone(preset.prompt_order) });
    await writeFile(path.join(user, 'settings.json'), JSON.stringify(settings));
    await writeFile(path.join(user, 'OpenAI Settings/Workspace QA.json'), JSON.stringify(preset));
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

const open = async page => {
    await page.locator('.chlo-preset-card').filter({ hasText: 'Workspace QA' }).locator('.chlo-preset-edit').click();
    await expect(page.locator('#chlo-preset-workspace')).toBeVisible();
    await expect(page.locator('#chlo-preset-workspace [data-pm-identifier="block-119"]')).toBeAttached();
};
const select = (page, id) => page.locator(`#chlo-preset-workspace [data-pm-identifier="${id}"] .completion_prompt_manager_prompt_name`).click();
const order = page => page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.prompt_order[0].order);

test('expanded editor reuses native controls, leaves chat geometry intact, and returns to the collection', async ({ page }) => {
    const before = await page.locator('#sheld').boundingBox();
    await open(page);
    const bounds = await page.locator('#chlo-preset-workspace').boundingBox();
    expect(bounds.width).toBeGreaterThan(1100);
    expect(bounds.height).toBeGreaterThan(900);
    const left = await page.locator('.chlo-workspace-outline').boundingBox();
    const right = await page.locator('.chlo-workspace-editor').boundingBox();
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
    expect(await page.locator('#sheld').boundingBox()).toEqual(before);
    expect(await page.locator('#completion_prompt_manager_popup_entry_form_prompt').evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(360);
    for (const id of ['completion_prompt_manager', 'completion_prompt_manager_popup', 'update_oai_preset']) await expect(page.locator(`#${id}`)).toHaveCount(1);
    await page.screenshot({ path: path.join(root, '../chlo-expanded-editor.png') });
    await page.locator('.chlo-workspace-close').click();
    await expect(page.locator('#chlo-preset-workspace')).toBeHidden();
    await expect(page.locator('#chlo-preset-collection')).toBeVisible();
    await expect(page.locator('#left-nav-panel #completion_prompt_manager')).toHaveCount(1);
    expect(await page.locator('#sheld').boundingBox()).toEqual(before);
});

test('an existing library prompt can be found by contents and inserted at the chosen position', async ({ page }) => {
    await open(page);
    const before = await order(page);
    await page.getByRole('button', { name: 'Add prompt after Block 031', exact: true }).click();
    await page.locator('#chlo-insert-search').fill('copper lantern');
    await page.locator('.chlo-insert-choice').filter({ hasText: 'Library atmosphere' }).click();
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_name')).toHaveValue('Library atmosphere');
    const after = await order(page);
    expect(after.findIndex(entry => entry.identifier === 'library-unused')).toBe(before.findIndex(entry => entry.identifier === 'block-30') + 1);
    expect(after.filter(entry => entry.identifier !== 'library-unused')).toEqual(before);
    await page.getByRole('button', { name: 'Add prompt after Block 011', exact: true }).click();
    await page.getByRole('button', { name: 'Close prompt picker', exact: true }).click();
    expect(await order(page)).toEqual(after);
});

test('block and preset saves retain the selected block, both scroll positions and text selection', async ({ page }) => {
    await open(page);
    await select(page, 'block-75');
    const textarea = page.locator('#completion_prompt_manager_popup_entry_form_prompt');
    const original = await textarea.inputValue();
    await textarea.fill(`${original}\nA final quiet detail.`);
    await textarea.evaluate(node => {
        node.focus();
        node.setSelectionRange(1700, 1730);
        node.scrollTop = 650;
    });
    const position = () => page.evaluate(() => {
        const field = document.getElementById('completion_prompt_manager_popup_entry_form_prompt');
        return { list: document.querySelector('.chlo-workspace-list').scrollTop, text: field.scrollTop, start: field.selectionStart, end: field.selectionEnd, id: document.getElementById('completion_prompt_manager_popup_entry_form_save').dataset.pmPrompt };
    });
    const before = await position();
    expect(before.list).toBeGreaterThan(0);
    expect(before.text).toBeGreaterThan(0);
    await page.locator('#completion_prompt_manager_popup_entry_form_save .chlo-workspace-control-label').click();
    await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.render(false));
    expect(await position()).toEqual(before);
    expect(await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.getPromptById('block-75').content)).toBe(`${original}\nA final quiet detail.`);
    await expect(textarea).toHaveValue(`${original}\nA final quiet detail.`);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    await expect(page.locator('#chlo-preset-save-status')).toHaveText('Preset saved');
    expect(await position()).toEqual(before);
    // Saving the preset need not redraw the list, but a later native refresh
    // must retain the same state as well.
    await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.render(false));
    expect(await position()).toEqual(before);
    await page.screenshot({ path: path.join(root, '../chlo-expanded-saved-position.png') });
});

test('switching blocks protects unsaved edits and preset Save commits the open block', async ({ page }) => {
    await open(page);
    await select(page, 'block-90');
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('A temporary draft.');
    await select(page, 'block-91');
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_name')).toHaveValue('Block 091');
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_prompt')).toHaveValue('A temporary draft.');
    await select(page, 'block-91');
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_name')).toHaveValue('Block 092');
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Save this directly with the preset.');
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Workspace QA.json'), 'utf8'));
    expect(stored.prompts.find(prompt => prompt.identifier === 'block-90').content).not.toBe('A temporary draft.');
    expect(stored.prompts.find(prompt => prompt.identifier === 'block-91').content).toBe('Save this directly with the preset.');
});

test('roles, depth and Select2 triggers remain editable inside the expanded editor', async ({ page }) => {
    await open(page);
    await select(page, 'block-20');
    await page.locator('.chlo-inline-prompt-options > summary').click();
    await page.locator('#completion_prompt_manager_popup_entry_form_role').selectOption('assistant');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_position').selectOption('1');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_depth').fill('3');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_order').fill('650');
    await page.locator('#completion_prompt_manager_popup_entry_form_injection_trigger + .select2 .select2-selection').click();
    await page.locator('#chlo-preset-workspace .select2-results__option').filter({ hasText: /^Continue$/ }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#chlo-preset-workspace')).toBeVisible();
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    const prompt = await page.evaluate(async () => (await import('/scripts/openai.js')).oai_settings.prompts.find(prompt => prompt.identifier === 'block-20'));
    expect(prompt).toMatchObject({ role: 'assistant', injection_position: 1, injection_depth: 3, injection_order: 650, injection_trigger: ['continue'] });
    // An actual preset reload with the same name/content but changed advanced
    // fields must refresh the form rather than retaining stale control values.
    await page.evaluate(async () => {
        const { promptManager } = await import('/scripts/openai.js');
        const { eventSource, event_types } = await import('/script.js');
        promptManager.getPromptById('block-20').role = 'user';
        await eventSource.emit(event_types.OAI_PRESET_CHANGED_AFTER);
        await promptManager.render(false);
    });
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_role')).toHaveValue('user');
});

test('native drag and toggle controls preserve order flags and exclude presentation rows', async ({ page }) => {
    await open(page);
    await page.locator('[data-pm-identifier="block-9"] .prompt-manager-toggle-action').click();
    await expect(page.locator('[data-pm-identifier="block-9"]')).toHaveClass(/prompt_disabled/);
    await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.render(false));
    const before = await order(page);
    const source = page.locator('[data-pm-identifier="block-10"] .drag-handle');
    await source.scrollIntoViewIfNeeded();
    const start = await source.boundingBox(), end = await page.locator('[data-pm-identifier="block-9"]').boundingBox();
    await page.mouse.move(start.x + 5, start.y + 10);
    await page.mouse.down();
    // Native sortable uses a configured drag delay.
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(150);
    await page.mouse.move(end.x + 25, end.y + 2, { steps: 15 });
    await page.evaluate(async () => {
        window.dragRefreshFinished = false;
        window.dragRefresh = (await import('/scripts/openai.js')).promptManager.render(false).then(() => window.dragRefreshFinished = true);
    });
    expect(await page.evaluate(() => window.dragRefreshFinished)).toBe(false);
    await page.mouse.up();
    await page.evaluate(() => window.dragRefresh);
    await expect.poll(async () => (await order(page)).findIndex(entry => entry.identifier === 'block-10')).toBeLessThan(before.findIndex(entry => entry.identifier === 'block-10'));
    const after = await order(page);
    expect(after.filter(entry => entry.identifier !== 'block-10')).toEqual(before.filter(entry => entry.identifier !== 'block-10'));
    expect(after.every(entry => entry && typeof entry.identifier === 'string')).toBe(true);
});

test('macro autocomplete stays inside the modal and closing preserves the current form buffer', async ({ page }) => {
    await open(page);
    await select(page, 'block-40');
    const textarea = page.locator('#completion_prompt_manager_popup_entry_form_prompt');
    await textarea.fill('');
    await textarea.pressSequentially('{{cha');
    await expect(page.locator('#chlo-preset-workspace .autoComplete-wrap')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#chlo-preset-workspace')).toBeVisible();
    await expect(page.locator('#chlo-preset-workspace .autoComplete-wrap')).toBeHidden();
    await textarea.fill('A draft that stays open when returning from chat.');
    await page.locator('.chlo-workspace-close').click();
    await open(page);
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_name')).toHaveValue('Block 041');
    await expect(textarea).toHaveValue('A draft that stays open when returning from chat.');
});

test('detaching another block retains the open edit and detaching it asks about unsaved changes', async ({ page }) => {
    await open(page);
    await select(page, 'block-10');
    const textarea = page.locator('#completion_prompt_manager_popup_entry_form_prompt');
    await textarea.fill('An unsaved edit to keep.');
    await page.locator('[data-pm-identifier="block-11"] .prompt-manager-detach-action').click();
    await expect(page.locator('[data-pm-identifier="block-11"]')).toHaveCount(0);
    await expect(textarea).toHaveValue('An unsaved edit to keep.');
    const remove = page.locator('[data-pm-identifier="block-10"] .prompt-manager-detach-action');
    await remove.click();
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(textarea).toHaveValue('An unsaved edit to keep.');
    await remove.click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.locator('[data-pm-identifier="block-10"]')).toHaveCount(0);
    expect(await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.getPromptById('block-10').content)).not.toBe('An unsaved edit to keep.');
    await expect(page.locator('.chlo-workspace-empty')).toBeVisible();
});

test('the original editor restores its list position after saving when the tab layout is disabled', async ({ page }) => {
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(false));
    const edit = page.locator('[data-pm-identifier="block-105"] .prompt-manager-edit-action');
    await edit.scrollIntoViewIfNeeded();
    const position = await page.locator('#completion_prompt_manager').evaluate(node => node.closest('.scrollableInner').scrollTop);
    expect(position).toBeGreaterThan(0);
    await edit.click();
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Native fallback editor QA.');
    await page.evaluate(async () => {
        window.nativePromptRendered = false;
        (await import('/scripts/openai.js')).promptManager.containerElement.addEventListener('prompt-manager-rendered', () => window.nativePromptRendered = true, { once: true });
    });
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await expect.poll(() => page.evaluate(() => window.nativePromptRendered)).toBe(true);
    expect(await page.locator('#completion_prompt_manager').evaluate(node => node.closest('.scrollableInner').scrollTop)).toBeCloseTo(position, 0);
});

test('phone layout fits and disabling panel layout restores all original controls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const bounds = await page.locator('#chlo-preset-workspace').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.locator('#chlo-outline-search').fill('orchard');
    await select(page, 'block-5');
    const textarea = await page.locator('#completion_prompt_manager_popup_entry_form_prompt').boundingBox();
    expect(textarea.x + textarea.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(root, '../chlo-expanded-phone.png') });
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(false));
    await expect(page.locator('#chlo-preset-workspace')).toBeHidden();
    for (const id of ['completion_prompt_manager', 'completion_prompt_manager_popup', 'update_oai_preset']) await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.locator('#chlo-native-preset-toolbar #update_oai_preset')).toBeVisible();
    await expect(page.locator('#left-nav-panel #completion_prompt_manager_popup')).toHaveCount(0);
    expect(await page.locator('#completion_prompt_manager_popup').evaluate(node => node.classList.contains('drawer-content'))).toBe(true);
    await page.evaluate(() => window.ChatCompletionTabs.openAITabManager.setEnabled(true));
    await open(page);
    await expect(page.locator('#chlo-preset-workspace #completion_prompt_manager_popup')).toBeVisible();
});

test('search finds prompt contents and sections collapse without changing native order', async ({ page }) => {
    await open(page);
    const before = await order(page);
    await page.locator('#chlo-outline-search').fill('orchard');
    await expect(page.locator('#chlo-preset-workspace [data-pm-identifier]:visible')).toHaveCount(1);
    await select(page, 'block-5');
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_prompt')).toHaveValue(/orchard/);
    await page.locator('#chlo-outline-search').fill('');
    await page.locator('.chlo-section-toggle').filter({ hasText: 'World & memory' }).click();
    await expect(page.locator('[data-pm-identifier="block-50"]')).toBeHidden();
    expect(await order(page)).toEqual(before);
    await page.locator('#chlo-outline-search').fill('block 51');
    await expect(page.locator('[data-pm-identifier="block-50"]')).toBeVisible();
    await page.locator('#chlo-outline-search').fill('');
    await expect(page.locator('[data-pm-identifier="block-50"]')).toBeHidden();
});

test('new blocks are inserted directly after the chosen block and saved by native preset controls', async ({ page }) => {
    await open(page);
    const before = await order(page);
    await page.getByRole('button', { name: 'Add prompt after Block 061', exact: true }).click();
    await expect(page.locator('#chlo-prompt-insert-picker')).toBeVisible();
    await page.locator('.chlo-create-prompt').click();
    await page.locator('#completion_prompt_manager_popup_entry_form_name').fill('New middle block');
    await page.locator('#completion_prompt_manager_popup_entry_form_prompt').fill('Keep the copper lantern in view.');
    await page.locator('#completion_prompt_manager_popup_entry_form_save').click();
    await expect(page.locator('#completion_prompt_manager_popup')).toBeVisible();
    const after = await order(page);
    const id = after.find(entry => !before.some(old => old.identifier === entry.identifier)).identifier;
    expect(after.findIndex(entry => entry.identifier === id)).toBe(before.findIndex(entry => entry.identifier === 'block-60') + 1);
    expect(after.find(entry => entry.identifier === id).enabled).toBe(true);
    const saved = page.waitForResponse('**/api/presets/save');
    await page.locator('#update_oai_preset').click();
    await saved;
    await expect(page.locator('#completion_prompt_manager_popup_entry_form_name')).toHaveValue('New middle block');
    const stored = JSON.parse(await readFile(path.join(dataRoot, 'default-user/OpenAI Settings/Workspace QA.json'), 'utf8'));
    expect(stored.prompts.find(prompt => prompt.identifier === id)).toMatchObject({ content: 'Keep the copper lantern in view.', chlo_category: 'World & memory' });
    expect(stored.prompt_order[0].order).toEqual(after);
});

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const desktop = { width: 1920, height: 1080 };
const script = (id, scriptName, findRegex, replaceString) => ({
    id, scriptName, findRegex, replaceString, trimStrings: [], placement: [2],
    disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true,
    substituteRegex: 0, minDepth: null, maxDepth: null,
});

test.use({ video: 'off', viewport: desktop });

let dataRoot, server, url, settingsPath;
let serverLog = '';
const errors = new WeakMap();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    test.setTimeout(60000);
    dataRoot = await mkdtemp(path.join(tmpdir(), 'chlo-regex-drawer-'));
    const user = path.join(dataRoot, 'default-user');
    await mkdir(path.join(user, 'OpenAI Settings'), { recursive: true });
    settingsPath = path.join(user, 'settings.json');
    const settings = JSON.parse(await readFile(path.join(root, 'default/content/settings.json'), 'utf8'));
    settings.main_api = 'openai';
    settings.firstRun = false;
    settings.accountStorage = { ...settings.accountStorage, 'AlertRegex_openai_Regex QA': 'true' };
    settings.extension_settings.SillyTavernMoonlitEchoesTheme = { enabled: true, customThemeColor: 'rgba(174, 149, 149, 1)', activePreset: 'QA', presets: { QA: { customThemeColor: 'rgba(174, 149, 149, 1)' } } };
    const preset = JSON.parse(await readFile(path.join(root, 'default/content/presets/openai/Default.json'), 'utf8'));
    const legacyRules = [script('normalize', 'Normalize whitespace', '/ {2,}/g', ' '), { ...script('markers', 'Clean scene markers', String.raw`/\[note\]/g`, ''), disabled: true }, script('widget', 'Render scene widget', String.raw`/\[widget\]/g`, '[Widget]')];
    preset.extensions = { regex_scripts: [
        script('preset-regex', 'Preset-only cleanup', '/sample/g', 'preset'),
        { ...script('loom-widget', 'Widgets / Render panel', '/panel/g', 'widget'), chlo_loom: { version: 1, mode: 'none' } },
    ] };
    const otherPreset = { ...preset, extensions: { regex_scripts: [script('other-regex', 'Another preset rule', '/sample/g', 'other')] } };
    Object.assign(settings.oai_settings, { chat_completion_source: 'custom', custom_model: 'qa-model', custom_url: 'http://127.0.0.1:9', preset_settings_openai: 'Regex QA', extensions: preset.extensions });
    Object.assign(settings.extension_settings, { regex: legacyRules, regex_presets: [], preset_allowed_regex: { openai: ['Other Regex QA'] } });
    await writeFile(settingsPath, JSON.stringify(settings));
    await writeFile(path.join(user, 'OpenAI Settings/Regex QA.json'), JSON.stringify(preset));
    await writeFile(path.join(user, 'OpenAI Settings/Other Regex QA.json'), JSON.stringify(otherPreset));
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

const drawer = page => page.locator('#chlo-regex-drawer');
const row = (page, id) => drawer(page).locator(`[data-regex-id="${id}"]`);
const scopes = page => drawer(page).getByRole('group', { name: 'Script scope' });
const scopeSwitch = (page, scope) => scopes(page).getByRole('switch', { name: `Toggle ${scope} regex rules` });
const tools = page => drawer(page).locator('summary[aria-label="Regex tools"]');
const ruleState = page => page.evaluate(async () => (await import('/scripts/extensions/regex/engine.js')).getRegexScripts());

async function ready(page) {
    await page.goto(url);
    await page.waitForFunction(async () => (await import('/scripts/events.js')).eventSource.autoFireLastArgs.has('app_ready'));
    // The startup cover can remain in headless Chromium after APP_READY.
    await page.evaluate(() => document.getElementById('preloader')?.remove());
}

async function addSection(page, name) {
    await tools(page).click();
    await drawer(page).getByRole('button', { name: 'New section' }).click();
    const popup = page.locator('dialog[open]');
    await popup.locator('.popup-input').fill(name);
    await popup.locator('.popup-button-ok').click();
    await expect(drawer(page).getByRole('button', { name: new RegExp(name) }).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    errors.set(page, []);
    page.on('pageerror', error => errors.get(page).push(error.message));
});

test.afterEach(({ page }) => {
    expect(errors.get(page)).toEqual([]);
});

test('Regex has its own rail entry and keeps the chat visible on desktop', async ({ page }) => {
    await ready(page);
    const nav = page.locator('[data-rn-key="regex"]');
    await expect(page.locator('#rm_extensions_block #regex_container')).toHaveCount(0);
    await page.locator('[data-rn-key="aiconfig"]').click();
    const responseDrawer = page.locator('#left-nav-panel');
    await expect(responseDrawer).toHaveClass(/openDrawer/);
    const originalWidth = (await responseDrawer.boundingBox()).width;
    await responseDrawer.getByRole('button', { name: 'Close configuration' }).click();
    await nav.click();
    await expect(nav).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer(page)).toBeVisible();
    const position = await drawer(page).boundingBox();
    const chat = page.locator('#sheld');
    const gap = async () => (await chat.boundingBox()).x - await drawer(page).evaluate(node => node.getBoundingClientRect().right);
    expect(position.width).toBeLessThan(originalWidth);
    expect(position.x).toBeGreaterThanOrEqual(40);
    await expect(chat).toBeVisible();
    await expect.poll(gap).toBeCloseTo(0, 0);
    await chat.evaluate(node => Object.assign(node.style, { left: '376px', right: 'auto', marginInline: '0' }));
    await expect.poll(gap).toBeCloseTo(0, 0);
    await drawer(page).getByRole('button', { name: 'Close Regex' }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(nav).toHaveAttribute('aria-expanded', 'false');
});

test('sections survive reload, search their names, and leave the underlying rules intact', async ({ page }) => {
    await ready(page);
    await page.locator('[data-rn-key="regex"]').click();
    const original = await ruleState(page);
    await expect(row(page, 'preset-regex').locator('xpath=ancestor::section[1]').locator('.chlo-regex-section-name')).toHaveText('Regex QA');
    await expect(row(page, 'loom-widget').locator('xpath=ancestor::section[1]').locator('.chlo-regex-section-name')).toHaveText('Regex QA / Widgets');
    await addSection(page, 'Layout & widgets');
    await addSection(page, 'Prose cleanup');
    await row(page, 'widget').getByRole('button', { name: 'Script tools' }).click();
    await row(page, 'widget').getByLabel('Section').selectOption({ label: 'Layout & widgets' });
    await expect(drawer(page).locator('.chlo-regex-section').filter({ hasText: 'Layout & widgets' }).locator('[data-regex-id="widget"]')).toBeVisible();
    await drawer(page).getByRole('searchbox').fill('Layout & widgets');
    await expect(drawer(page).locator('.regex-script-label')).toHaveCount(1);
    await expect(row(page, 'widget')).toBeVisible();
    await drawer(page).getByRole('searchbox').clear();
    expect(await ruleState(page)).toEqual(original);
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).extension_settings.chloRegexLayout?.sections?.length).toBe(2);
    await ready(page);
    await page.locator('[data-rn-key="regex"]').click();
    await expect(row(page, 'widget').locator('xpath=ancestor::section[1]')).toContainText('Layout & widgets');
    await scopes(page).getByRole('button', { name: 'Preset', exact: true }).click();
    await expect(row(page, 'preset-regex')).toBeVisible();
    await expect(row(page, 'widget')).toHaveCount(0);
    await expect(drawer(page).getByLabel('Allow scripts from this preset')).not.toBeChecked();
    await row(page, 'preset-regex').getByRole('switch').click();
    await expect(row(page, 'preset-regex').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(drawer(page).getByLabel('Allow scripts from this preset')).not.toBeChecked();
    await row(page, 'preset-regex').getByRole('switch').click();
    await expect(row(page, 'preset-regex').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('inline editing keeps the rule in its section; only Run order changes execution', async ({ page }) => {
    await ready(page);
    await page.locator('[data-rn-key="regex"]').click();
    await row(page, 'widget').getByRole('button', { name: 'Render scene widget' }).click();
    await row(page, 'widget').getByLabel('Replace With').fill('[Scene widget]');
    await row(page, 'widget').getByRole('button', { name: 'Save script' }).click();
    await expect(row(page, 'widget').locator('form')).toHaveCount(0);
    await expect(row(page, 'widget').locator('xpath=ancestor::section[1]')).toContainText('Layout & widgets');
    await expect(row(page, 'widget').getByRole('button', { name: 'Render scene widget' })).toBeFocused();
    const before = await ruleState(page);
    expect(before.find(rule => rule.id === 'widget')?.replaceString).toBe('[Scene widget]');
    await tools(page).click();
    await drawer(page).getByRole('button', { name: 'Run order' }).click();
    await expect(drawer(page).locator('#saved_regex_scripts .regex-script-label')).toHaveCount(3);
    await row(page, 'widget').getByRole('button', { name: 'Move script up' }).click();
    await expect.poll(async () => (await ruleState(page)).slice(0, 3).map(rule => rule.id)).toEqual(['normalize', 'widget', 'markers']);
    await drawer(page).getByRole('button', { name: 'Back to sections' }).click();
    await expect(row(page, 'widget').locator('xpath=ancestor::section[1]')).toContainText('Layout & widgets');
});

test('the native toolbar opens the same drawer on a small screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await ready(page);
    await page.locator('#regex-drawer-button > button').click();
    await expect(drawer(page)).toBeVisible();
    const position = await drawer(page).boundingBox();
    expect(position.x).toBe(0);
    expect(position.width).toBeLessThanOrEqual(320);
    const switchPositions = await scopes(page).getByRole('switch').evaluateAll(switches => switches.map(button => button.getBoundingClientRect().right));
    expect(switchPositions).toHaveLength(4);
    expect(Math.max(...switchPositions)).toBeLessThanOrEqual(320);
    await expect(row(page, 'widget')).toBeVisible();
    await drawer(page).getByText('+ New script', { exact: true }).click();
    await drawer(page).getByRole('button', { name: 'Global script', exact: true }).click();
    const newScript = drawer(page).locator('#chlo-regex-new-editor');
    await newScript.getByLabel('Script Name').fill('Trim margins');
    await newScript.getByLabel('Find Regex', { exact: true }).fill('/ +$/g');
    await newScript.getByRole('button', { name: 'Save script' }).click();
    await expect(drawer(page).getByRole('button', { name: 'Trim margins' })).toBeVisible();

    await tools(page).click();
    await drawer(page).getByRole('button', { name: 'Debugger', exact: true }).click();
    const debuggerPopup = page.locator('#regex_debugger_popup');
    await debuggerPopup.locator('[data-id="normalize"] .edit_rule').click();
    const editor = page.locator('dialog[open]').filter({ has: page.locator('#regex_editor_template') });
    await editor.getByLabel('Replace With').fill('·');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await debuggerPopup.getByLabel('Raw Input').fill('A   quiet room.');
    await debuggerPopup.getByRole('button', { name: 'Run Test' }).click();
    await expect(debuggerPopup.locator('#regex_debugger_final_output')).toHaveText('A·quiet room.');
});

test('the All switch saves individual rule states without changing preset permissions', async ({ page }) => {
    await ready(page);
    const open = () => page.locator('[data-rn-key="regex"]').click();
    const master = scopeSwitch(page, 'all');
    const preset = drawer(page).getByRole('switch', { name: 'Allow scripts from this preset' });
    const applyRules = () => page.evaluate(async () => {
        const { getRegexedString, regex_placement } = await import('/scripts/extensions/regex/engine.js');
        return getRegexedString('A   sample [note]', regex_placement.AI_OUTPUT, { isMarkdown: true });
    });
    const selectPreset = name => page.evaluate(async name => {
        const { getPresetManager } = await import('/scripts/preset-manager.js');
        const manager = getPresetManager();
        await manager.selectPreset(manager.findPreset(name));
    }, name);
    await open();
    await expect(preset).not.toBeChecked();
    const globalOnly = await applyRules();
    expect(globalOnly).toMatch(/^A[ ·]sample \[note\]$/);
    await preset.check();
    await expect.poll(applyRules).toBe(globalOnly.replace('sample', 'preset'));
    await expect(master).toHaveAttribute('data-mixed', '');
    await master.click();
    await expect.poll(applyRules).toBe('A   sample [note]');
    await expect(row(page, 'normalize').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(row(page, 'preset-regex').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect((await ruleState(page)).every(rule => rule.disabled)).toBe(true);
    await expect(preset).toBeChecked();
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).extension_settings.regex.every(rule => rule.disabled)).toBe(true);
    await ready(page);
    await open();
    await expect(master).not.toBeChecked();
    await expect(row(page, 'preset-regex').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await master.click();
    await expect(row(page, 'markers').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect((await ruleState(page)).every(rule => !rule.disabled)).toBe(true);
    const allEnabled = globalOnly.replace('[note]', '');
    await expect.poll(applyRules).toBe(allEnabled.replace('sample', 'preset'));
    await preset.uncheck();
    await expect.poll(applyRules).toBe(allEnabled);
    await selectPreset('Other Regex QA');
    await expect(drawer(page).locator('.chlo-regex-preset-name')).toHaveText('Other Regex QA');
    await expect(preset).toBeChecked();
    await expect.poll(applyRules).toBe(allEnabled.replace('sample', 'other'));
    await selectPreset('Regex QA');
    await expect(drawer(page).locator('.chlo-regex-preset-name')).toHaveText('Regex QA');
    await expect(preset).not.toBeChecked();
    await expect.poll(applyRules).toBe(allEnabled);
});

test('the separate scope switches update only their matching rules, even when filtered', async ({ page }) => {
    await ready(page);
    const nav = page.locator('[data-rn-key="regex"]');
    await nav.click();
    await expect(scopeSwitch(page, 'character')).toBeDisabled();
    await drawer(page).getByRole('button', { name: 'Close Regex' }).click();
    await page.evaluate(async rule => {
        const ctx = SillyTavern.getContext();
        const form = new FormData();
        form.set('ch_name', 'Regex Scope QA');
        form.set('first_mes', 'Hello from Regex Scope QA.');
        const response = await fetch('/api/characters/create', { method: 'POST', headers: ctx.getRequestHeaders({ omitContentType: true }), body: form });
        if (!response.ok) throw new Error(`Could not create the regex test character: ${response.status}`);
        await ctx.getCharacters();
        const id = ctx.characters.findIndex(card => card.name === 'Regex Scope QA');
        const { accountStorage } = await import('/scripts/util/AccountStorage.js');
        accountStorage.setItem(`AlertRegex_${ctx.characters[id].avatar}`, 'true');
        await ctx.writeExtensionField(id, 'regex_scripts', [rule]);
        await ctx.selectCharacterById(id);
    }, script('scope-character', 'Character cleanup', '/sample/g', 'character'));
    await nav.click();

    const expectRule = async (id, enabled) => {
        await expect.poll(async () => (await ruleState(page)).find(rule => rule.id === id)?.disabled).toBe(!enabled);
    };
    const setScope = async (scope, enabled) => {
        const control = scopeSwitch(page, scope);
        await expect(control).toBeEnabled();
        await expect(control).toHaveAttribute('aria-checked', String(!enabled));
        await control.click();
        await expect(control).toHaveAttribute('aria-checked', String(enabled));
        await expect(control).toBeEnabled();
    };
    for (const scope of ['global', 'preset', 'character']) {
        await expect(scopeSwitch(page, scope)).toHaveAttribute('aria-checked', 'true');
    }
    await scopes(page).getByRole('button', { name: 'Preset', exact: true }).click();
    await drawer(page).getByRole('searchbox').fill('Preset-only cleanup');
    await setScope('preset', false);
    await expect(row(page, 'preset-regex').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(scopes(page).getByRole('button', { name: 'Preset', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectRule('loom-widget', false);
    await expectRule('normalize', true);
    await expectRule('scope-character', true);

    await setScope('global', false);
    await expectRule('normalize', false);
    await expectRule('scope-character', true);
    await setScope('character', false);
    await expectRule('scope-character', false);
    await expect(scopeSwitch(page, 'all')).not.toBeChecked();
    await setScope('character', true);
    await expectRule('scope-character', true);
    await expectRule('normalize', false);
    await expectRule('preset-regex', false);

    await setScope('all', false);
    await expectRule('scope-character', false);
    await setScope('all', true);
    await expectRule('scope-character', true);
    await expectRule('normalize', true);
    await expectRule('preset-regex', true);
});

test('the drawer attributes installed and declared sources without guessing from rule names', async ({ page }) => {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
    const settings = saved.extension_settings;
    settings.disabledExtensions.push('third-party/SillyTavern-Worldhopper');
    settings.worldhopper = { codex: { displayScripts: { 'wh-body-lines': 'recorded-version' } } };
    const example = settings.regex[0];
    settings.regex.push(
        { ...example, id: 'wh-body-lines', scriptName: 'My renamed body rules' },
        { ...example, id: 'wh-possession-box', scriptName: 'WH - Possession' },
        { ...example, id: 'book-regex', scriptName: 'Formatting', chlo_regex_source: { type: 'lorebook', name: 'Test Codex' } },
        { ...example, id: 'lookalike', scriptName: 'WH - Possession' },
    );
    await writeFile(settingsPath, JSON.stringify(saved));
    await ready(page);
    await page.locator('[data-rn-key="regex"]').click();
    const title = id => row(page, id).locator('xpath=ancestor::section[1]').locator('.chlo-regex-section-name');
    await expect(title('wh-body-lines')).toHaveText('Worldhopper Engine');
    await expect(row(page, 'wh-body-lines').locator('.chlo-regex-source')).toHaveText('Extension: Worldhopper Engine');
    await expect(row(page, 'wh-possession-box').locator('.chlo-regex-source')).toHaveAttribute('title', /imported manually/);
    await expect(title('book-regex')).toHaveText('Test Codex');
    await expect(row(page, 'book-regex').locator('.chlo-regex-source')).toHaveText('Lorebook: Test Codex');
    await expect(title('lookalike')).toHaveText('Ungrouped');
    await row(page, 'lookalike').getByRole('button', { name: 'Script tools' }).click();
    await expect(row(page, 'lookalike').locator('.chlo-regex-source-detail')).toHaveText('Global settings · original source unknown');
});

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const publicRoot = new URL('../../public/', import.meta.url);
const mapping = JSON.parse(await readFile(new URL('../../src/chlolirium/lucide-map.json', import.meta.url), 'utf8'));
let server;
let url;

test.use({ video: 'off' });

test.beforeAll(async () => {
    server = createServer(async (request, response) => {
        if (request.url === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html><body></body></html>');
            return;
        }
        const file = new URL('.' + new URL(request.url, 'http://localhost').pathname, publicRoot);
        if (!file.href.startsWith(publicRoot.href)) {
            response.writeHead(403).end();
            return;
        }
        try {
            const content = await readFile(file);
            const type = file.pathname.endsWith('.css') ? 'text/css' : 'application/octet-stream';
            response.writeHead(200, { 'Content-Type': type }).end(content);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
});

test.beforeEach(async ({ page }) => {
    await page.goto(url);
    await page.setContent(`<html data-icon-set="lucide"><head>
        <link rel="stylesheet" href="${url}/css/fontawesome.min.css">
        <link rel="stylesheet" href="${url}/css/solid.min.css">
        <link rel="stylesheet" href="${url}/css/brands.min.css">
        <link rel="stylesheet" href="${url}/css/chlolirium-icons.css">
        <style>body { color: rgb(220, 200, 180); } .sample { font-size:20px; margin:3px; }</style>
    </head><body></body></html>`);
    await page.evaluate(() => document.fonts.ready);
});

test('native aliases render Lucide without changing icon color or fixed-width controls', async ({ page }) => {
    const results = await page.evaluate(mapping => {
        return Object.entries(mapping).map(([alias, name]) => {
            const icon = document.createElement('i');
            icon.className = `sample fa-solid fa-fw ${alias}`;
            document.body.append(icon);
            const style = getComputedStyle(icon, '::before');
            return { alias, name, mask: decodeURIComponent(style.maskImage), width: style.width, color: style.backgroundColor, box: icon.getBoundingClientRect().width };
        });
    }, mapping);
    expect(results).toHaveLength(Object.keys(mapping).length);
    for (const result of results) {
        expect(result.mask, result.alias).toContain(`lucide-${result.name}`);
        expect(result.width, result.alias).toBe('20px');
        expect(result.box, result.alias).toBe(25);
        expect(result.color, result.alias).toBe('rgb(220, 200, 180)');
    }
});

test('class-based state changes preserve the control and its existing event handler', async ({ page }) => {
    await page.evaluate(() => {
        const button = document.createElement('button');
        button.className = 'sample fa-solid fa-eye';
        button.id = 'visibility';
        button.setAttribute('aria-label', 'Toggle visibility');
        button.addEventListener('click', () => {
            button.classList.toggle('fa-eye');
            button.classList.toggle('fa-eye-slash');
            button.dataset.clicks = String(Number(button.dataset.clicks || 0) + 1);
        });
        document.body.append(button);
    });
    const button = page.getByRole('button', { name: 'Toggle visibility' });
    const original = await button.elementHandle();
    const before = await button.evaluate(el => getComputedStyle(el, '::before').maskImage);
    await button.click();
    const after = await button.evaluate(el => getComputedStyle(el, '::before').maskImage);
    expect(after).not.toBe(before);
    expect(decodeURIComponent(after)).toContain('lucide-eye-off');
    await expect(button).toHaveAttribute('data-clicks', '1');
    expect(await button.evaluate((el, original) => el === original, original)).toBe(true);
});

test('brands and unmapped third-party icons retain their font fallback', async ({ page }) => {
    const results = await page.evaluate(() => {
        return ['fa-brands fa-github', 'fa-solid fa-snowflake'].map(classes => {
            const icon = document.createElement('i');
            icon.className = classes;
            document.body.append(icon);
            const style = getComputedStyle(icon, '::before');
            return { mask: style.maskImage, content: style.content };
        });
    });
    for (const result of results) {
        expect(result.mask).toBe('none');
        expect(result.content).not.toBe('none');
        expect(result.content).not.toBe('""');
    }
});

test('Moonlit masks use Lucide at 20px while portrait controls stay portrait-first', async ({ page }) => {
    // Moonlit Courtyard Suit 1.1.5's mask/portrait contract. Load after core CSS,
    // matching how installed extensions are loaded by SillyTavern.
    await page.addStyleTag({ content: `
        body.rivelle-navigator-icons-enabled [data-rn-key="api"] .rn-native-visual { --rni-icon:url("old-moonlit.svg"); }
        body.rivelle-navigator-icons-enabled #rn-left-rail [data-rn-key] .rn-native-visual { font-size:0!important; }
        body.rivelle-navigator-icons-enabled #rn-left-rail [data-rn-key] .rn-native-visual::before {
            content:""!important; width:20px!important; height:20px!important; display:block!important;
            -webkit-mask-image:var(--rni-icon)!important; mask-image:var(--rni-icon)!important;
        }
        body.rivelle-navigator-icons-enabled.rivelle-navigator-enabled #rightNavHolder > .drawer-toggle:not(.stcs--char)::before {
            content:""!important; width:20px!important; height:20px!important;
            mask-image:url("old-character.svg")!important;
        }
    ` });
    const result = await page.evaluate(() => {
        document.body.className = 'rivelle-navigator-icons-enabled rivelle-navigator-enabled';
        document.body.innerHTML = `<div id="rn-left-rail"><button data-rn-key="api"><span class="rn-native-visual fa-solid fa-plug"></span></button></div>
            <div id="rightNavHolder"><div class="drawer-toggle stcs--char"><img alt="Character portrait"></div></div>`;
        const icon = document.querySelector('.rn-native-visual');
        const style = getComputedStyle(icon, '::before');
        const portrait = document.querySelector('.stcs--char');
        return { mask: decodeURIComponent(style.maskImage), width: style.width, height: style.height, portraitMask: getComputedStyle(portrait, '::before').maskImage, portraitDisplay: getComputedStyle(portrait.firstChild).display };
    });
    expect(result.mask).toContain('lucide-plug');
    expect(result.width).toBe('20px');
    expect(result.height).toBe('20px');
    expect(result.portraitMask).toBe('none');
    expect(result.portraitDisplay).not.toBe('none');
});

test('toggle and background pseudo-icons retain separate active, inactive, and locked states', async ({ page }) => {
    const result = await page.evaluate(() => {
        document.body.innerHTML = '<button class="menu_button toggleable toggled"></button><div class="bg_example selected-background locked-background"></div>';
        const toggle = document.querySelector('button');
        const background = document.querySelector('.bg_example');
        const mask = (el, pseudo = '::before') => decodeURIComponent(getComputedStyle(el, pseudo).maskImage);
        const active = mask(toggle);
        toggle.classList.remove('toggled');
        return { active, inactive: mask(toggle), selected: mask(background), locked: mask(background, '::after') };
    });
    expect(result.active).toContain('lucide-check');
    expect(result.inactive).toContain('lucide-x');
    expect(result.selected).toContain('lucide-check');
    expect(result.locked).toContain('lucide-lock');
});

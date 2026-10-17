let initialized = false;

export function initEmojiPicker() {
    if (initialized) return;
    initialized = true;
    // Based on Cohee1207's Emoji Picker. Emoji Mart and its data remain local.
    const textarea = document.getElementById('send_textarea');
    const container = document.getElementById('rightSendForm');
    let pickerPromise;
    let picker;

    async function readJson(relativePath) {
        const response = await fetch(new URL(relativePath, import.meta.url));
        if (!response.ok) throw new Error(`Emoji data could not load (${response.status}).`);
        return response.json();
    }

    function insertEmoji(emoji) {
        if (!emoji.native) return;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        textarea.setRangeText(emoji.native, start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus({ preventScroll: true });
    }

    const button = document.getElementById('addEmojiButton');

    const panel = document.createElement('section');
    panel.id = 'chlo-emoji-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Emoji picker');
    const useTopLayer = typeof panel.showPopover === 'function';
    if (useTopLayer) panel.setAttribute('popover', 'manual');
    panel.innerHTML = `
        <div class="chlo-emoji-heading">
            <span>Emoji</span>
            <button type="button" class="chlo-emoji-close fa-solid fa-xmark interactable" aria-label="Close emoji picker" title="Close emoji picker"></button>
        </div>
        <div class="chlo-emoji-status" role="status">Loading emoji…</div>
    `;

    function closePicker() {
        if (useTopLayer) panel.hidePopover();
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        textarea.focus({ preventScroll: true });
    }

    function positionPanel() {
        if (panel.hidden) return;
        const viewport = window.visualViewport;
        const height = viewport?.height || window.innerHeight;
        const offset = viewport?.offsetTop || 0;
        panel.style.setProperty('--chlo-emoji-viewport-height', `${height}px`);
        if (useTopLayer) {
            // Remain above the phone's onscreen keyboard when it reduces the
            // visual viewport without resizing the layout viewport.
            panel.style.bottom = `max(${Math.max(3, window.innerHeight - height - offset + 3)}px, env(safe-area-inset-bottom))`;
        } else {
            // Older browsers: ST's transformed, zero-height html on mobile makes
            // bottom-fixed children anchor above the screen. Use an explicit top.
            panel.style.bottom = 'auto';
            panel.style.top = `${Math.max(8, height - panel.getBoundingClientRect().height - 3) + offset}px`;
        }
    }

    async function ensurePicker() {
        if (pickerPromise) return pickerPromise;
        const status = panel.querySelector('.chlo-emoji-status');
        status.textContent = 'Loading emoji…';
        panel.setAttribute('aria-busy', 'true');
        pickerPromise = (async () => {
            const supported = ['ar', 'be', 'cs', 'de', 'en', 'es', 'fa', 'fi', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sa', 'tr', 'uk', 'vi', 'zh'];
            const language = (localStorage.getItem('language') || document.documentElement.lang || 'en').split('-')[0].toLowerCase();
            const locale = supported.includes(language) ? language : 'en';
            const [{ Picker }, data, i18n] = await Promise.all([
                import('./vendor/emoji-mart.min.js'),
                readJson('./vendor/data.json'),
                readJson(`./i18n/${locale}.json`),
            ]);
            picker = new Picker({
                data,
                i18n,
                locale,
                set: 'native',
                theme: 'dark',
                dynamicWidth: true,
                previewPosition: 'none',
                skinTonePosition: 'search',
                onEmojiSelect: insertEmoji,
            });
            picker.id = 'chlo-emoji-picker';
            panel.append(picker);
            status.hidden = true;
            return picker;
        })().catch(error => {
            pickerPromise = undefined;
            status.textContent = 'Could not load emoji. Close and reopen the picker to retry.';
            console.error('[Emoji Picker]', error);
            throw error;
        }).finally(() => panel.removeAttribute('aria-busy'));
        return pickerPromise;
    }

    if (textarea instanceof HTMLTextAreaElement && container && button) {
        document.body.append(panel);
        button.addEventListener('click', async () => {
            if (!panel.hidden) {
                closePicker();
                return;
            }
            panel.hidden = false;
            if (useTopLayer) panel.showPopover();
            positionPanel();
            button.setAttribute('aria-expanded', 'true');
            try {
                await ensurePicker();
                // Only focus search after the custom element has rendered; a close
                // during loading must not pull focus back into the hidden picker.
                requestAnimationFrame(() => {
                    if (!panel.hidden) picker.shadowRoot?.querySelector('input[type="search"]')?.focus();
                });
            } catch {
                // The status inside the panel already explains how to retry.
            }
        });
        panel.querySelector('.chlo-emoji-close').addEventListener('click', closePicker);
        new ResizeObserver(positionPanel).observe(panel);
        window.addEventListener('resize', positionPanel);
        window.visualViewport?.addEventListener('resize', positionPanel);
        window.visualViewport?.addEventListener('scroll', positionPanel);
        document.addEventListener('keydown', event => {
            if (!panel.hidden && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closePicker();
            }
        }, true);
    }
}

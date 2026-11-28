import { button, element, icon } from '../user-settings/components.js';

const sections = [
    ['reply', 'Reply & Context', 'Token limits, streaming, and prompt cost', 'align-left', [
        '#openai_max_context', '#openai_max_tokens', '#stream_toggle', '#n_openai', '#oai_max_context_unlocked',
        '#openrouter_middleout', '#openrouter_max_prompt_cost', '#electronhub_max_prompt_cost', '#chutes_max_prompt_cost',
    ]],
    ['sampling', 'Sampling', 'Temperature, token filters, penalties, and seed', 'sliders', [
        '#temp_openai', '#top_p_openai', '#top_k_openai', '#min_p_openai', '#top_a_openai',
        '#freq_pen_openai', '#pres_pen_openai', '#repetition_penalty_openai', '#seed_openai',
    ]],
    ['reasoning', 'Reasoning', 'Model reasoning, effort, and verbosity', 'brain', [
        '#openai_show_thoughts', '#openai_reasoning_effort', '#tool_reasoning_mode', '#openai_verbosity',
    ]],
    ['tools', 'Tools & Media', 'Web search, function calls, and attachments', 'puzzle-piece', [
        '#openai_enable_web_search', '#openai_function_calling', '#openai_media_inlining', '#openai_request_images',
    ]],
    ['format', 'Prompts & Formatting', 'Character names, prefills, and utility prompts', 'file-lines', [
        '#character_names_display', '#continue_postfix_display', '#continue_prefill', '#squash_system_messages',
        '#use_sysprompt', '#claude_assistant_prefill', '#main_prompt_quick_edit_textarea', '#impersonation_prompt_textarea',
    ]],
    ['advanced', 'Advanced', 'Logit bias and panel layout', 'gear', []],
];

let workspace;

function findRows(root) {
    const ranges = root.querySelector('#range_block_openai');
    const settings = root.querySelector('#openai_settings');
    const options = settings?.querySelector('#character_names_display')?.closest('.inline-drawer')?.parentElement;
    const rows = [
        ...Array.from(ranges?.children ?? []),
        ...Array.from(options?.children ?? []),
        ...Array.from(settings?.children ?? []).filter(node => node !== options),
        ...Array.from(root.children).filter(node => node !== ranges && node !== settings),
    ];
    const selectors = sections.filter(([, , , , ids]) => ids.length)
        .map(([id, , , , ids]) => [id, ids.join(',')]);
    return {
        rows: rows.map(node => {
            const match = selectors.find(([, selector]) => node.matches(selector) || node.querySelector(selector));
            return { node, section: node.tagName === 'HR' ? null : (match?.[0] ?? 'advanced') };
        }),
        buckets: [ranges, settings, options].filter(Boolean),
    };
}

/** Group native controls without moving them out of their provider containers. */
function createWorkspace(root) {
    const { rows, buckets } = findRows(root);
    const overview = element('div', 'chlo-parameter-overview');
    overview.setAttribute('role', 'group');
    overview.setAttribute('aria-label', 'Parameter groups');
    const header = element('header', 'chlo-parameter-header');
    const heading = element('h3', 'chlo-parameter-heading');
    heading.tabIndex = -1;
    const back = button('All parameters', () => show(null, true), 'arrow-left');
    const help = button('Show help', () => {
        const expanded = root.classList.toggle('chlo-parameter-show-help');
        help.setAttribute('aria-pressed', String(expanded));
    });
    const empty = element('p', 'chlo-parameter-empty', 'No controls in this section for the selected provider.');
    help.setAttribute('aria-pressed', 'false');
    header.append(back, heading, help);
    root.prepend(overview, header, empty);

    const cards = new Map();
    for (const [id, title, subtitle, glyph] of sections) {
        const card = button(title, () => show(id, true));
        card.classList.add('chlo-parameter-card');
        card.dataset.parameterSection = id;
        const copy = element('span', 'chlo-parameter-card-copy');
        copy.append(element('strong', '', title), element('small', '', subtitle));
        card.replaceChildren(icon(glyph), copy, icon('chevron-right'));
        overview.append(card);
        cards.set(id, card);
    }

    let current = null;
    let last = null;
    function updateAvailability() {
        empty.hidden = current === null || rows.some(({ node, section }) =>
            section === current && !node.hidden && getComputedStyle(node).display !== 'none');
    }

    function show(section, moveFocus = false) {
        if (current !== null) last = current;
        current = section;
        overview.hidden = section !== null;
        header.hidden = section === null;
        heading.textContent = sections.find(([id]) => id === section)?.[1] ?? '';

        for (const row of rows) {
            row.node.classList.toggle('chlo-parameter-hidden', section === null || row.section !== section);
        }
        for (const bucket of buckets) {
            bucket.classList.toggle('chlo-parameter-hidden', section === null || !rows.some(row => row.section === section && bucket.contains(row.node)));
        }
        updateAvailability();
        root.closest('.scrollableInner')?.scrollTo({ top: 0 });
        if (moveFocus) (section === null ? cards.get(last) : heading)?.focus({ preventScroll: true });
    }

    function onKeyDown(event) {
        if (event.key !== 'Escape' || current === null || event.defaultPrevented || event.target.closest('dialog')) return;
        event.preventDefault();
        event.stopPropagation();
        show(null, true);
    }

    root.classList.add('chlo-parameter-workspace');
    for (const { node } of rows) node.classList.add('chlo-parameter-row');
    root.addEventListener('keydown', onKeyDown);
    const providerVisibility = new MutationObserver(updateAvailability);
    for (const { node } of rows) providerVisibility.observe(node, { attributes: true, attributeFilter: ['style', 'hidden'] });
    show(null);
    return {
        root,
        reset: () => show(null),
        destroy() {
            providerVisibility.disconnect();
            root.removeEventListener('keydown', onKeyDown);
            root.classList.remove('chlo-parameter-workspace', 'chlo-parameter-show-help');
            for (const { node } of rows) node.classList.remove('chlo-parameter-row', 'chlo-parameter-hidden');
            for (const bucket of buckets) bucket.classList.remove('chlo-parameter-hidden');
            overview.remove();
            header.remove();
            empty.remove();
        },
    };
}

export function mountParameterWorkspace(root) {
    if (workspace?.root === root) return;
    workspace?.destroy();
    workspace = root ? createWorkspace(root) : undefined;
}

export function resetParameterWorkspace() {
    workspace?.reset();
}

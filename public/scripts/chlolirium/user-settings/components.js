export function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function icon(name) {
    const node = element('i', `fa-solid fa-${name}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

export function button(title, action, glyph) {
    const node = element('button', 'chlo-settings-button', glyph ? '' : title);
    node.type = 'button';
    if (glyph) {
        node.append(icon(glyph));
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    node.addEventListener('click', action);
    return node;
}

export const byId = id => document.getElementById(id);

export function move(to, ...nodes) {
    for (const node of nodes) if (node) to.append(node);
}

export function check(id) {
    return byId(id)?.closest('label') ?? byId(id)?.parentElement;
}

export function group(root, title) {
    const section = element('section', 'chlo-appearance-group');
    section.append(element('h4', '', title));
    root.append(section);
    return section;
}

export function labelInput(input, name) {
    if (!input) return;
    input.dataset.settingLabel = name;
    input.setAttribute('aria-label', name);
}

export function selectRow(root, id, title) {
    const input = byId(id);
    if (!input) return;
    const row = element('div', 'chlo-appearance-choice');
    const label = element('label', '', title);
    label.htmlFor = id;
    const previousLabel = input.labels?.[0] ?? input.previousElementSibling;
    if (previousLabel) input.dataset.settingAliases = previousLabel.textContent.trim();
    labelInput(input, title);
    row.append(label, input);
    root.append(row);
}

export function nativeRange(root, id, title) {
    const slider = byId(id);
    const value = byId(`${id}_counter`);
    if (!slider || !value) return;
    const label = element('label', '', title);
    const row = element('div', 'chlo-appearance-range');
    label.htmlFor = id;
    slider.dataset.settingAliases = slider.parentElement.querySelector('small')?.textContent.trim() ?? '';
    labelInput(slider, title);
    value.setAttribute('aria-label', `${title} value`);
    row.append(label, slider, value);
    root.append(row);
}

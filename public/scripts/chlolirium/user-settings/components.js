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

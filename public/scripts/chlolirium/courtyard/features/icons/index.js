import { createObserverRegistry } from '../../core/runtime.js';

const observers = createObserverRegistry();

function ensureWorldInfoIcon() {
    const trigger = document.querySelector('#rn-top-worldinfo > .stwii--trigger');
    if (!trigger || trigger.querySelector(':scope > .rni-worldinfo-icon')) return;
    const icon = document.createElement('span');
    icon.className = 'rni-worldinfo-icon';
    icon.setAttribute('aria-hidden', 'true');
    trigger.prepend(icon);
}

export function refresh() {
    const host = document.querySelector('#rn-top-worldinfo');
    observers.observe('world-info-host', host, { childList: true }, ensureWorldInfoIcon);
    ensureWorldInfoIcon();
}

export function init() {
    document.body.classList.add('rivelle-navigator-icons-enabled');
    refresh();
}

export function cleanup() {
    observers.disconnect();
}

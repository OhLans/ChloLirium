import { features } from './features.js';
import * as navigator from './features/navigator/index.js';
import * as characterPanels from './features/character-panels/index.js';
import * as personaPanels from './features/persona-panels/index.js';
import * as icons from './features/icons/index.js';
import { createFrameTask, onSillyTavernEvents, refreshEventBindings, disposeEventBindings } from './core/runtime.js';

const modules = [];
const startupTimers = [];
let started = false;

function refresh() {
    refreshEventBindings();
    for (const feature of modules) feature.refresh();
}

const scheduleRefresh = createFrameTask(refresh);

function init() {
    if (started) return;
    started = true;

    // The SVG flag is available before Navigator builds its native fallbacks.
    if (features.navigator && features.icons) {
        icons.init();
        modules.push(icons);
    }
    if (features.navigator) {
        navigator.init();
        modules.push(navigator);
        if (features.icons) icons.refresh();
    }
    if (features.characterPanels) {
        characterPanels.init();
        modules.push(characterPanels);
    }
    if (features.personaPanels) {
        personaPanels.init();
        modules.push(personaPanels);
    }

    onSillyTavernEvents(['APP_READY', 'EXTENSIONS_FIRST_LOAD'], scheduleRefresh);
    // One bounded startup sequence covers native/companion controls arriving
    // after this extension. All retries stop after 2.5 seconds.
    for (const delay of [150, 500, 1200, 2500]) {
        startupTimers.push(setTimeout(refresh, delay));
    }
    console.info('[Moonlit Courtyard Suit] v1.1.5 loaded');
}

window.addEventListener('pagehide', event => {
    // A cancelled native unsaved-changes prompt must leave the UI intact.
    // A page stored in the back/forward cache also retains its live handlers.
    if (event.persisted) return;
    startupTimers.forEach(clearTimeout);
    scheduleRefresh.cancel();
    for (const feature of [...modules].reverse()) feature.cleanup();
    disposeEventBindings();
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}

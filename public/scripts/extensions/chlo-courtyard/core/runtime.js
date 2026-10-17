// Small shared helpers. No polling and no observer of the document subtree.
export function getContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

// A burst of related native events does one update in the next frame.
export function createFrameTask(callback) {
    let frame = 0;
    const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            callback();
        });
    };
    schedule.cancel = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
    };
    return schedule;
}

// Refresh registrations when an optional extension replaces a native node.
// Repeated setup on the same node does not add another observer.
export function createObserverRegistry() {
    const entries = new Map();
    return {
        observe(key, node, options, callback) {
            const previous = entries.get(key);
            if (previous?.node === node) return;
            previous?.observer.disconnect();
            entries.delete(key);
            if (!node) return;
            const observer = new MutationObserver(callback);
            observer.observe(node, options);
            entries.set(key, { node, observer });
        },
        disconnect() {
            entries.forEach(({ observer }) => observer.disconnect());
            entries.clear();
        },
    };
}

// Native events are shared across features, with one upstream listener per
// event. A feature subscribes only to the events it uses.
const subscriptions = new Set();
const bindings = new Map();
let boundSource = null;

export function onSillyTavernEvents(keys, handler) {
    const subscription = { keys, handler };
    subscriptions.add(subscription);
    refreshEventBindings();
    return () => {
        subscriptions.delete(subscription);
        refreshEventBindings();
    };
}

export function refreshEventBindings() {
    const ctx = getContext();
    const source = ctx?.eventSource;
    const types = ctx?.eventTypes || ctx?.event_types;
    if (!source?.on || !types) return;

    if (source !== boundSource) {
        bindings.forEach((handler, name) => boundSource?.removeListener?.(name, handler));
        bindings.clear();
        boundSource = source;
    }

    const needed = new Set();
    subscriptions.forEach(({ keys }) => keys.forEach(key => {
        if (types[key]) needed.add(types[key]);
    }));
    bindings.forEach((handler, name) => {
        if (!needed.has(name)) {
            source.removeListener?.(name, handler);
            bindings.delete(name);
        }
    });
    needed.forEach(name => {
        if (bindings.has(name)) return;
        const handler = (...args) => {
            for (const subscription of subscriptions) {
                if (!subscription.keys.some(key => types[key] === name)) continue;
                try {
                    subscription.handler(...args);
                } catch (error) {
                    console.error('[Moonlit Courtyard] Feature event failed:', name, error);
                }
            }
        };
        bindings.set(name, handler);
        source.on(name, handler);
    });
}

export function disposeEventBindings() {
    bindings.forEach((handler, name) => boundSource?.removeListener?.(name, handler));
    bindings.clear();
    subscriptions.clear();
    boundSource = null;
}

// Avoid mutations when native events repeat the current state.
export function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
}

export function setAttribute(node, name, value) {
    if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function setHidden(node, hidden) {
    if (node && node.hidden !== hidden) node.hidden = hidden;
}

export function toggleClass(node, name, enabled) {
    if (node && node.classList.contains(name) !== Boolean(enabled)) {
        node.classList.toggle(name, Boolean(enabled));
    }
}

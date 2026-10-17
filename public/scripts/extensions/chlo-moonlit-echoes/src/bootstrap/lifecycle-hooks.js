const domReadyHandlers = new Set();
let hasRunDomReadyHandlers = false;

function defer(callback) {
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(callback);
    } else {
        setTimeout(callback, 0);
    }
}

function invokeGuardedHandler(handler, failureLabel) {
    try {
        handler();
    } catch (error) {
        console.error(failureLabel, error);
    }
}

function invokeDomReadyHandler(handler) {
    invokeGuardedHandler(handler, 'Moonlit Echoes DOM ready handler failed');
}

/**
 * Register a handler to run once the DOM is ready.
 * If the DOM is already ready, the handler runs on the next tick so module
 * initialization can finish before any startup work executes.
 *
 * @param {Function} handler - Function to invoke when DOM is ready.
 */
export function registerDomReadyHandler(handler) {
    if (typeof handler !== 'function') {
        return;
    }

    if (document.readyState === 'loading') {
        domReadyHandlers.add(handler);
    } else {
        defer(() => invokeDomReadyHandler(handler));
    }
}

/**
 * Register a handler to run once every element listed in `ids` is present in
 * the document. Hosts such as TauriTavern detach closed settings drawers from
 * the document tree, so controls living inside those panels (for example
 * `#chat_display`) may only become reachable after the panel is opened. The
 * handler runs exactly once: on the next tick when all elements are already
 * present, or when a later DOM mutation makes them available.
 *
 * @param {string[]} ids - Element ids the handler depends on.
 * @param {Function} handler - Function to invoke once all ids resolve.
 * @returns {Function} Disposer that cancels the pending registration.
 */
export function whenElementsAvailable(ids, handler) {
    if (typeof handler !== 'function') {
        return () => {};
    }

    const pendingIds = () => ids.filter((id) => !document.getElementById(id));

    const observer = new MutationObserver(() => {
        if (pendingIds().length === 0) {
            observer.disconnect();
            invokeGuardedHandler(handler, 'Moonlit Echoes element availability handler failed');
        }
    });

    if (pendingIds().length === 0) {
        defer(() => invokeGuardedHandler(handler, 'Moonlit Echoes element availability handler failed'));
    } else {
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    return () => observer.disconnect();
}

function runDomReadyHandlers() {
    if (hasRunDomReadyHandlers) {
        return;
    }

    hasRunDomReadyHandlers = true;
    domReadyHandlers.forEach((handler) => {
        invokeDomReadyHandler(handler);
    });
    domReadyHandlers.clear();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDomReadyHandlers, { once: true });
} else {
    defer(runDomReadyHandlers);
}

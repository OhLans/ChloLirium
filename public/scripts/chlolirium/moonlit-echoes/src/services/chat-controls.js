/**
 * Shared access to the host chat controls the extension augments.
 *
 * TauriTavern's panel runtime keeps closed settings drawers detached from the
 * document tree, so `document.getElementById` misses `#chat_display` while
 * its drawer is parked. The node itself stays alive, so once the chat display
 * switcher has resolved it we keep a reference for the rest of the session.
 *
 * @type {{ chatDisplaySelect?: HTMLSelectElement }}
 */
const chatControls = {};

/**
 * Publish the `#chat_display` element resolved by the chat display switcher.
 *
 * @param {HTMLSelectElement} chatDisplaySelect - Live chat display select element.
 */
export function registerChatDisplaySelect(chatDisplaySelect) {
    chatControls.chatDisplaySelect = chatDisplaySelect;
}

/**
 * Resolve the live `#chat_display` element even when its settings drawer is
 * currently detached from the document.
 *
 * @returns {HTMLSelectElement|null} The select element, or null when it has
 * never been reachable during this session.
 */
export function getChatDisplaySelect() {
    return document.getElementById('chat_display') ?? chatControls.chatDisplaySelect ?? null;
}

let messageDetailsInitialized = false;
let messageClickHandlersInitialized = false;

/** Native theme message controls. Appearance itself is edited in User Settings. */
export function initControls() {
    ensureMessageDetailsSystem();
    ensureMessageClickHandlers();
}

function ensureMessageDetailsSystem() {
    if (messageDetailsInitialized) return;
    messageDetailsInitialized = true;

    const init = () => {
        initMessageDetailsSystem();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}

function ensureMessageClickHandlers() {
    if (messageClickHandlersInitialized) return;
    initMessageClickHandlers();
    messageClickHandlersInitialized = true;
}

function initMessageDetailsSystem() {
    const messageElements = document.querySelectorAll('.mes');

    messageElements.forEach((message) => {
        message.addEventListener('click', function onMessageClick(event) {
            const isClickInsideDetails =
                event.target.closest('.ch_name') ||
                event.target.closest('.mesIDDisplay') ||
                event.target.closest('.mes_timer') ||
                event.target.closest('.tokenCounterDisplay') ||
                event.target.closest('.mes_reasoning_details');

            if (!isClickInsideDetails) {
                this.classList.toggle('show-details');

                if (this.classList.contains('show-details')) {
                    messageElements.forEach((otherMessage) => {
                        if (otherMessage !== this) {
                            otherMessage.classList.remove('show-details');
                        }
                    });
                }
            }
        });

        message.addEventListener('dblclick', function onMessageDoubleClick(event) {
            event.preventDefault();
            this.classList.remove('show-details');
        });
    });

    document.addEventListener('click', onDocumentClickForMessageDetails);
}

function initMessageClickHandlers() {
    document.addEventListener('click', onDocumentClickForMessageToggles);
}

function onDocumentClickForMessageDetails(event) {
    if (!event.target.closest('.mes')) {
        document.querySelectorAll('.mes.show-details').forEach((message) => {
            message.classList.remove('show-details');
        });
    }
}

function onDocumentClickForMessageToggles(event) {
    const messageElement = event.target.closest('.mes');

    if (messageElement) {
        const isClickInsideDetails =
            event.target.closest('.mesIDDisplay') ||
            event.target.closest('.mes_timer') ||
            event.target.closest('.tokenCounterDisplay');

        const isMessageActionButton =
            event.target.closest('.extraMesButtonsHint') ||
            event.target.closest('.mes_edit') ||
            event.target.closest('.mes_edit_buttons');

        if (event.target.tagName === 'A' || event.target.tagName === 'BUTTON' || isMessageActionButton) {
            if (isMessageActionButton) {
                messageElement.classList.add('active-message');
            }
            return;
        }

        if (!isClickInsideDetails) {
            messageElement.classList.toggle('active-message');
        }
    } else {
        document.querySelectorAll('.mes.active-message').forEach((activeMessage) => {
            activeMessage.classList.remove('active-message');
        });
    }
}

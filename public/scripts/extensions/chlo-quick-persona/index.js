import { animation_duration, eventSource, event_types, getThumbnailUrl } from '../../../script.js';
import { power_user } from '../../power-user.js';
import { getUserAvatar, getUserAvatars, setUserAvatar, user_avatar } from '../../personas.js';
import { Popper } from '../../../lib.js';

/** @type {Popper.Instance} */
let popper = null;
let isOpen = false;
let menuRequest = 0;

const supportsPersonaThumbnails = getThumbnailUrl('persona', 'test.png', true).includes('&t=');

function addQuickPersonaButton() {
    const quickPersonaButton = `
    <div id="quickPersona" class="interactable" tabindex="0">
        <img id="quickPersonaImg" src="/img/ai4.png" />
        <div id="quickPersonaCaret" class="fa-fw fa-solid fa-caret-up"></div>
    </div>`;
    $('#leftSendForm').append(quickPersonaButton);
    $('#quickPersona').on('click', () => {
        toggleQuickPersonaSelector();
    });
}

/**
 * Get the URL of the user avatar image.
 * @param {string} userAvatar The user avatar identifier
 * @returns {string} URL of the user avatar image
 */
function getImageUrl(userAvatar) {
    if (supportsPersonaThumbnails) {
        return getThumbnailUrl('persona', userAvatar, true);
    }
    return `${getUserAvatar(userAvatar)}?t=${Date.now()}`;
}

async function toggleQuickPersonaSelector() {
    if (isOpen) {
        closeQuickPersonaSelector();
        return;
    }
    await openQuickPersonaSelector();
}

async function openQuickPersonaSelector() {
    const request = ++menuRequest;
    isOpen = true;
    const userAvatars = await getUserAvatars(false);
    if (!isOpen || request !== menuRequest) return;
    const quickPersonaList = $('<div id="quickPersonaMenu"><ul class="list-group"></ul></div>');
    for (const userAvatar of userAvatars) {
        const personaName = power_user.personas[userAvatar] || userAvatar;
        const personaTitle = power_user.persona_descriptions[userAvatar]?.title || '';
        const imgUrl = getImageUrl(userAvatar);
        const imgTitle = personaTitle ? `${personaName} - ${personaTitle}` : personaName;
        const isSelected = userAvatar === user_avatar;
        const isDefault = userAvatar === power_user.default_persona;
        const listItem = $('<li tabindex="0" class="list-group-item interactable"><img class="quickPersonaMenuImg"/></li>');
        listItem.find('img').attr('src', imgUrl).attr('title', imgTitle).toggleClass('selected', isSelected).toggleClass('default', isDefault);
        listItem.on('click', async () => {
            closeQuickPersonaSelector();
            await setUserAvatar(userAvatar);
            changeQuickPersona();
        });
        quickPersonaList.find('ul').append(listItem);
    }
    quickPersonaList.hide();
    $(document.body).append(quickPersonaList);
    $('#quickPersonaCaret').toggleClass('fa-caret-up fa-caret-down');
    $('#quickPersonaMenu').fadeIn(animation_duration);
    popper = Popper.createPopper(document.getElementById('quickPersona'), document.getElementById('quickPersonaMenu'), {
        placement: 'top-start',
    });
    popper.update();
}

function closeQuickPersonaSelector() {
    menuRequest++;
    isOpen = false;
    $('#quickPersonaCaret').toggleClass('fa-caret-up fa-caret-down');
    $('#quickPersonaMenu').fadeOut(animation_duration, () => {
        $('#quickPersonaMenu').remove();
    });
    popper?.destroy();
    popper = null;
}

function changeQuickPersona() {
    setTimeout(() => {
        const personaName = power_user.personas[user_avatar] || user_avatar;
        const personaTitle = power_user.persona_descriptions[user_avatar]?.title || '';
        const imgUrl = getImageUrl(user_avatar);
        const imgTitle = personaTitle ? `${personaName} - ${personaTitle}` : personaName;
        $('#quickPersonaImg').attr('src', imgUrl).attr('title', imgTitle);
    }, 100);
}

jQuery(() => {
    addQuickPersonaButton();
    eventSource.on(event_types.CHAT_CHANGED, changeQuickPersona);
    eventSource.on(event_types.SETTINGS_UPDATED, changeQuickPersona);
    eventSource.on(event_types.PERSONA_CHANGED, changeQuickPersona);
    $(document.body).on('click', (e) => {
        if (isOpen && !e.target.closest('#quickPersonaMenu') && !e.target.closest('#quickPersona')) {
            closeQuickPersonaSelector();
        }
    });
    changeQuickPersona();
});

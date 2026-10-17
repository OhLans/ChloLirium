import {
    characters,
    event_types,
    eventSource,
    getThumbnailUrl,
    saveSettingsDebounced,
    selectCharacterById,
    setActiveCharacter,
    setActiveGroup,
    this_chid,
} from '../../../script.js';

import { extension_settings } from '../../extensions.js';
import { groups, openGroupById, selected_group } from '../../group-chats.js';
import { user_avatar } from '../../personas.js';


let characterTrigger = null;
let personaTrigger = null;
let currentCharacter = null;
let characterMenuOpen = false;
let portraitRequest = 0;


/*
 * Preserve existing Char Switch preferences when replacing the old extension.
 * The upstream extension historically used both charSwitch and charSwitchx.
 */
let settings;
let initialized = false;


const getCharacterTrigger = () =>
    document.querySelector('#rightNavHolder > .drawer-toggle');

const getPersonaTrigger = () =>
    document.querySelector('#persona-management-button > .drawer-toggle');


async function getCharacterAvatar(character) {
    if (!character) {
        return '/img/five.png';
    }

    if (character.avatar) {
        return `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`;
    }

    if (!character.members) {
        return '/img/five.png';
    }

    const members = [
        ...(character.members ?? []),
        ...(character.disabled_members ?? []),
    ].filter((item, index, list) => index === list.indexOf(item));

    if (members.length === 0) {
        return '/img/five.png';
    }

    if (members.length === 1) {
        return `/thumbnail?type=avatar&file=${encodeURIComponent(members[0])}`;
    }

    const count = Math.min(members.length, 4);
    const images = await Promise.all(
        members.slice(0, count).map(member => {
            const image = new Image();
            image.src = `/thumbnail?type=avatar&file=${encodeURIComponent(member)}`;

            return new Promise(resolve => {
                if (image.complete) {
                    resolve(image);
                    return;
                }

                const done = () => resolve(image);
                image.addEventListener('load', done, { once: true });
                image.addEventListener('error', done, { once: true });
            });
        }),
    );

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');

    if (images.length === 2) {
        const cropX = 96 * 0.25;
        const cropW = 47;

        ctx.drawImage(images[0], cropX, 0, cropW, 96, 0, 0, 47, 96);
        ctx.drawImage(images[1], cropX, 0, cropW, 96, 49, 0, 47, 96);
    } else if (images.length === 3) {
        ctx.drawImage(images[0], 0, 0, 96, 96, 0, 0, 47, 47);
        ctx.drawImage(images[1], 0, 0, 96, 96, 49, 0, 47, 47);
        ctx.drawImage(images[2], 0, 0, 96, 47, 0, 49, 96, 47);
    } else {
        const slots = [
            [0, 0],
            [49, 0],
            [0, 49],
            [49, 49],
        ];

        images.forEach((image, index) => {
            const [x, y] = slots[index];
            ctx.drawImage(image, 0, 0, 96, 96, x, y, 47, 47);
        });
    }

    return canvas.toDataURL();
}


async function updateCharacterPortrait() {
    if (!characterTrigger) return;
    const request = ++portraitRequest;

    currentCharacter =
        characters[this_chid] ??
        groups.find(group => group.id == selected_group) ??
        null;

    const showPortrait = Boolean(currentCharacter && settings.showAvatar);

    characterTrigger.classList.toggle('stcs--char', showPortrait);

    if (showPortrait) {
        const avatar = await getCharacterAvatar(currentCharacter);
        if (request !== portraitRequest) return;
        characterTrigger.style.setProperty(
            '--stcs--avatar',
            `url("${avatar}")`,
        );
    } else {
        characterTrigger.style.removeProperty('--stcs--avatar');
    }
}


function updatePersonaPortrait() {
    if (!personaTrigger) return;

    const showPortrait = Boolean(user_avatar && settings.showPersonaAvatar);
    personaTrigger.classList.toggle('stcs--char', showPortrait);

    if (showPortrait) {
        personaTrigger.style.setProperty(
            '--stcs--avatar',
            `url("${getThumbnailUrl('persona', user_avatar)}")`,
        );
    } else {
        personaTrigger.style.removeProperty('--stcs--avatar');
    }
}


function compareCards(a, b) {
    if (settings.showFavorites) {
        if (a.fav && !b.fav) return -1;
        if (!a.fav && b.fav) return 1;
    }

    return (b.date_last_chat ?? 0) - (a.date_last_chat ?? 0);
}


function closeCharacterMenu() {
    document.querySelector('.stis--ctxBlocker')?.remove();
    characterMenuOpen = false;
}


async function openCharacterMenu(event) {
    if (characterMenuOpen || !characterTrigger) return;

    event.preventDefault();
    event.stopPropagation();

    characterMenuOpen = true;

    const blocker = document.createElement('div');
    blocker.className = 'stis--ctxBlocker stcs--ctxBlocker';
    blocker.title = '';

    blocker.addEventListener('click', event => {
        event.stopPropagation();
        closeCharacterMenu();
    });

    const list = document.createElement('ul');
    list.className = 'stis--ctxMenu stcs--ctxMenu list-group';

    const cards = [...characters, ...groups]
        .filter(item => !settings.onlyFavorites || item.fav)
        .filter(item =>
            (item.avatar ?? item.id) !==
            (currentCharacter?.avatar ?? currentCharacter?.id),
        )
        .toSorted(compareCards)
        .slice(0, settings.numCards);

    for (const card of cards) {
        const item = document.createElement('li');
        item.className = 'stis--ctxItem stcs--ctxItem list-group-item';

        if (settings.highlightFavorites && card.fav) {
            item.classList.add('stcs--fav');
        }

        item.dataset.stcsChar = card.name;
        item.title = `Switch to "${card.name}"`;

        item.addEventListener('click', () => {
            if (card.members) {
                setActiveCharacter(null);
                setActiveGroup(card.id);
                openGroupById(card.id);
            } else {
                const characterIndex = characters.indexOf(card);
                setActiveCharacter(characterIndex);
                setActiveGroup(null);
                selectCharacterById(characterIndex);
            }

            saveSettingsDebounced();
            closeCharacterMenu();
        });

        const avatar = document.createElement('div');
        avatar.className = 'stis--ctxAvatar stcs--ctxAvatar';
        avatar.style.backgroundImage = `url("${await getCharacterAvatar(card)}")`;

        const name = document.createElement('div');
        name.className = 'stis--ctxName stcs--ctxName';
        name.textContent = card.name;

        item.append(avatar, name);
        list.append(item);
    }

    blocker.append(list);
    document.body.append(blocker);

    /*
     * Position after insertion, when we know the real menu dimensions.
     * This works both in stock SillyTavern and when Rivelle Navigator moves
     * the Character button to the far-right top bar.
     */
    requestAnimationFrame(() => {
        const triggerRect = characterTrigger.getBoundingClientRect();

        list.style.visibility = 'hidden';
        list.style.maxHeight = 'calc(100vh - 16px)';

        const menuRect = list.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const gap = 6;
        const edge = 8;

        let left = triggerRect.left;

        if (left + menuRect.width > viewportWidth - edge) {
            left = triggerRect.right - menuRect.width;
        }

        left = Math.max(edge, Math.min(left, viewportWidth - menuRect.width - edge));

        const belowTop = triggerRect.bottom + gap;
        const belowSpace = viewportHeight - belowTop - edge;
        const aboveSpace = triggerRect.top - gap - edge;

        if (menuRect.height <= belowSpace || belowSpace >= aboveSpace) {
            list.style.top = `${belowTop}px`;
            list.style.bottom = 'auto';
            list.style.maxHeight = `${Math.max(80, belowSpace)}px`;
        } else {
            list.style.top = 'auto';
            list.style.bottom = `${viewportHeight - triggerRect.top + gap}px`;
            list.style.maxHeight = `${Math.max(80, aboveSpace)}px`;
        }

        list.style.left = `${left}px`;
        list.style.right = 'auto';
        list.style.visibility = 'visible';
    });
}


function syncLayoutModeClass() {
    const discordLike =
        getComputedStyle(document.body).getPropertyValue('--nav-bar-width').trim() !== '';

    if (document.body.classList.contains('stcs') !== discordLike) document.body.classList.toggle('stcs', discordLike);
    if (document.body.classList.contains('stcs--nonDiscord') === discordLike) document.body.classList.toggle('stcs--nonDiscord', !discordLike);
}


function bindTriggers() {
    const nextCharacterTrigger = getCharacterTrigger();
    const nextPersonaTrigger = getPersonaTrigger();

    if (
        nextCharacterTrigger &&
        nextCharacterTrigger !== characterTrigger
    ) {
        characterTrigger?.removeEventListener('contextmenu', openCharacterMenu);

        characterTrigger = nextCharacterTrigger;
        characterTrigger.classList.add('stis--identity-toggle');
        characterTrigger.dataset.stisRole = 'character';
        characterTrigger.addEventListener('contextmenu', openCharacterMenu);

        updateCharacterPortrait();
    }

    if (
        nextPersonaTrigger &&
        nextPersonaTrigger !== personaTrigger
    ) {
        personaTrigger = nextPersonaTrigger;
        personaTrigger.classList.add('stis--identity-toggle');
        personaTrigger.dataset.stisRole = 'persona';

        updatePersonaPortrait();
    }
}


export function initIdentityControls() {
    if (initialized) return;
    initialized = true;
    settings = extension_settings.identitySwitch = Object.assign(
        { showAvatar: true, showPersonaAvatar: true, showFavorites: false, onlyFavorites: false, highlightFavorites: true, numCards: 10 },
        extension_settings.charSwitchx ?? {},
        extension_settings.charSwitch ?? {},
        extension_settings.identitySwitch ?? {},
    );
    const controls = {
        'chlo-character-portrait': 'showAvatar',
        'chlo-persona-portrait': 'showPersonaAvatar',
        'chlo-favorites-first': 'showFavorites',
        'chlo-favorites-only': 'onlyFavorites',
        'chlo-highlight-favorites': 'highlightFavorites',
    };
    for (const [id, key] of Object.entries(controls)) {
        const input = document.getElementById(id);
        input.checked = Boolean(settings[key]);
        input.addEventListener('change', () => {
            settings[key] = input.checked;
            updateCharacterPortrait();
            updatePersonaPortrait();
            closeCharacterMenu();
            saveSettingsDebounced();
        });
    }
    const count = document.getElementById('chlo-switcher-count');
    count.value = settings.numCards;
    count.addEventListener('change', () => {
        settings.numCards = Math.max(1, Math.min(100, Math.round(Number(count.value) || 10)));
        count.value = settings.numCards;
        closeCharacterMenu();
        saveSettingsDebounced();
    });
    bindTriggers();
    syncLayoutModeClass();
    updateCharacterPortrait();
    updatePersonaPortrait();

    eventSource.on(event_types.CHAT_CHANGED, () => {
        bindTriggers();
        updateCharacterPortrait();
    });

    eventSource.on(event_types.PERSONA_CHANGED, () => {
        bindTriggers();
        updatePersonaPortrait();
    });

    // Core events and narrowly scoped toolbar observers keep references current.
    const refresh = () => {
        bindTriggers();
        syncLayoutModeClass();
    };
    eventSource.on(event_types.SETTINGS_UPDATED, refresh);
    eventSource.on(event_types.APP_READY, refresh);
    for (const id of ['rightNavHolder', 'persona-management-button']) {
        const holder = document.getElementById(id);
        if (holder) new MutationObserver(refresh).observe(holder, { childList: true });
    }
    new MutationObserver(syncLayoutModeClass).observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
}

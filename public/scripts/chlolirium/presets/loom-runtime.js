import { characters, chat_metadata, saveChatDebounced, substituteParams, this_chid } from '../../../script.js';
import { groups, selected_group } from '../../group-chats.js';
import { createLoomResolver } from './loom-macros.js';

/** Capture the active chat's storage for this synchronous collection/render. */
export function createChatLoomResolver({ transform } = {}) {
    const metadata = chat_metadata;
    const stored = metadata.chlo_loom_variables;
    const chat = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    return createLoomResolver({
        native: (text, options) => {
            if (text === '{{groupothers}}') {
                const group = groups.find(group => group.id === selected_group);
                return (group?.members ?? []).filter(avatar => avatar !== characters[this_chid]?.avatar)
                    .map(avatar => characters.find(character => character.avatar === avatar)?.name).filter(Boolean).join(', ');
            }
            return substituteParams(text, options);
        },
        chat, transform,
        onChatWrite: () => {
            metadata.chlo_loom_variables = chat;
            if (chat_metadata === metadata) saveChatDebounced();
        },
    });
}

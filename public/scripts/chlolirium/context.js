import { characters, getCurrentChatId, name1, saveSettingsDebounced, this_chid } from '../../script.js';
import { eventSource, event_types } from '../events.js';
import { extension_settings } from '../extensions.js';
import { SlashCommand } from '../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../slash-commands/SlashCommandParser.js';

/** Core live bindings, evaluated after settings load. Historical setting keys
 * remain in the shared settings object to preserve existing installations. */
export function getContext() {
    return {
        characters,
        characterId: this_chid,
        chatId: getCurrentChatId(),
        name1,
        extensionSettings: extension_settings,
        saveSettingsDebounced,
        eventSource,
        eventTypes: event_types,
        SlashCommand,
        SlashCommandParser,
    };
}

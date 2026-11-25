import { characters, eventSource, event_types, getCurrentChatId, messageFormatting, reloadCurrentChat, saveSettingsDebounced, this_chid } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { selected_group } from '../../group-chats.js';
import { callGenericPopup, Popup, POPUP_TYPE } from '../../popup.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders, enumIcons } from '../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandEnumValue, enumTypes } from '../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { download, equalsIgnoreCaseAndAccents, escapeHtml, getFileText, getSortableDelay, isFalseBoolean, isTrueBoolean, regexFromString, setInfoBlock, uuidv4 } from '../../utils.js';
import { allowPresetScripts, allowScopedScripts, disallowPresetScripts, disallowScopedScripts, getCurrentPresetAPI, getCurrentPresetName, getRegexScripts, getScriptsByType, isPresetScriptsAllowed, isRegexProcessingPaused, isScopedScriptsAllowed, regex_placement, RegexProvider, runRegexScript, saveScriptsByType, SCRIPT_TYPE_UNKNOWN, SCRIPT_TYPES, substitute_find_regex } from './engine.js';
import { t } from '../../i18n.js';
import { accountStorage } from '../../util/AccountStorage.js';
import { getPresetManager } from '../../preset-manager.js';
import { createRegexDrawer } from './drawer.js';
import { getRegexSource } from './sources.js';

const scopesByType = {
    [SCRIPT_TYPES.GLOBAL]: 'global',
    [SCRIPT_TYPES.PRESET]: 'preset',
    [SCRIPT_TYPES.SCOPED]: 'character',
};
let drawer;
let scriptTemplatePromise;

function getDrawerContext() {
    const api = getCurrentPresetAPI();
    const preset = getCurrentPresetName();
    const character = selected_group ? undefined : characters?.[this_chid];
    return {
        hasPreset: Boolean(preset),
        presetName: preset,
        hasCharacter: Boolean(character),
        presetAllowed: isPresetScriptsAllowed(api, preset),
        characterAllowed: isScopedScriptsAllowed(character),
        owners: { global: '', preset: preset ? JSON.stringify([api, preset]) : null, character: character?.avatar ?? null },
    };
}

// Re-exports for legacy extensions
export { getRegexScripts };

const sanitizeFileName = name => name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase();

/**
 * @typedef {import('../../char-data.js').RegexScriptData} RegexScript
 */

/**
 * @typedef {object} RegexPresetItem
 * @property {string} id - UUID of the regex script
 */

/**
 * @typedef {object} RegexPreset
 * @property {string} id - UUID of the preset
 * @property {string} name - Name of the preset
 * @property {boolean} isSelected - Whether the preset is currently selected
 * @property {RegexPresetItem[]} global - The list of global preset items
 * @property {RegexPresetItem[]} scoped - The list of scoped preset items
 * @property {RegexPresetItem[]} preset - The list of preset preset items
 */

/**
 * @typedef {object} RegexPresetState
 * @property {string[]} global - List of enabled global regex script IDs
 * @property {string[]} scoped - List of enabled scoped regex script IDs
 * @property {string[]} preset - List of enabled preset regex script IDs
 */

class RegexPresetManager {
    /** @type {HTMLSelectElement} */
    presetSelect = null;

    /** @type {HTMLElement} */
    presetCreateButton = null;

    /** @type {HTMLElement} */
    presetUpdateButton = null;

    /** @type {HTMLElement} */
    presetApplyButton = null;

    /** @type {HTMLElement} */
    presetDeleteButton = null;

    /** @type {string|null} */
    currentPresetId = null;

    /** @type {RegexPresetState|null} */
    lastKnownState = null;

    /**
     * Captures the current state of enabled regex scripts for change detection.
     * @returns {RegexPresetState} The current state object
     */
    captureCurrentState() {
        const globalScripts = this.regexListToPresetItems(getScriptsByType(SCRIPT_TYPES.GLOBAL));
        const scopedScripts = this.regexListToPresetItems(getScriptsByType(SCRIPT_TYPES.SCOPED));
        const presetScripts = this.regexListToPresetItems(getScriptsByType(SCRIPT_TYPES.PRESET));

        return {
            global: globalScripts.map(item => item.id).sort(),
            scoped: scopedScripts.map(item => item.id).sort(),
            preset: presetScripts.map(item => item.id).sort(),
        };
    }

    /**
     * Compares two state objects to detect changes.
     * @param {RegexPresetState} state1 First state object
     * @param {RegexPresetState} state2 Second state object
     * @returns {boolean} True if states are different
     */
    hasStateChanged(state1, state2) {
        if (!state1 || !state2) return false;

        const global1 = state1.global || [];
        const global2 = state2.global || [];
        const scoped1 = state1.scoped || [];
        const scoped2 = state2.scoped || [];
        const preset1 = state1.preset || [];
        const preset2 = state2.preset || [];

        if (global1.length !== global2.length || scoped1.length !== scoped2.length) {
            return true;
        }

        return !global1.every(id => global2.includes(id)) ||
            !scoped1.every(id => scoped2.includes(id)) ||
            !preset1.every(id => preset2.includes(id));
    }

    /**
     * Updates the stored state after a preset is applied or saved.
     * @param {string} presetId - The current preset ID
     */
    updateStoredState(presetId) {
        this.currentPresetId = presetId;
        this.lastKnownState = this.captureCurrentState();
    }

    /**
     * Checks if there are unsaved changes and shows a confirmation dialog.
     * @returns {Promise<boolean>} True if user wants to proceed without saving
     */
    async checkUnsavedChanges() {
        if (!this.currentPresetId || !this.lastKnownState) {
            return true; // No current preset or state to compare
        }

        const currentState = this.captureCurrentState();
        if (!this.hasStateChanged(this.lastKnownState, currentState)) {
            return true; // No changes detected
        }

        const currentPreset = extension_settings.regex_presets.find(p => p.id === this.currentPresetId);
        const presetName = currentPreset ? currentPreset.name : t`Unknown Preset`;

        const choice = await Popup.show.confirm(
            t`You have unsaved changes to the "${presetName}" preset.`,
            t`Do you want to save them before switching?`,
            {
                okButton: t`Save Changes`,
                cancelButton: t`Discard Changes`,
            },
        );

        if (choice) {
            // User chose to save changes
            await this.savePreset(this.currentPresetId, true);
            this.renderPresetList();
            return true;
        }

        // User chose to discard changes
        return true;
    }

    /**
     * Sets up event listeners for the preset management UI.
     * @returns {void}
     */
    setupEventListeners() {
        this.presetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('regex_presets'));
        if (!this.presetSelect) {
            console.error('RegexPresetManager: Could not find preset select element in the DOM.');
            return;
        }

        this.presetSelect.addEventListener('change', async (event) => {
            const selectedPresetId = this.presetSelect.value;
            const fromSlashCommand = event instanceof CustomEvent && event?.detail?.fromSlashCommand === true;

            // Check for unsaved changes before switching
            if (!fromSlashCommand) {
                const canProceed = await this.checkUnsavedChanges();
                if (!canProceed) {
                    // Revert the selection
                    event.preventDefault();
                    const currentPreset = extension_settings.regex_presets.find(p => p.id === this.currentPresetId);
                    if (currentPreset) {
                        this.presetSelect.value = currentPreset.id;
                    }
                    return;
                }
            }

            await this.applyPreset(selectedPresetId);
            extension_settings.regex_presets.forEach(p => { p.isSelected = p.id === selectedPresetId; });
            saveSettingsDebounced();
            this.updateStoredState(selectedPresetId);
        });

        this.presetCreateButton = document.getElementById('regex_preset_create');
        if (!this.presetCreateButton) {
            console.error('RegexPresetManager: Could not find preset create button in the DOM.');
            return;
        }

        this.presetCreateButton.addEventListener('click', async () => {
            const newId = uuidv4();
            await this.savePreset(newId, false);
            this.renderPresetList();
            this.updateStoredState(newId);
        });

        this.presetUpdateButton = document.getElementById('regex_preset_update');
        if (!this.presetUpdateButton) {
            console.error('RegexPresetManager: Could not find preset update button in the DOM.');
            return;
        }

        this.presetUpdateButton.addEventListener('click', async () => {
            const selectedPresetId = this.presetSelect.value;
            await this.savePreset(selectedPresetId, true);
            this.renderPresetList();
            this.updateStoredState(selectedPresetId);
        });

        this.presetApplyButton = document.getElementById('regex_preset_apply');
        if (!this.presetApplyButton) {
            console.error('RegexPresetManager: Could not find preset apply button in the DOM.');
            return;
        }

        this.presetApplyButton.addEventListener('click', async () => {
            const selectedPresetId = this.presetSelect.value;
            await this.applyPreset(selectedPresetId);
            this.updateStoredState(selectedPresetId);
        });

        this.presetDeleteButton = document.getElementById('regex_preset_delete');
        if (!this.presetDeleteButton) {
            console.error('RegexPresetManager: Could not find preset delete button in the DOM.');
            return;
        }

        this.presetDeleteButton.addEventListener('click', async () => {
            const selectedPresetId = this.presetSelect.value;
            await this.deletePreset(selectedPresetId);
            this.renderPresetList();

            const newSelectedPresetId = extension_settings.regex_presets.find(p => p.isSelected)?.id;
            if (newSelectedPresetId) {
                await this.applyPreset(newSelectedPresetId);
                this.presetSelect.value = newSelectedPresetId;
                this.updateStoredState(newSelectedPresetId);
            } else {
                this.currentPresetId = null;
                this.lastKnownState = null;
            }
        });

        this.renderPresetList();

        // Initialize the stored state with the currently selected preset
        const selectedPreset = extension_settings.regex_presets?.find(p => p.isSelected);
        if (selectedPreset) {
            this.updateStoredState(selectedPreset.id);
        }
    }

    /**
     * Registers slash commands related to regex presets.
     * @returns {void}
     */
    registerSlashCommands() {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'regex-preset',
            helpString: t`Selects a regex preset by name or ID. Gets the current regex preset ID if no argument is provided.`,
            callback: (args, name) => {
                if (!this.presetSelect) {
                    return '';
                }

                name = String(name ?? '').trim();

                if (name) {
                    const quiet = isTrueBoolean(args?.quiet?.toString());
                    const foundId = extension_settings.regex_presets.find(p => equalsIgnoreCaseAndAccents(p.id, name) || equalsIgnoreCaseAndAccents(p.name, name))?.id;

                    if (foundId) {
                        this.presetSelect.value = foundId;
                        this.presetSelect.dispatchEvent(new CustomEvent('change', { detail: { fromSlashCommand: true } }));
                        return foundId;
                    }

                    !quiet && toastr.warning(`Regex preset "${name}" not found`);
                    return '';
                }

                return this.presetSelect.value;
            },
            returns: 'current preset ID',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'quiet',
                    description: 'Suppress the toast message on preset change',
                    typeList: [ARGUMENT_TYPE.BOOLEAN],
                    defaultValue: 'false',
                    enumList: commonEnumProviders.boolean('trueFalse')(),
                }),
            ],
            unnamedArgumentList: [
                SlashCommandArgument.fromProps({
                    description: 'regex preset name or ID',
                    typeList: [ARGUMENT_TYPE.STRING],
                    enumProvider: () => extension_settings.regex_presets.map(x => new SlashCommandEnumValue(x.id, x.name, enumTypes.enum, enumIcons.preset)),
                }),
            ],
        }));
    }

    /**
     * Renders the list of regex presets in the UI.
     * @returns {void}
     */
    renderPresetList() {
        if (!this.presetSelect) {
            return;
        }

        this.presetSelect.innerHTML = '';

        if (!Array.isArray(extension_settings.regex_presets) || extension_settings.regex_presets.length === 0) {
            const fallbackOption = new Option(t`[No presets saved]`, '', true, true);
            this.presetSelect.appendChild(fallbackOption);
            this.presetSelect.disabled = true;
            return;
        }

        extension_settings.regex_presets.forEach(preset => {
            const option = new Option(preset.name, preset.id, preset.isSelected, preset.isSelected);
            this.presetSelect.appendChild(option);
        });

        this.presetSelect.disabled = false;
    }

    /**
     * Applies a preset list to a target list of scripts.
     * @param {Object} params The parameters object
     * @param {RegexPresetItem[]} params.presetList The list of preset items
     * @param {RegexScript[]} params.targetList The list of target scripts to modify
     * @param {(targetList: RegexScript[]) => Promise<any>} params.saveFunction Function to save the modified list
     */
    async applyPresetList({ presetList, targetList, saveFunction }) {
        if (!Array.isArray(targetList) || !Array.isArray(presetList)) {
            return;
        }

        // Only enable scripts that are in the preset
        targetList.forEach((script => {
            script.disabled = !presetList.some(p => p.id === script.id);
        }));

        // First sort by the order in the preset, then the original order
        targetList.sort((a, b) => {
            const aIndex = presetList.findIndex(p => p.id === a.id);
            const bIndex = presetList.findIndex(p => p.id === b.id);
            return aIndex - bIndex || targetList.indexOf(a) - targetList.indexOf(b);
        });

        await saveFunction(targetList);
    }

    /**
     * Applies a regex preset to the current context.
     * @param {string} presetId - The ID of the preset to apply
     * @returns {Promise<void>}
     */
    async applyPreset(presetId) {
        const preset = extension_settings.regex_presets.find(p => p.id === presetId);
        if (!preset) {
            toastr.error(t`Could not find the selected preset.`);
            return;
        }

        // Apply preset to all lists
        for (const scriptType of Object.values(SCRIPT_TYPES)) {
            await this.applyPresetList({
                presetList: {
                    [SCRIPT_TYPES.GLOBAL]: preset.global,
                    [SCRIPT_TYPES.SCOPED]: preset.scoped,
                    [SCRIPT_TYPES.PRESET]: preset.preset,
                }[scriptType],
                targetList: getScriptsByType(scriptType),
                saveFunction: scripts => saveScriptsByType(scripts, scriptType),
            });
        }

        // Render the changes to the UI
        await loadRegexScripts();
        // Apply the changes to the current chat
        await reloadCurrentChat();
    }

    /**
     * Converts a list of regex scripts to preset items.
     * @param {RegexScript[]} list The list of regex scripts
     * @returns {RegexPresetItem[] | null} The list of preset items, or null if the input is invalid
     */
    regexListToPresetItems(list) {
        if (!Array.isArray(list)) {
            return null;
        }

        return list.filter(x => !x.disabled).map(s => ({ id: s.id }));
    }

    /**
     * Saves a regex preset.
     * @param {string} presetId - The ID of the preset
     * @param {boolean} isUpdate - Whether this is an update operation
     * @returns {Promise<void>}
     */
    async savePreset(presetId, isUpdate) {
        const existingPreset = isUpdate ? extension_settings.regex_presets.find(p => p.id === presetId) : null;

        if (isUpdate && !existingPreset) {
            toastr.error(t`Could not find the preset to update.`);
            return;
        }

        const name = isUpdate ? existingPreset.name : await Popup.show.input(t`Enter a name for the new regex preset:`, '');
        const id = isUpdate ? existingPreset.id : presetId;

        if (!name || !name.trim().length) {
            return;
        }

        const preset = {
            id: id,
            name: name,
            isSelected: false,
            global: this.regexListToPresetItems(getScriptsByType(SCRIPT_TYPES.GLOBAL)),
            scoped: this.regexListToPresetItems(getScriptsByType(SCRIPT_TYPES.SCOPED)),
            preset: this.regexListToPresetItems(getScriptsByType(SCRIPT_TYPES.PRESET)),
        };

        if (isUpdate) {
            Object.assign(existingPreset, preset);
        } else {
            extension_settings.regex_presets.push(preset);
        }

        extension_settings.regex_presets.forEach(p => { p.isSelected = p.id === id; });
        saveSettingsDebounced();

        toastr.success(isUpdate ? t`Regex preset updated` : t`Regex preset saved`);
    }

    /**
     * Deletes a regex preset.
     * @param {string} presetId - The ID of the preset to delete
     * @returns {Promise<void>}
     */
    async deletePreset(presetId) {
        const presetIndex = extension_settings.regex_presets.findIndex(p => p.id === presetId);
        if (presetIndex === -1) {
            toastr.error(t`Could not find the preset to delete.`);
            return;
        }

        const presetName = extension_settings.regex_presets[presetIndex].name;
        const confirm = await Popup.show.confirm(t`Are you sure you want to delete this regex preset?`, presetName);
        if (!confirm) {
            return;
        }

        extension_settings.regex_presets.splice(presetIndex, 1);

        // Select the first preset if any exist
        extension_settings.regex_presets.forEach((p, i) => { p.isSelected = i === 0; });
        saveSettingsDebounced();

        toastr.success(t`Regex preset deleted`);
    }
}

const presetManager = new RegexPresetManager();

/**
 * Toggle the icon for the "select all" checkbox in the regex settings.
 * - Use `fa-check-double` when the checkbox is unchecked (indicating all scripts are not selected).
 * - Use `fa-minus` when the checkbox is checked (indicating all scripts are selected).
 * @param {boolean} allAreChecked Should the "select all" icon be in the checked state?
 */
function setToggleAllIcon(allAreChecked) {
    const selectAllIcon = $('#bulk_select_all_toggle').find('i');
    selectAllIcon.toggleClass('fa-check-double', !allAreChecked);
    selectAllIcon.toggleClass('fa-minus', allAreChecked);
}

/**
 * Sets the visibility of the bulk move buttons based on selected scripts.
 */
function setMoveButtonsVisibility() {
    const selected = drawer?.getSelection() ?? [];
    const scopes = new Set(selected.map(row => row.scope));
    const checkboxCount = drawer?.getVisibleRows().length ?? 0;
    setToggleAllIcon(checkboxCount > 0 && drawer.getVisibleRows().every(row => row.node.querySelector('.regex_bulk_checkbox').checked));
    $('#chlo-regex-selected-count').text(t`${selected.length} selected`);
    for (const [scope, suffix] of [['global', 'global'], ['preset', 'preset'], ['character', 'scoped']]) {
        $(`#bulk_regex_move_to_${suffix}`).prop('hidden', ![...scopes].some(item => item !== scope));
    }
}

/**
 * Saves a regex script to the extension settings or character data.
 * @param {import('../../char-data.js').RegexScriptData} regexScript
 * @param {number} existingScriptIndex Index of the existing script
 * @param {SCRIPT_TYPES} scriptType Type of the script
 * @param {boolean} [saveSettings=true] Whether to save the settings immediately
 * @returns {Promise<void>}
 */
async function saveRegexScript(regexScript, existingScriptIndex, scriptType, saveSettings = true) {
    // If not editing
    const array = getScriptsByType(scriptType);

    // Assign a UUID if it doesn't exist
    if (!regexScript.id) {
        regexScript.id = uuidv4();
    }

    // Is the script name undefined or empty?
    if (!regexScript.scriptName) {
        toastr.error(t`Could not save regex script: The script name was undefined or empty!`);
        return;
    }

    // Is a find regex present?
    if (regexScript.findRegex.length === 0) {
        toastr.warning(t`This regex script will not work, but was saved anyway: A find regex isn't present.`);
    }

    // Is there someplace to place results?
    if (regexScript.placement.length === 0) {
        toastr.warning(t`This regex script will not work, but was saved anyway: One "Affects" checkbox must be selected!`);
    }

    if (existingScriptIndex !== -1) {
        array[existingScriptIndex] = regexScript;
    } else {
        array.push(regexScript);
    }

    if (scriptType === SCRIPT_TYPES.SCOPED) {
        await saveScriptsByType(array, SCRIPT_TYPES.SCOPED);
        if (existingScriptIndex === -1) allowScopedScripts(characters?.[this_chid]);
    }

    if (scriptType === SCRIPT_TYPES.PRESET) {
        await saveScriptsByType(array, SCRIPT_TYPES.PRESET);
        if (existingScriptIndex === -1) allowPresetScripts(getCurrentPresetAPI(), getCurrentPresetName());
    }

    if (saveSettings) {
        saveSettingsDebounced();
        await loadRegexScripts();

        // Reload the current chat to undo previous markdown
        const currentChatId = getCurrentChatId();
        if (currentChatId) {
            await reloadCurrentChat();
        }
    }

    const debuggerPopup = $('#regex_debugger_popup');
    if (debuggerPopup.length) refreshDebuggerRules(debuggerPopup);
}

/**
 * Delete a regex script by ID
 * @param {string} id ID of the script to delete
 * @param {SCRIPT_TYPES} scriptType Type of the script
 * @param {boolean} saveSettings Whether to save the settings immediately
 * @param {boolean} [keepSection=false] Keep the section assignment until the scope move completes
 * @returns {Promise<void>}
 */
async function deleteRegexScript(id, scriptType, saveSettings = true, keepSection = false) {
    const array = getScriptsByType(scriptType);

    const existingScriptIndex = array.findIndex(script => script.id === id);
    if (existingScriptIndex !== -1) {
        array.splice(existingScriptIndex, 1);

        switch (scriptType) {
            case SCRIPT_TYPES.GLOBAL:
                // will be handled by saveSettingsDebounced
                break;
            case SCRIPT_TYPES.SCOPED:
                await saveScriptsByType(array, SCRIPT_TYPES.SCOPED);
                break;
            case SCRIPT_TYPES.PRESET:
                await saveScriptsByType(array, SCRIPT_TYPES.PRESET);
                break;
            default:
                break;
        }
        if (!keepSection) drawer?.forgetSection(scopesByType[scriptType], id);
        if (saveSettings) {
            saveSettingsDebounced();
            await loadRegexScripts();
        }
    }
}

/**
 * Move a regex script from one type to another
 * @param {import('../../char-data.js').RegexScriptData} script The script to move
 * @param {SCRIPT_TYPES} toType Target type
 * @param {SCRIPT_TYPES|null} fromType Source type, if null it will be determined automatically
 * @param {boolean} saveSettings Whether to save the settings immediately
 * @returns {Promise<void>}
 */
async function moveRegexScript(script, toType, fromType = null, saveSettings = true) {
    if (!Object.values(SCRIPT_TYPES).includes(toType)) {
        console.warn(`moveRegexScript: Invalid target script type ${toType}`);
        return;
    }
    if (!Object.values(SCRIPT_TYPES).includes(fromType)) {
        fromType = getScriptType(script);
    }
    if (fromType === toType || fromType === SCRIPT_TYPE_UNKNOWN || toType === SCRIPT_TYPE_UNKNOWN) {
        return;
    }
    await deleteRegexScript(script.id, fromType, false, true);
    drawer?.moveSection(scopesByType[fromType], scopesByType[toType], script.id);
    await saveRegexScript(script, -1, toType, saveSettings);
}

async function loadRegexScripts() {
    if (!drawer) return;
    scriptTemplatePromise ??= renderExtensionTemplateAsync('regex', 'scriptTemplate').then(html => $(html));
    const scriptTemplate = await scriptTemplatePromise;
    const rows = [];
    const context = getDrawerContext();

    /**
     * Renders a script to the UI.
     * @param {import('../../char-data.js').RegexScriptData} script Script data
     * @param {SCRIPT_TYPES} scriptType Type of the script
     */
    function renderScript(script, scriptType) {
        const scriptHtml = scriptTemplate.clone();
        const scope = scopesByType[scriptType];

        if (!script.id) {
            script.id = uuidv4();
        }

        scriptHtml.attr('data-regex-id', script.id);
        scriptHtml.find('.regex_script_name').text(script.scriptName).attr('title', script.scriptName);
        scriptHtml.find('.regex_bulk_checkbox').attr('aria-label', t`Select ${script.scriptName}`);
        const ruleSwitch = scriptHtml.find('.disable_regex').attr('aria-label', t`Enable ${script.scriptName}`);
        ruleSwitch.attr('aria-checked', String(!script.disabled)).on('click', async function () {
            const array = getScriptsByType(scriptType);
            const index = array.indexOf(script);
            if (index === -1) return;
            ruleSwitch.prop('disabled', true);
            script.disabled = !script.disabled;
            ruleSwitch.attr('aria-checked', String(!script.disabled));
            try {
                await saveRegexScript(script, index, scriptType);
            } finally {
                ruleSwitch.prop('disabled', false);
            }
        });
        scriptHtml.find('.edit_existing_regex').on('click', () => onRegexEditorOpenClick(script.id, scriptType));
        scriptHtml.find('.move_to_global').prop('hidden', scope === 'global');
        scriptHtml.find('.move_to_scoped').prop({ hidden: scope === 'character', disabled: !context.hasCharacter });
        scriptHtml.find('.move_to_preset').prop({ hidden: scope === 'preset', disabled: !context.hasPreset });
        scriptHtml.find('.move_to_global').on('click', async function () {
            const confirm = await callGenericPopup(t`Are you sure you want to move this regex script to global?`, POPUP_TYPE.CONFIRM);

            if (!confirm) {
                return;
            }
            await moveRegexScript(script, SCRIPT_TYPES.GLOBAL, scriptType);
        });
        scriptHtml.find('.move_to_scoped').on('click', async function () {
            if (this_chid === undefined) {
                toastr.error(t`No character selected.`);
                return;
            }
            if (selected_group) {
                toastr.error(t`Cannot edit scoped scripts in group chats.`);
                return;
            }
            const confirm = await callGenericPopup(t`Are you sure you want to move this regex script to scoped?`, POPUP_TYPE.CONFIRM);
            if (!confirm) {
                return;
            }
            await moveRegexScript(script, SCRIPT_TYPES.SCOPED, scriptType);
        });
        scriptHtml.find('.move_to_preset').on('click', async function () {
            const confirm = await callGenericPopup(
                t`Are you sure you want to move this regex script to preset?`,
                POPUP_TYPE.CONFIRM,
            );
            if (!confirm) {
                return;
            }
            await moveRegexScript(script, SCRIPT_TYPES.PRESET, scriptType);
        });
        scriptHtml.find('.export_regex').on('click', async function () {
            const fileName = `regex-${sanitizeFileName(script.scriptName)}.json`;
            const fileData = JSON.stringify(script, null, 4);
            download(fileData, fileName, 'application/json');
        });
        scriptHtml.find('.delete_regex').on('click', async function () {
            const confirm = await callGenericPopup(t`Are you sure you want to delete this regex script?`, POPUP_TYPE.CONFIRM);
            if (!confirm) {
                return;
            }
            await deleteRegexScript(script.id, scriptType);
            await reloadCurrentChat();
        });
        scriptHtml.find('.regex_bulk_checkbox').on('change', setMoveButtonsVisibility);
        const name = script.scriptName ?? '';
        // Older Loom imports encoded the original folder in the name.
        const folder = typeof script.folder === 'string' ? script.folder.trim()
            : script.chlo_loom?.version === 1 && name.includes(' / ') ? name.split(' / ', 1)[0].trim() : '';
        const source = getRegexSource(script, extension_settings);
        const typeLabel = source?.type === 'extension' ? t`Extension` : t`Lorebook`;
        const sourceLabel = source ? `${typeLabel}: ${source.name}` : '';
        const sourceNote = {
            installed: t`Recorded by the extension installer`,
            bundled: t`Matches a bundled rule; may have been imported manually`,
            declared: t`Source recorded with the rule`,
        }[source?.evidence];
        const sourceElement = scriptHtml.find('.chlo-regex-source');
        const storedIn = scope === 'preset' ? t`Preset: ${context.presetName}`
            : scope === 'character' ? t`Character: ${characters?.[this_chid]?.name ?? ''}` : t`Global settings`;
        scriptHtml.find('.chlo-regex-source-detail').text(source
            ? `${sourceLabel} · ${sourceNote}. ${storedIn}.`
            : scope === 'global' ? t`Global settings · original source unknown` : storedIn);
        if (source) sourceElement.text(sourceLabel).attr('title', sourceNote).prop('hidden', false);
        rows.push({ scope, id: script.id, name, folder, source, node: scriptHtml[0] });
    }

    for (const scriptType of Object.values(SCRIPT_TYPES)) {
        if (scriptType === SCRIPT_TYPES.SCOPED && !context.hasCharacter) continue;
        getScriptsByType(scriptType).forEach(script => renderScript(script, scriptType));
    }

    $('#regex_scoped_toggle').prop('checked', context.characterAllowed);
    $('#regex_preset_toggle').prop('checked', context.presetAllowed);
    const total = rows.length;
    const enabled = rows.filter(row => row.node.querySelector('.disable_regex').getAttribute('aria-checked') === 'true').length;
    $('#chlo-regex-master-toggle').prop({
        checked: !isRegexProcessingPaused() && enabled > 0,
        indeterminate: !isRegexProcessingPaused() && enabled > 0 && enabled < total,
        disabled: !total,
    });
    drawer.update(rows, context);
}

/**
 * Opens the regex editor.
 * @param {string|boolean} existingId Existing ID
 * @param {SCRIPT_TYPES} scriptType Type of the script
 * @param {boolean} [inline=true] Open in the drawer instead of above the debugger
 * @returns {Promise<void>}
 */
async function onRegexEditorOpenClick(existingId, scriptType, inline = true) {
    const editorHtml = $(await renderExtensionTemplateAsync('regex', 'editor'));
    const scope = scopesByType[scriptType];
    const owner = getDrawerContext().owners[scope];
    if (owner === null) return;
    const array = getScriptsByType(scriptType);

    // If an ID exists, fill in all the values
    let existingScriptIndex = -1;
    if (existingId) {
        existingScriptIndex = array.findIndex((script) => script.id === existingId);
        if (existingScriptIndex !== -1) {
            const existingScript = array[existingScriptIndex];
            if (existingScript.scriptName) {
                editorHtml.find('.regex_script_name').val(existingScript.scriptName);
            } else {
                toastr.error('This script doesn\'t have a name! Please delete it.');
                return;
            }

            editorHtml.find('.find_regex').val(existingScript.findRegex || '');
            editorHtml.find('.regex_replace_string').val(existingScript.replaceString || '');
            editorHtml.find('.regex_trim_strings').val(existingScript.trimStrings?.join('\n') || []);
            editorHtml.find('input[name="disabled"]').prop('checked', existingScript.disabled ?? false);
            editorHtml.find('input[name="only_format_display"]').prop('checked', existingScript.markdownOnly ?? false);
            editorHtml.find('input[name="only_format_prompt"]').prop('checked', existingScript.promptOnly ?? false);
            editorHtml.find('input[name="run_on_edit"]').prop('checked', existingScript.runOnEdit ?? false);
            editorHtml.find('select[name="substitute_regex"]').val(existingScript.substituteRegex ?? substitute_find_regex.NONE);
            editorHtml.find('input[name="min_depth"]').val(existingScript.minDepth ?? '');
            editorHtml.find('input[name="max_depth"]').val(existingScript.maxDepth ?? '');

            existingScript.placement.forEach((element) => {
                editorHtml
                    .find(`input[name="replace_position"][value="${element}"]`)
                    .prop('checked', true);
            });
        }
    } else {
        editorHtml
            .find('input[name="only_format_display"]')
            .prop('checked', true);

        editorHtml
            .find('input[name="run_on_edit"]')
            .prop('checked', true);

        editorHtml
            .find('input[name="replace_position"][value="1"]')
            .prop('checked', true);
    }

    const loomCompatibility = array[existingScriptIndex]?.chlo_loom;
    if (loomCompatibility?.version === 1) {
        editorHtml.find('select[name="substitute_regex"] option[value="1"]').prop('disabled', true).attr('title', 'Imported Loom rules support None or Escaped substitution.');
        editorHtml.find('.regex_trim_strings').prop('disabled', true).attr('title', 'Imported Loom rules use untrimmed JavaScript captures.');
    }
    const compatibilityFields = () => loomCompatibility?.version === 1 ? {
        chlo_loom: { ...loomCompatibility, mode: Number(editorHtml.find('select[name="substitute_regex"]').val()) === substitute_find_regex.ESCAPED ? 'escaped' : 'none' },
    } : {};

    editorHtml.find('#regex_test_mode_toggle').on('click', function () {
        editorHtml.find('#regex_test_mode').toggleClass('displayNone');
        updateTestResult();
    });

    function updateTestResult() {
        updateInfoBlock(editorHtml);

        if (!editorHtml.find('#regex_test_mode').is(':visible')) {
            return;
        }

        const testScript = {
            ...compatibilityFields(),
            id: uuidv4(),
            scriptName: editorHtml.find('.regex_script_name').val().toString(),
            findRegex: editorHtml.find('.find_regex').val().toString(),
            replaceString: editorHtml.find('.regex_replace_string').val().toString(),
            trimStrings: String(editorHtml.find('.regex_trim_strings').val()).split('\n').filter((e) => e.length !== 0) || [],
            substituteRegex: Number(editorHtml.find('select[name="substitute_regex"]').val()),
            disabled: false,
            promptOnly: false,
            markdownOnly: false,
            runOnEdit: false,
            minDepth: null,
            maxDepth: null,
            placement: null,
        };
        const rawTestString = String(editorHtml.find('#regex_test_input').val());
        const result = runRegexScript(testScript, rawTestString);
        editorHtml.find('#regex_test_output').text(result);
    }

    editorHtml.find('input, textarea, select').on('input', updateTestResult);
    updateInfoBlock(editorHtml);

    if (existingId && existingScriptIndex < 0) return;
    const save = async () => {
        if (getDrawerContext().owners[scope] !== owner) return false;
        const scripts = getScriptsByType(scriptType);
        const index = existingId ? scripts.findIndex(script => script.id === existingId) : -1;
        if (existingId && index < 0) return false;
        const newRegexScript = {
            ...scripts[index],
            ...compatibilityFields(),
            id: existingId ? String(existingId) : uuidv4(),
            scriptName: String(editorHtml.find('.regex_script_name').val()),
            findRegex: String(editorHtml.find('.find_regex').val()),
            replaceString: String(editorHtml.find('.regex_replace_string').val()),
            trimStrings: String(editorHtml.find('.regex_trim_strings').val()).split('\n').filter((e) => e.length !== 0) || [],
            placement:
                editorHtml
                    .find('input[name="replace_position"]')
                    .filter(':checked')
                    .map(function () { return parseInt($(this).val().toString()); })
                    .get()
                    .filter((e) => !isNaN(e)) || [],
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            markdownOnly: editorHtml.find('input[name="only_format_display"]').prop('checked'),
            promptOnly: editorHtml.find('input[name="only_format_prompt"]').prop('checked'),
            runOnEdit: editorHtml.find('input[name="run_on_edit"]').prop('checked'),
            substituteRegex: Number(editorHtml.find('select[name="substitute_regex"]').val()),
            minDepth: parseInt(String(editorHtml.find('input[name="min_depth"]').val())),
            maxDepth: parseInt(String(editorHtml.find('input[name="max_depth"]').val())),
        };

        newRegexScript.scriptName = newRegexScript.scriptName.trim();
        if (!newRegexScript.scriptName) {
            toastr.error(t`A script name is required.`);
            editorHtml.find('.regex_script_name').trigger('focus');
            return false;
        }
        await saveRegexScript(newRegexScript, index, scriptType);
        return true;
    };
    if (inline) {
        drawer.openEditor(editorHtml[0], scope, existingId, save);
    } else {
        const confirmed = await callGenericPopup(editorHtml, POPUP_TYPE.CONFIRM, '', { okButton: t`Save`, allowVerticalScrolling: true });
        if (confirmed) await save();
    }
}

/**
 * Builds an HTML string for a replacement, highlighting literal parts in green
 * and keeping back-referenced parts plain.
 * @param {RegExpMatchArray} match The match object from `matchAll`.
 * @param {string} pattern The replacement pattern string (e.g., "new text $1").
 * @returns {string} The constructed HTML string.
 */
function buildReplacementHtml(match, pattern) {
    const container = document.createDocumentFragment();
    let lastIndex = 0;
    const backrefRegex = /\$\$|\$&|\$`|\$'|\$(\d{1,2})/g;

    let reMatch;
    while ((reMatch = backrefRegex.exec(pattern)) !== null) {
        // Part of the pattern before the back-reference is a literal.
        const literalPart = pattern.substring(lastIndex, reMatch.index);
        if (literalPart) {
            const mark = document.createElement('mark');
            mark.className = 'green_hl';
            mark.innerText = literalPart;
            container.appendChild(mark);
        }

        const backref = reMatch[0];
        if (backref === '$$') {
            container.appendChild(document.createTextNode('$'));
        } else if (backref === '$&') {
            const mark = document.createElement('mark');
            mark.className = 'yellow_hl';
            mark.innerText = match[0];
            container.appendChild(mark);
        } else if (backref === '$`') {
            container.appendChild(document.createTextNode(match.input.substring(0, match.index)));
        } else if (backref === '$\'') {
            container.appendChild(document.createTextNode(match.input.substring(match.index + match[0].length)));
        } else { // It's a numbered capture group, $n.
            const groupIndex = parseInt(reMatch[1], 10);
            if (groupIndex > 0 && groupIndex < match.length && match[groupIndex] !== undefined) {
                const mark = document.createElement('mark');
                mark.className = 'yellow_hl';
                mark.innerText = match[groupIndex];
                container.appendChild(mark);
            } else {
                // Not a valid group index, treat it as a literal.
                const mark = document.createElement('mark');
                mark.className = 'green_hl';
                mark.innerText = backref;
                container.appendChild(mark);
            }
        }
        lastIndex = backrefRegex.lastIndex;
    }

    // The final part of the pattern after the last back-reference.
    const finalLiteralPart = pattern.substring(lastIndex);
    if (finalLiteralPart) {
        const mark = document.createElement('mark');
        mark.className = 'green_hl';
        mark.innerText = finalLiteralPart;
        container.appendChild(mark);
    }

    // To get the HTML content, we need a temporary parent element.
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(container);
    return tempDiv.innerHTML;
}

function executeRegexScriptForDebugging(script, text) {
    let err;
    let originalRegex;

    try {
        originalRegex = regexFromString(script.findRegex);
        if (!originalRegex) throw new Error('Invalid regex string');
    } catch (e) {
        err = `Compile error: ${e.message}`;
        return { output: text, highlightedOutput: text, error: err, charsCaptured: 0, charsAdded: 0, charsRemoved: 0 };
    }

    const globalRegex = new RegExp(originalRegex.source, originalRegex.flags.includes('g') ? originalRegex.flags : originalRegex.flags + 'g');
    const matches = [...text.matchAll(globalRegex)];

    if (matches.length === 0) {
        return { output: text, highlightedOutput: escapeHtml(text), error: null, charsCaptured: 0, charsAdded: 0, charsRemoved: 0 };
    }

    let outputText = '';
    let highlightedOutput = ''; // This will now be our "diff view"
    let lastIndex = 0;
    let totalCharsCaptured = 0;
    let totalCharsAdded = 0;
    let totalCharsRemoved = 0;

    try {
        for (const match of matches) {
            const originalMatchText = match[0];
            totalCharsCaptured += originalMatchText.length;

            // Append text between matches (this part is unchanged)
            const precedingText = text.substring(lastIndex, match.index);
            outputText += precedingText;
            highlightedOutput += escapeHtml(precedingText);

            // --- Start of new diff and statistics logic ---
            let charsAddedInMatch = 0;
            let charsKeptFromMatch = 0;
            const backrefRegex = /\$\$|\$&|\$`|\$'|\$(\d{1,2})/g;
            let lastPatternIndex = 0;
            let reMatch;
            let replacementForPlainText = '';

            // This loop calculates the stats accurately
            while ((reMatch = backrefRegex.exec(script.replaceString)) !== null) {
                const literalPart = script.replaceString.substring(lastPatternIndex, reMatch.index);
                charsAddedInMatch += literalPart.length;
                replacementForPlainText += literalPart;
                const backref = reMatch[0];
                if (backref === '$$') {
                    replacementForPlainText += '$';
                } else if (backref === '$&') {
                    charsKeptFromMatch += (match[0] || '').length; replacementForPlainText += (match[0] || '');
                } else if (backref === '$`') {
                    const part = match.input.substring(0, match.index); charsKeptFromMatch += part.length; replacementForPlainText += part;
                } else if (backref === '$\'') {
                    const part = match.input.substring(match.index + match[0].length); charsKeptFromMatch += part.length; replacementForPlainText += part;
                } else {
                    const groupIndex = parseInt(reMatch[1], 10);
                    if (groupIndex > 0 && groupIndex < match.length && match[groupIndex] !== undefined) {
                        charsKeptFromMatch += match[groupIndex].length;
                        replacementForPlainText += match[groupIndex];
                    }
                }
                lastPatternIndex = backrefRegex.lastIndex;
            }
            const finalLiteralPart = script.replaceString.substring(lastPatternIndex);
            charsAddedInMatch += finalLiteralPart.length;
            replacementForPlainText += finalLiteralPart;

            totalCharsAdded += charsAddedInMatch;
            totalCharsRemoved += (originalMatchText.length - charsKeptFromMatch);

            outputText += replacementForPlainText;
            // --- End of statistics logic ---

            // --- Build the new Diff View HTML ---
            // 1. Show the entire original match as "removed" (red strikethrough)
            highlightedOutput += `<mark class='red_hl'>${escapeHtml(originalMatchText)}</mark>`;
            // 2. Add an arrow to signify transformation
            highlightedOutput += ' → ';
            // 3. Build the replacement string with green (added) and yellow (kept) parts
            highlightedOutput += buildReplacementHtml(match, script.replaceString);

            lastIndex = match.index + originalMatchText.length;
        }

        // Append text after the last match
        const trailingText = text.substring(lastIndex);
        outputText += trailingText;
        highlightedOutput += escapeHtml(trailingText);
    } catch (e) {
        err = (err ? err + '; ' : '') + `Replace error: ${e.message}`;
        outputText = text; // Fallback
        highlightedOutput = escapeHtml(text);
    }

    return {
        output: outputText,
        highlightedOutput: highlightedOutput,
        error: err,
        charsCaptured: totalCharsCaptured,
        charsAdded: totalCharsAdded,
        charsRemoved: totalCharsRemoved,
    };
}

function populateDebuggerRuleList(container) {
    const rulesContainer = container.find('#regex_debugger_rules');
    const ruleTemplate = container.find('#regex_debugger_rule_template');
    if (!rulesContainer.length || !ruleTemplate.length) {
        console.error('Regex Debugger: Could not find rule list or template in the DOM.');
        return;
    }

    rulesContainer.empty();

    const allScripts = getRegexScripts();
    if (!allScripts || allScripts.length === 0) {
        rulesContainer.append('<div class="regex-debugger-no-rules">' + t`No regex rules found.` + '</div>');
        return;
    }

    const globalScriptIds = new Set(getScriptsByType(SCRIPT_TYPES.GLOBAL).map(s => s.id));
    const scopedScriptIds = new Set(getScriptsByType(SCRIPT_TYPES.SCOPED).map(s => s.id));
    const presetScriptIds = new Set(getScriptsByType(SCRIPT_TYPES.PRESET).map(s => s.id));
    const globalScripts = [];
    const scopedScripts = [];
    const presetScripts = [];

    allScripts.forEach(script => {
        const scriptCopy = structuredClone(script); // Use structuredClone for deep copy
        if (globalScriptIds.has(script.id)) {
            // @ts-ignore
            scriptCopy.type = SCRIPT_TYPES.GLOBAL;
            globalScripts.push(scriptCopy);
        } else if (scopedScriptIds.has(script.id)) {
            // @ts-ignore
            scriptCopy.type = SCRIPT_TYPES.SCOPED;
            scopedScripts.push(scriptCopy);
        } else if (presetScriptIds.has(script.id)) {
            // @ts-ignore
            scriptCopy.type = SCRIPT_TYPES.PRESET;
            presetScripts.push(scriptCopy);
        }
    });

    container.data('allScripts', [...globalScripts, ...presetScripts, ...scopedScripts]);

    const renderRule = (script) => {
        if (!script.id) script.id = uuidv4();
        const ruleElementContent = $(ruleTemplate.prop('content')).clone();
        const ruleElement = ruleElementContent.find('.regex-debugger-rule');

        ruleElement.attr('data-id', script.id);
        // @ts-ignore
        ruleElement.find('.rule-name').text(script.scriptName);
        ruleElement.find('.rule-regex').text(script.findRegex);
        // @ts-ignore
        ruleElement
            .find('.rule-scope')
            .text(
                {
                    [SCRIPT_TYPES.SCOPED]: t`Scoped`,
                    [SCRIPT_TYPES.GLOBAL]: t`Global`,
                    [SCRIPT_TYPES.PRESET]: t`Preset`,
                }[script.type],
            );
        ruleElement.find('.rule-enabled').prop('checked', !script.disabled);
        // @ts-ignore
        ruleElement.find('.edit_rule').on('click', () => onRegexEditorOpenClick(script.id, script.type, false));

        ruleElement.on('click', function (event) {
            if ($(event.target).is('input, .menu_button, .menu_button i')) {
                return;
            }
            const scriptId = $(this).data('id');
            const stepElement = $(`#step-result-${scriptId}`);
            const container = $('#regex_debugger_steps_output');

            if (stepElement.length && container.length) {
                // Replace scrollIntoView with scrollTop animation
                const targetTop = stepElement.position().top;
                const containerScrollTop = container.scrollTop();
                const containerHeight = container.height();

                // Center the element if possible
                let scrollTo = containerScrollTop + targetTop - (containerHeight / 2) + (stepElement.height() / 2);

                container.animate({ scrollTop: scrollTo }, 300); // 300ms smooth scroll

                stepElement.css('transition', 'background-color 0.5s').css('background-color', 'var(--highlight_color)');
                setTimeout(() => stepElement.css('background-color', ''), 1000);
            }
        });

        return ruleElementContent;
    };

    if (globalScripts.length > 0) {
        rulesContainer.append('<div class="list-header regex-debugger-list-header">' + t`Global Rules` + '</div>');
        const globalList = $('<ul id="regex_debugger_rules_global" class="sortable-list"></ul>');
        globalScripts.forEach(script => globalList.append(renderRule(script)));
        rulesContainer.append(globalList);
    }

    if (presetScripts.length > 0) {
        rulesContainer.append('<div class="list-header regex-debugger-list-header">' + t`Preset Rules` + '</div>');
        const presetList = $('<ul id="regex_debugger_rules_preset" class="sortable-list"></ul>');
        presetScripts.forEach(script => presetList.append(renderRule(script)));
        rulesContainer.append(presetList);
    }

    if (scopedScripts.length > 0) {
        rulesContainer.append('<div class="list-header regex-debugger-list-header">' + t`Scoped Rules` + '</div>');
        const scopedList = $('<ul id="regex_debugger_rules_scoped" class="sortable-list"></ul>');
        scopedScripts.forEach(script => scopedList.append(renderRule(script)));
        rulesContainer.append(scopedList);
    }
}

function refreshDebuggerRules(container) {
    populateDebuggerRuleList(container);
    for (const suffix of ['global', 'scoped', 'preset']) {
        // @ts-ignore
        container.find(`#regex_debugger_rules_${suffix}`).sortable({ delay: getSortableDelay() }).disableSelection();
    }
}

/**
 * Opens the regex debugger.
 * @returns {Promise<void>}
 */
async function onRegexDebuggerOpenClick() {
    const templateContent = await renderExtensionTemplateAsync('regex', 'debugger');
    const debuggerHtml = $('<div id="regex_debugger_popup">').html(templateContent);

    const stepTemplate = debuggerHtml.find('#regex_debugger_step_template');

    refreshDebuggerRules(debuggerHtml);

    debuggerHtml.find('#regex_debugger_run_test').on('click', function () {
        const allScripts = debuggerHtml.data('allScripts');
        const orderedRuleIds = [
            ...$('#regex_debugger_rules_global').find('li.regex-debugger-rule').map((i, el) => $(el).data('id')).get(),
            ...$('#regex_debugger_rules_scoped').find('li.regex-debugger-rule').map((i, el) => $(el).data('id')).get(),
            ...$('#regex_debugger_rules_preset').find('li.regex-debugger-rule').map((i, el) => $(el).data('id')).get(),
        ];

        const rawInput = String($('#regex_debugger_raw_input').val());
        const stepsOutput = $('#regex_debugger_steps_output');
        const finalOutput = $('#regex_debugger_final_output');

        if (!stepsOutput.length || !finalOutput.length) return;

        const displayMode = $('input[name="display_mode"]:checked').val();
        stepsOutput.empty();
        finalOutput.empty();
        $('#regex_debugger_final_summary').remove();

        if (!allScripts) return;
        let textForNextStep = rawInput;
        let totalCharsCaptured = 0;
        let totalCharsAdded = 0;
        let totalCharsRemoved = 0;

        orderedRuleIds.forEach(scriptId => {
            const ruleElement = $(`#regex_debugger_rules [data-id="${scriptId}"]`);
            if (!ruleElement.find('.rule-enabled').is(':checked')) return;

            const script = allScripts.find(s => s.id === scriptId);

            if (script) {
                const result = executeRegexScriptForDebugging(script, textForNextStep);
                totalCharsCaptured += result.charsCaptured;
                totalCharsAdded += result.charsAdded;
                totalCharsRemoved += result.charsRemoved;

                const stepElement = $(stepTemplate.prop('content')).clone();
                // Set the ID on the TOP-LEVEL element that is being appended.
                stepElement.find('>:first-child').attr('id', `step-result-${script.id}`);
                const stepHeader = stepElement.find('.step-header');
                stepHeader.find('strong').text(t`After:` + ` ${script.scriptName}`);

                const metricsHtml = '<span class="step-metrics">' + t`Captured:` + ` ${result.charsCaptured}, ` + t`Added:` + ` +${result.charsAdded}, ` + t`Removed:` + ` -${result.charsRemoved}</span>`;
                stepHeader.append(metricsHtml);

                if (displayMode === 'highlight') {
                    stepElement.find('.step-output').html(result.highlightedOutput);
                } else {
                    stepElement.find('.step-output').text(result.output);
                }

                if (result.error) {
                    stepHeader.append($(`<div class='warning_text text_rose-500'>${result.error}</div>`));
                }

                stepsOutput.append(stepElement);
                textForNextStep = result.output;
            }
        });

        const summaryHtml = `
            <div id="regex_debugger_final_summary" class="regex-debugger-summary">
                <strong>` + t`Total Captured:` + `</strong> ${totalCharsCaptured} | <strong>` + t`Total Added:` + `</strong> +${totalCharsAdded} | <strong>` + t`Total Removed:` + `</strong> -${totalCharsRemoved}
            </div>
        `;
        finalOutput.before(summaryHtml);

        const renderMode = $('#regex_debugger_render_mode').val();
        if (renderMode === 'message') {
            const formattedHtml = messageFormatting(textForNextStep, 'Debugger', true, false, null);
            const messageBlock = $('<div class="mes"><div class="mes_text"></div></div>');
            messageBlock.find('.mes_text').html(formattedHtml);
            finalOutput.append(messageBlock);
        } else {
            finalOutput.text(textForNextStep);
        }
    });

    debuggerHtml.find('#regex_debugger_save_order').on('click', async function () {
        const allKnownScripts = getRegexScripts();
        const newGlobalScripts = $('#regex_debugger_rules_global').children('li').map((_, el) => allKnownScripts.find(s => s.id === $(el).data('id'))).get().filter(Boolean);
        const newScopedScripts = $('#regex_debugger_rules_scoped').children('li').map((_, el) => allKnownScripts.find(s => s.id === $(el).data('id'))).get().filter(Boolean);
        const newPresetScripts = $('#regex_debugger_rules_preset').children('li').map((_, el) => allKnownScripts.find(s => s.id === $(el).data('id'))).get().filter(Boolean);

        extension_settings.regex = newGlobalScripts;
        if (this_chid !== undefined) {
            await saveScriptsByType(newScopedScripts, SCRIPT_TYPES.SCOPED);
        }
        await saveScriptsByType(newPresetScripts, SCRIPT_TYPES.PRESET);

        saveSettingsDebounced();
        await loadRegexScripts();
        toastr.success(t`Regex script order saved!`);

        refreshDebuggerRules(debuggerHtml);
    });

    debuggerHtml.find('#regex_debugger_expand_steps').on('click', function () {
        const popupContainer = $('<div class="expanded-regex-container"></div>');
        const navPanel = $('<div class="expanded-regex-nav"><h4>Steps</h4></div>');
        const contentPanel = $('<div class="expanded-regex-content"></div>');

        const content = $('#regex_debugger_steps_output').clone().html();
        contentPanel.html(content);

        $('#regex_debugger_rules .regex-debugger-rule').each(function () {
            const ruleElement = $(this);
            const scriptId = ruleElement.data('id');
            const scriptName = ruleElement.find('.rule-name').text();

            const link = $(`<a href="#">${escapeHtml(scriptName)}</a>`);
            link.data('target-id', `step-result-${scriptId}`);

            link.on('click', function (e) {
                e.preventDefault();
                navPanel.find('a').removeClass('active');
                $(this).addClass('active');

                const targetId = $(this).data('target-id');
                // The selector is now correct for the structure.
                const targetElement = contentPanel.find(`#${targetId}`);

                if (targetElement.length) {
                    const scrollTo = contentPanel.scrollTop() + targetElement.position().top;
                    contentPanel.animate({ scrollTop: scrollTo }, 300);

                    targetElement.css('transition', 'background-color 0.5s').css('background-color', 'var(--highlight_color)');
                    setTimeout(() => targetElement.css('background-color', ''), 1000);
                }
            });

            navPanel.append(link);
        });

        popupContainer.append(navPanel).append(contentPanel);
        callGenericPopup(popupContainer, POPUP_TYPE.TEXT, t`Step-by-step Transformation`, { wide: true, allowVerticalScrolling: false });
    });

    debuggerHtml.find('#regex_debugger_expand_final').on('click', function () {
        const content = $('#regex_debugger_final_output').html();
        const popupContent = $('<div class="regex-popup-content"></div>').html(content);
        callGenericPopup(popupContent, POPUP_TYPE.TEXT, t`Final Output`, { wide: true, large: true, allowVerticalScrolling: true });
    });

    await callGenericPopup(debuggerHtml, POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true });
}

/**
 * Updates the info block in the regex editor with hints regarding the find regex.
 * @param {JQuery<HTMLElement>} editorHtml The editor HTML
 */
function updateInfoBlock(editorHtml) {
    const infoBlock = editorHtml.find('.info-block').get(0);
    const infoBlockFlagsHint = editorHtml.find('#regex_info_block_flags_hint');
    const findRegex = String(editorHtml.find('.find_regex').val());

    infoBlockFlagsHint.hide();

    // Clear the info block if the find regex is empty
    if (!findRegex) {
        setInfoBlock(infoBlock, t`Find Regex is empty`, 'info');
        return;
    }

    try {
        const regex = regexFromString(findRegex);
        if (!regex) {
            throw new Error(t`Invalid Find Regex`);
        }

        const flagInfo = [];
        flagInfo.push(regex.flags.includes('g') ? t`Applies to all matches` : t`Applies to the first match`);
        flagInfo.push(regex.flags.includes('i') ? t`Case insensitive` : t`Case sensitive`);

        setInfoBlock(infoBlock, flagInfo.join('. '), 'hint');
        infoBlockFlagsHint.show();
    } catch (error) {
        setInfoBlock(infoBlock, error.message, 'error');
    }
}

// Common settings migration function. Some parts will eventually be removed
// TODO: Maybe migrate placement to strings?
function migrateSettings() {
    let performSave = false;

    // Current: If MD Display is present in placement, remove it and add new placements/MD option
    extension_settings.regex.forEach((script) => {
        if (!script.id) {
            script.id = uuidv4();
            performSave = true;
        }

        if (!Array.isArray(script.placement)) {
            script.placement = [];
            performSave = true;
        }

        if (script.placement.includes(regex_placement.MD_DISPLAY)) {
            script.placement = script.placement.length === 1 ?
                Object.values(regex_placement).filter((e) => e !== regex_placement.MD_DISPLAY) :
                script.placement = script.placement.filter((e) => e !== regex_placement.MD_DISPLAY);

            script.markdownOnly = true;
            script.promptOnly = true;

            performSave = true;
        }

        // Old system and sendas placement migration
        // 4 - sendAs
        if (script.placement.includes(4)) {
            script.placement = script.placement.length === 1 ?
                [regex_placement.SLASH_COMMAND] :
                script.placement = script.placement.filter((e) => e !== 4);

            performSave = true;
        }
    });

    if (performSave) {
        saveSettingsDebounced();
    }
}

/**
 * /regex slash command callback
 * @param {{name: string}} args Named arguments
 * @param {string} value Unnamed argument
 * @returns {string} The regexed string
 */
function runRegexCallback(args, value) {
    if (!args.name) {
        toastr.warning('No regex script name provided.');
        return value;
    }

    if (isRegexProcessingPaused()) return value;
    const scriptName = args.name;
    const scripts = getRegexScripts({ allowedOnly: true });

    for (const script of scripts) {
        if (script.scriptName.toLowerCase() === scriptName.toLowerCase()) {
            if (script.disabled) {
                toastr.warning(t`Regex script "${scriptName}" is disabled.`);
                return value;
            }

            console.debug(`Running regex callback for ${scriptName}`);
            return runRegexScript(script, value);
        }
    }

    toastr.warning(`Regex script "${scriptName}" not found.`);
    return value;
}

/**
 * /regex-toggle slash command callback
 * @param {{state: string, quiet: string}} args Named arguments
 * @param {string} scriptName The name of the script to toggle
 * @returns {Promise<string>} The name of the script
 */
async function toggleRegexCallback(args, scriptName) {
    if (typeof scriptName !== 'string') throw new Error('Script name must be a string.');

    const quiet = isTrueBoolean(args?.quiet);
    const action = isTrueBoolean(args?.state) ? 'enable' :
        isFalseBoolean(args?.state) ? 'disable' :
            'toggle';

    const scripts = getRegexScripts();
    const script = scripts.find(s => equalsIgnoreCaseAndAccents(s.scriptName, scriptName));

    if (!script) {
        toastr.warning(t`Regex script '${scriptName}' not found.`);
        return '';
    }

    switch (action) {
        case 'enable':
            script.disabled = false;
            break;
        case 'disable':
            script.disabled = true;
            break;
        default:
            script.disabled = !script.disabled;
            break;
    }

    const scriptType = getScriptType(script);
    const index = getScriptsByType(scriptType).indexOf(script);

    await saveRegexScript(script, index, scriptType);
    if (script.disabled) {
        !quiet && toastr.success(t`Regex script '${scriptName}' has been disabled.`);
    } else {
        !quiet && toastr.success(t`Regex script '${scriptName}' has been enabled.`);
    }

    return script.scriptName || '';
}

/**
 * Performs the import of the regex object.
 * @param {RegexScript} regexScript Input object
 * @param {SCRIPT_TYPES} scriptType The type of script to import as
 */
async function onRegexImportObjectChange(regexScript, scriptType) {
    try {
        if (!regexScript.scriptName) {
            throw new Error('No script name provided.');
        }

        // Assign a new UUID
        regexScript.id = uuidv4();

        const array = getScriptsByType(scriptType);
        array.push(regexScript);

        switch (scriptType) {
            case SCRIPT_TYPES.GLOBAL:
                // will be handled by saveSettingsDebounced
                break;
            case SCRIPT_TYPES.SCOPED:
                await saveScriptsByType(array, SCRIPT_TYPES.SCOPED);
                break;
            case SCRIPT_TYPES.PRESET:
                await saveScriptsByType(array, SCRIPT_TYPES.PRESET);
                break;
            default:
                break;
        }

        saveSettingsDebounced();
        await loadRegexScripts();
        toastr.success(t`Regex script "${regexScript.scriptName}" imported.`);
    } catch (error) {
        console.log(error);
        toastr.error(t`Invalid regex object.`);
        return;
    }
}

/**
 * Performs the import of the regex file.
 * @param {File} file Input file
 * @param {SCRIPT_TYPES} scriptType The type of script to import as
 */
async function onRegexImportFileChange(file, scriptType) {
    if (!file) {
        toastr.error('No file provided.');
        return;
    }

    try {
        const regexScripts = JSON.parse(await getFileText(file));
        if (Array.isArray(regexScripts)) {
            for (const regexScript of regexScripts) {
                await onRegexImportObjectChange(regexScript, scriptType);
            }
        } else {
            await onRegexImportObjectChange(regexScripts, scriptType);
        }
    } catch (error) {
        console.log(error);
        toastr.error('Invalid JSON file.');
        return;
    }
}

/**
 * Determines the type of a given script.
 * @param {RegexScript} script The script to check
 * @returns {SCRIPT_TYPES} The script type.
 */
function getScriptType(script) {
    for (const scriptType of Object.values(SCRIPT_TYPES)) {
        const scripts = getScriptsByType(scriptType);
        if (scripts.includes(script)) {
            return scriptType;
        }
    }
    return SCRIPT_TYPE_UNKNOWN;
}

function getSelectedScripts() {
    const typesByScope = { global: SCRIPT_TYPES.GLOBAL, preset: SCRIPT_TYPES.PRESET, character: SCRIPT_TYPES.SCOPED };
    return (drawer?.getSelection() ?? [])
        .map(({ scope, id }) => getScriptsByType(typesByScope[scope]).find(script => script.id === id))
        .filter(Boolean);
}

function purgeEmbeddedRegexScripts({ character }) {
    const avatar = character?.avatar;
    if (!avatar) {
        return;
    }
    const checkKey = `AlertRegex_${avatar}`;
    if (accountStorage.getItem(checkKey)) {
        accountStorage.removeItem(checkKey);
    }
    disallowScopedScripts(characters?.[this_chid]);
}

function purgePresetEmbeddedRegexScripts({ apiId, name }) {
    const checkKey = `AlertRegex_${apiId}_${name}`;
    if (accountStorage.getItem(checkKey)) {
        accountStorage.removeItem(checkKey);
    }
    disallowPresetScripts(apiId, name);
}

async function checkCharEmbeddedRegexScripts() {
    const chid = this_chid;

    if (chid !== undefined && !selected_group) {
        const character = characters[chid];
        const scripts = getScriptsByType(SCRIPT_TYPES.SCOPED);

        if (Array.isArray(scripts) && scripts.length > 0) {
            if (!isScopedScriptsAllowed(character)) {
                const checkKey = `AlertRegex_${character.avatar}`;
                if (!accountStorage.getItem(checkKey)) {
                    accountStorage.setItem(checkKey, 'true');
                    const template = await renderExtensionTemplateAsync('regex', 'embeddedScripts', {});
                    const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '');

                    if (result) {
                        allowScopedScripts(character);
                        await reloadCurrentChat();
                    }
                }
            }
        }
    }

    // Clear cache and reload scripts
    RegexProvider.instance.clear();
    await loadRegexScripts();
}

/**
 * Notify whether to reload current chat when preset is changed
 * @param {string} presetName The name of the preset
 */
function notifyReloadCurrentChat(presetName) {
    if (isRegexProcessingPaused()) return;
    toastr.info(
        t`Reload the chat for regex to take effect` + '<br><u>' + t`Click here to reload immediately` + '</u>',
        t`Preset '${escapeHtml(presetName)}' contains enabled regex scripts`,
        {
            timeOut: 5000,
            escapeHtml: false,
            onclick: reloadCurrentChat,
        });
}

async function checkPresetEmbeddedRegexScripts() {
    const apiId = getCurrentPresetAPI();
    const name = getCurrentPresetName();
    const scripts = getScriptsByType(SCRIPT_TYPES.PRESET);

    if (Array.isArray(scripts) && scripts.length > 0) {
        if (!isPresetScriptsAllowed(apiId, name)) {
            const checkKey = `AlertRegex_${apiId}_${name}`;

            if (!accountStorage.getItem(checkKey)) {
                accountStorage.setItem(checkKey, 'true');
                const template = await renderExtensionTemplateAsync('regex', 'presetEmbeddedScripts', {});
                const result = await callGenericPopup(template, POPUP_TYPE.CONFIRM, '');

                if (result) {
                    allowPresetScripts(apiId, name);
                    if (getCurrentChatId()) {
                        await reloadCurrentChat();
                    }
                }
            }
        } else if (getCurrentChatId() && scripts.filter(script => !script.disabled).length > 0) {
            notifyReloadCurrentChat(name);
        }
    }

    await loadRegexScripts();
}

async function onMainApiChanged({ apiId }) {
    const presetManager = getPresetManager(apiId);
    if (!presetManager) {
        return;
    }
    const presetName = presetManager.getSelectedPresetName();
    const presetScripts = presetManager.readPresetExtensionField({ path: 'regex_scripts' }) ?? [];
    if (getCurrentChatId() &&
        isPresetScriptsAllowed(apiId, presetName) &&
        Array.isArray(presetScripts) &&
        presetScripts.filter(script => !script.disabled).length > 0) {
        notifyReloadCurrentChat(presetName);
    }

    await loadRegexScripts();
}

function onPresetRenamed({ apiId, oldName, newName }) {
    const oldCheckKey = `AlertRegex_${apiId}_${oldName}`;
    const checkKey = `AlertRegex_${apiId}_${newName}`;
    const value = accountStorage.getItem(oldCheckKey);
    if (value) {
        accountStorage.setItem(checkKey, value);
        accountStorage.removeItem(oldCheckKey);
    }
    if (isPresetScriptsAllowed(apiId, oldName)) {
        disallowPresetScripts(apiId, oldName);
        allowPresetScripts(apiId, newName);
    }
}

// Workaround for loading in sequence with other extensions
// NOTE: Always puts extension at the top of the list, but this is fine since it's static
export async function init() {
    if (!Array.isArray(extension_settings.regex)) {
        extension_settings.regex = [];
    }

    if (!Array.isArray(extension_settings.regex_presets)) {
        extension_settings.regex_presets = [];
    }

    // Manually disable the extension since static imports auto-import the JS file
    if (extension_settings.disabledExtensions.includes('regex')) {
        return;
    }

    migrateSettings();

    const settingsHtml = $(await renderExtensionTemplateAsync('regex', 'dropdown'));
    $('#regex_container').append(settingsHtml);
    const toggle = document.querySelector('#regex-drawer-button > .drawer-toggle');
    drawer = createRegexDrawer(settingsHtml[0], {
        getLayout: () => extension_settings.chloRegexLayout,
        saveLayout: layout => {
            extension_settings.chloRegexLayout = layout;
            saveSettingsDebounced();
        },
        toggleDrawer: () => toggle.click(),
        moveRule: async (scope, id, delta) => {
            const type = Object.values(SCRIPT_TYPES).find(value => scopesByType[value] === scope);
            const scripts = [...getScriptsByType(type)];
            const index = scripts.findIndex(script => script.id === id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= scripts.length) return;
            [scripts[index], scripts[target]] = [scripts[target], scripts[index]];
            await saveRegexOrder(scripts, type);
            const trigger = drawer.getVisibleRows().find(row => row.scope === scope && row.id === id);
            trigger?.node.querySelector('.edit_existing_regex').focus({ preventScroll: true });
        },
        updateBulk: setMoveButtonsVisibility,
    });

    $('#open_regex_editor').on('click', function () {
        onRegexEditorOpenClick(false, SCRIPT_TYPES.GLOBAL);
    });
    $('#open_regex_debugger').on('click', onRegexDebuggerOpenClick);
    $('#open_scoped_editor').on('click', function () {
        if (this_chid === undefined) {
            toastr.error(t`No character selected.`);
            return;
        }

        if (selected_group) {
            toastr.error(t`Cannot edit scoped scripts in group chats.`);
            return;
        }

        onRegexEditorOpenClick(false, SCRIPT_TYPES.SCOPED);
    });
    $('#open_preset_editor').on('click', function () {
        onRegexEditorOpenClick(false, SCRIPT_TYPES.PRESET);
    });
    $('#import_regex_file').on('change', async function () {
        let target = SCRIPT_TYPES.GLOBAL;
        const template = $(await renderExtensionTemplateAsync('regex', 'importTarget'));
        template.find('#regex_import_target_global').on('input', () => (target = SCRIPT_TYPES.GLOBAL));
        template.find('#regex_import_target_scoped').on('input', () => (target = SCRIPT_TYPES.SCOPED));
        template.find('#regex_import_target_preset').on('input', () => (target = SCRIPT_TYPES.PRESET));

        await callGenericPopup(template, POPUP_TYPE.TEXT);

        const inputElement = this instanceof HTMLInputElement && this;
        for (const file of inputElement.files) {
            await onRegexImportFileChange(file, target);
        }
        inputElement.value = '';
    });
    $('#import_regex').on('click', function () {
        $('#import_regex_file').trigger('click');
    });

    $('#bulk_select_all_toggle').on('click', async function () {
        const boxes = drawer.getVisibleRows().map(row => row.node.querySelector('.regex_bulk_checkbox'));
        if (!boxes.length) return;
        const selected = !boxes.every(box => box.checked);
        boxes.forEach(box => { box.checked = selected; });
        setMoveButtonsVisibility();
    });

    $('#bulk_enable_regex').on('click', async function () {
        await bulkToggleRegexScripts(true);
    });

    $('#bulk_disable_regex').on('click', async function () {
        await bulkToggleRegexScripts(false);
    });

    /**
     * Bulk enable or disable regex scripts
     * @param {boolean} newState New state to set (true = enable, false = disable)
     * @returns {Promise<void>}
     */
    async function bulkToggleRegexScripts(newState) {
        const scripts = getSelectedScripts().filter(script => script.disabled === newState);
        if (scripts.length === 0) {
            toastr.warning(newState
                ? t`No regex scripts selected for enabling.`
                : t`No regex scripts selected for disabling.`,
            );
            return;
        }
        const scriptTypesToSave = new Set();
        for (const script of scripts) {
            const scriptType = getScriptType(script);
            scriptTypesToSave.add(scriptType);
            script.disabled = !newState;
        }
        for (const scriptType of scriptTypesToSave) {
            const scriptsOfType = getScriptsByType(scriptType);
            await saveScriptsByType(scriptsOfType, scriptType);
        }

        saveSettingsDebounced();
        await loadRegexScripts();

        // Reload the current chat to undo previous markdown
        const currentChatId = getCurrentChatId();
        if (currentChatId) {
            await reloadCurrentChat();
        }
    }

    /**
     * Bulk move regex scripts to the specified type
     * @param {SCRIPT_TYPES} toType destination type
     */
    async function bulkMoveRegexScript(toType) {
        const scripts = getSelectedScripts();
        if (scripts.length === 0) {
            toastr.warning(t`No regex scripts selected for moving.`);
            return;
        }
        for (const script of scripts) {
            await moveRegexScript(script, toType, getScriptType(script), false);
        }

        saveSettingsDebounced();
        await loadRegexScripts();

        // Reload the current chat to undo previous markdown
        const currentChatId = getCurrentChatId();
        if (currentChatId) {
            await reloadCurrentChat();
        }
    }

    $('#bulk_regex_move_to_global').on('click', async () => {
        const confirm = await callGenericPopup(t`Are you sure you want to move the selected regex scripts to global?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            return;
        }
        await bulkMoveRegexScript(SCRIPT_TYPES.GLOBAL);
    });

    $('#bulk_regex_move_to_scoped').on('click', async () => {
        if (this_chid === undefined) {
            toastr.error(t`No character selected.`);
            return;
        }
        if (selected_group) {
            toastr.error(t`Cannot edit scoped scripts in group chats.`);
            return;
        }
        const confirm = await callGenericPopup(t`Are you sure you want to move the selected regex scripts to scoped?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            return;
        }
        await bulkMoveRegexScript(SCRIPT_TYPES.SCOPED);
    });

    $('#bulk_regex_move_to_preset').on('click', async function () {
        const confirm = await callGenericPopup(t`Are you sure you want to move the selected regex scripts to preset?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            return;
        }
        await bulkMoveRegexScript(SCRIPT_TYPES.PRESET);
    });

    $('#bulk_delete_regex').on('click', async function () {
        const scripts = getSelectedScripts();
        if (scripts.length === 0) {
            toastr.warning(t`No regex scripts selected for deletion.`);
            return;
        }
        const confirm = await callGenericPopup(t`Are you sure you want to delete the selected regex scripts?`, POPUP_TYPE.CONFIRM);
        if (!confirm) {
            return;
        }
        for (const script of scripts) {
            await deleteRegexScript(script.id, getScriptType(script), false);
        }
        saveSettingsDebounced();
        await loadRegexScripts();
        await reloadCurrentChat();
    });

    $('#bulk_export_regex').on('click', async function () {
        const scripts = getSelectedScripts();
        if (scripts.length === 0) {
            toastr.warning(t`No regex scripts selected for export.`);
            return;
        }
        const fileName = `regex-${new Date().toISOString()}.json`;
        const fileData = JSON.stringify(scripts, null, 4);
        download(fileData, fileName, 'application/json');
        await loadRegexScripts();
    });

    async function saveRegexOrder(scripts, type) {
        await saveScriptsByType(scripts, type);
        saveSettingsDebounced();
        await loadRegexScripts();
        if (getCurrentChatId()) await reloadCurrentChat();
    }
    const orderLists = {
        [SCRIPT_TYPES.GLOBAL]: '#saved_regex_scripts',
        [SCRIPT_TYPES.PRESET]: '#saved_preset_scripts',
        [SCRIPT_TYPES.SCOPED]: '#saved_scoped_scripts',
    };
    for (const type of Object.values(SCRIPT_TYPES)) {
        const list = $(orderLists[type]);
        let sortOwner;
        // @ts-ignore
        list.sortable({
            delay: getSortableDelay(),
            handle: '.drag-handle',
            items: '> .regex-script-label',
            start: () => { sortOwner = getDrawerContext().owners[scopesByType[type]]; },
            stop: async () => {
                const oldScripts = getScriptsByType(type);
                const scriptsById = new Map(oldScripts.map(script => [script.id, script]));
                const ids = list.children('.regex-script-label').map((_, row) => row.getAttribute('data-regex-id')).get();
                // A view change or a scope switch cannot overwrite a partially rendered list.
                if (sortOwner !== getDrawerContext().owners[scopesByType[type]]
                    || new Set(ids).size !== oldScripts.length || ids.some(id => !scriptsById.has(id))) {
                    await loadRegexScripts();
                    return;
                }
                const sorted = ids.map(id => scriptsById.get(id));
                if (sorted.some((script, index) => oldScripts[index] !== script)) await saveRegexOrder(sorted, type);
            },
        });
    }

    $('#regex_scoped_toggle').on('input', function () {
        if (this_chid === undefined) {
            toastr.error(t`No character selected.`);
            return;
        }

        if (selected_group) {
            toastr.error(t`Cannot edit scoped scripts in group chats.`);
            return;
        }

        const isEnable = !!$(this).prop('checked');
        const character = characters[this_chid];

        if (isEnable) {
            allowScopedScripts(character);
        } else {
            disallowScopedScripts(character);
        }

        saveSettingsDebounced();
        loadRegexScripts();
        if (getCurrentChatId()) reloadCurrentChat();
    });

    $('#chlo-regex-master-toggle').on('change', async function () {
        const enabled = this.checked;
        const context = getDrawerContext();
        const updates = [];
        this.disabled = true;
        try {
            for (const type of Object.values(SCRIPT_TYPES)) {
                if (type === SCRIPT_TYPES.SCOPED && !context.hasCharacter) continue;
                if (type === SCRIPT_TYPES.PRESET && !context.hasPreset) continue;
                const scripts = getScriptsByType(type);
                if (!scripts.some(rule => Boolean(rule.disabled) === enabled)) continue;
                const updated = scripts.map(rule => ({ ...rule, disabled: !enabled }));
                // Start each write before yielding so it targets the selected preset/character.
                updates.push(saveScriptsByType(updated, type));
            }
            await Promise.all(updates);
            // Keep previously persisted pauses until the user explicitly applies a new state.
            delete extension_settings.chloRegexPaused;
            saveSettingsDebounced();
            if (getCurrentChatId()) await reloadCurrentChat();
        } finally {
            await loadRegexScripts();
        }
    });

    $('#regex_preset_toggle').on('change', async function () {
        const api = getCurrentPresetAPI();
        const name = getCurrentPresetName();
        if (!api || !name) return;

        // An explicit choice should not trigger the first-use prompt next time.
        accountStorage.setItem(`AlertRegex_${api}_${name}`, 'true');
        if (this.checked) {
            allowPresetScripts(api, name);
        } else {
            disallowPresetScripts(api, name);
        }
        saveSettingsDebounced();
        await loadRegexScripts();
        if (getCurrentChatId()) await reloadCurrentChat();
    });

    await loadRegexScripts();
    const panel = document.getElementById('chlo-regex-drawer');
    let wasOpen = false;
    new MutationObserver(() => {
        const open = panel.classList.contains('openDrawer');
        if (open && !wasOpen) void loadRegexScripts();
        wasOpen = open;
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    $('#regex-drawer-button').removeClass('displayNone');

    /**
     * @typedef {object} ScriptDecorators
     * @property {string} typename
     * @property {import('../../slash-commands/SlashCommandEnumValue.js').EnumType} color
     * @property {string} icon
     */

    /**
     * @param {SCRIPT_TYPES} type The script type
     * @returns {ScriptDecorators} The decorators for the script type
     */
    function getScriptDecorators(type) {
        switch (type) {
            case SCRIPT_TYPES.GLOBAL:
                return {
                    typename: 'global',
                    color: enumTypes.enum,
                    icon: 'G',
                };
            case SCRIPT_TYPES.SCOPED:
                return {
                    typename: 'scoped',
                    color: enumTypes.name,
                    icon: 'S',
                };
            case SCRIPT_TYPES.PRESET:
                return {
                    typename: 'preset',
                    color: enumTypes.name,
                    icon: 'P',
                };
            default:
                return {
                    typename: 'Unknown',
                    color: enumTypes.variable,
                    icon: 'Unknown',
                };
        }
    }

    const localEnumProviders = {
        regexScripts: () =>
            getRegexScripts().map(script => {
                const type = getScriptType(script);
                const { typename, color, icon } = getScriptDecorators(type);
                return new SlashCommandEnumValue(
                    script.scriptName,
                    `${enumIcons.getStateIcon(!script.disabled)} [${typename}] ${script.findRegex}`,
                    color,
                    icon,
                );
            }),
    };

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'regex',
        callback: runRegexCallback,
        returns: 'replaced text',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'script name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: localEnumProviders.regexScripts,
            }),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'input', [ARGUMENT_TYPE.STRING], false,
            ),
        ],
        helpString: 'Runs a Regex extension script by name on the provided string. The script must be enabled.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'regex-state',
        /** @param {object} _ @param {string} name */
        callback: (_, name) => {
            if (!name) {
                toastr.warning('No regex script name provided.');
                return '';
            }

            const scripts = getRegexScripts();
            const script = scripts.find(s => equalsIgnoreCaseAndAccents(s.scriptName, name));

            if (!script) {
                toastr.warning(`Regex script "${name}" not found.`);
                return '';
            }

            return script.disabled ? 'false' : 'true';
        },
        returns: 'true (for enabled) or false (for disabled)',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'script name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: localEnumProviders.regexScripts,
            }),
        ],
        helpString: 'Returns the current state of a regex script.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'regex-toggle',
        callback: toggleRegexCallback,
        returns: 'The name of the script that was toggled',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'state',
                description: 'Explicitly set the state of the script (\'on\' to enable, \'off\' to disable). If not provided, the state will be toggled to the opposite of the current state.',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'toggle',
                enumList: commonEnumProviders.boolean('onOffToggle')(),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: 'Suppress the toast message script toggled',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
                enumList: commonEnumProviders.boolean('trueFalse')(),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'script name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumProvider: localEnumProviders.regexScripts,
            }),
        ],
        helpString: `
            <div>
                Toggles the state of a specified regex script.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code class="language-stscript">/regex-toggle MyScript</code></pre>
                    </li>
                    <li>
                        <pre><code class="language-stscript">/regex-toggle state=off Character-specific Script</code></pre>
                    </li>
                </ul>
            </div>
        `,
    }));

    eventSource.on(event_types.MAIN_API_CHANGED, onMainApiChanged);
    eventSource.on(event_types.CHAT_CHANGED, checkCharEmbeddedRegexScripts);
    eventSource.on(event_types.CHARACTER_DELETED, purgeEmbeddedRegexScripts);
    eventSource.on(event_types.PRESET_RENAMED_BEFORE, onPresetRenamed);
    eventSource.on(event_types.PRESET_CHANGED, checkPresetEmbeddedRegexScripts);
    eventSource.on(event_types.PRESET_DELETED, purgePresetEmbeddedRegexScripts);

    presetManager.setupEventListeners();
    presetManager.registerSlashCommands();
}

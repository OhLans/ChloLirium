import { getSettings } from './settings-service.js';
import { toggleSettingsPopout } from '../ui/controls.js';
import { t } from '../../../../i18n.js';

export function addThemeButtonsHint() {
    const container = document.getElementById('UI-presets-block');
    if (!container) return;
    let hint = document.getElementById('moonlit-theme-buttons-hint');
    if (!getSettings()?.enabled) {
        hint?.remove();
        return;
    }
    if (hint) return;
    hint = document.createElement('button');
    hint.id = 'moonlit-theme-buttons-hint';
    hint.type = 'button';
    hint.className = 'menu_button menu_button_icon';
    hint.textContent = t`Customize Moonlit appearance`;
    hint.addEventListener('click', toggleSettingsPopout);
    container.append(hint);
}

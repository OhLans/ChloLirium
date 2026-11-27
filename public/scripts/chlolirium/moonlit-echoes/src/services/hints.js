import { getSettings } from './settings-service.js';
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
    hint.textContent = t`Customize appearance`;
    hint.addEventListener('click', () => document.dispatchEvent(new Event('chlo:open-appearance')));
    container.append(hint);
}

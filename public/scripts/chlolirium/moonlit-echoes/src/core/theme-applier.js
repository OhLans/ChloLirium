import { EXTENSION_FOLDER_PATH } from '../config/theme-info.js';

/**
 * Update an appearance variable and any stylesheet controlled by that setting.
 * @param {{ varId: string, cssBlock?: string, cssFile?: string }} setting - Appearance control definition.
 * @param {string|number|boolean} value - Current control value.
 * @returns {boolean} Whether anything was changed.
 */
export function applyAppearanceProperty({ varId, cssBlock, cssFile }, value) {
    const root = document.documentElement.style;
    const property = `--${varId}`;
    const cssValue = String(value);
    let changed = root.getPropertyValue(property).trim() !== cssValue.trim() || root.getPropertyPriority(property) !== 'important';
    if (changed) {
        root.setProperty(property, cssValue, 'important');
    }

    if (!cssBlock && !cssFile) return changed;
    const enabled = value === true || value === 'true';
    const id = `css-block-${varId}`;
    let stylesheet = document.getElementById(id);
    if (!stylesheet) {
        if (cssFile && !enabled) return changed;
        // Keep inline rules in a fixed cascade order across theme switches.
        stylesheet = document.createElement(cssFile ? 'link' : 'style');
        stylesheet.id = id;
        if (cssFile) {
            stylesheet.rel = 'stylesheet';
            stylesheet.href = `${EXTENSION_FOLDER_PATH}/css/${cssFile}`;
        }
        const customCss = document.getElementById('moonlit-raw-css');
        if (customCss) customCss.before(stylesheet);
        else document.head.append(stylesheet);
    }

    if (cssFile) {
        if (stylesheet.disabled !== !enabled) {
            stylesheet.disabled = !enabled;
            changed = true;
        }
    } else {
        const css = enabled ? cssBlock : '';
        if (stylesheet.textContent !== css) {
            stylesheet.textContent = css;
            changed = true;
        }
    }
    return changed;
}

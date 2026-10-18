import { escapeHtml } from '../../utils.js';
import { blockCategory, getBlocks } from './model.js';

export const esc = value => escapeHtml(String(value ?? ''));
export const icon = name => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
export const button = (action, label, className = '') => `<button type="button" data-action="${action}" class="${className}">${label}</button>`;

function cover(preset, title, className = '') {
    const art = preset.chlo_preset?.cover;
    const safe = typeof art === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(art);
    return `<div class="pw-cover ${className}">${safe ? `<img src="${art}" alt="">` : `${icon('book-open')}<span>${esc(title.slice(0, 2))}</span>`}</div>`;
}

export class PresetLibrary {
    constructor(workspace) {
        this.workspace = workspace;
        this.filter = 'all';
    }

    render() {
        const w = this.workspace;
        const search = w.root.querySelector('#pw-search').value.toLocaleLowerCase();
        const names = w.names().filter(name => name.toLocaleLowerCase().includes(search)
            && (this.filter !== 'favorites' || w.preferences.favorites.includes(name))
            && (this.filter !== 'recent' || w.preferences.recent.includes(name)));
        if (this.filter === 'recent') names.sort((a, b) => w.preferences.recent.indexOf(a) - w.preferences.recent.indexOf(b));
        w.root.querySelectorAll('[data-filter]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.filter === this.filter)));
        const list = w.root.querySelector('#pw-preset-list');
        const scroll = list.scrollTop;
        list.innerHTML = names.map(name => {
            const preset = w.preset(name);
            const active = name === w.activeName();
            const favorite = w.preferences.favorites.includes(name);
            return `<article class="pw-preset-card ${name === w.selected ? 'pw-selected' : ''}" data-preset="${esc(name)}">
                <button type="button" class="pw-card-select" data-select="${esc(name)}" aria-pressed="${name === w.selected}">${cover(preset, name)}<span><strong>${esc(name)}</strong><span class="pw-card-meta">${getBlocks(preset).filter(block => block.entry).length} blocks ${active ? '<span class="pw-badge">Active</span>' : ''}</span></span></button>
                <button type="button" class="pw-favorite" data-favorite="${esc(name)}" aria-pressed="${favorite}" aria-label="${favorite ? 'Unfavorite' : 'Favorite'} ${esc(name)}">${icon('star')}</button>
                <div class="pw-card-actions"><button type="button" data-use="${esc(name)}" class="pw-primary">Use</button><button type="button" data-edit="${esc(name)}">Edit</button></div>
            </article>`;
        }).join('') || '<p class="pw-empty">No matching presets. Try another search or import a preset.</p>';
        list.scrollTop = scroll;
        this.renderDetails();
    }

    renderDetails() {
        const w = this.workspace;
        const host = w.root.querySelector('#pw-preset-details');
        if (!w.selected || !w.names().includes(w.selected)) {
            host.innerHTML = '<p class="pw-empty">Choose a preset from your collection.</p>';
            return;
        }
        const preset = w.preset(w.selected);
        const blocks = getBlocks(preset);
        const categories = new Map();
        blocks.filter(block => block.entry).forEach(({ prompt }) => {
            const group = blockCategory(prompt);
            categories.set(group, (categories.get(group) ?? 0) + 1);
        });
        host.innerHTML = `${cover(preset, w.selected, 'pw-cover-large')}
            <div class="pw-detail-heading"><h3>${esc(w.selected)}</h3>${w.selected === w.activeName() ? '<span class="pw-badge">Active</span>' : ''}</div>
            <p class="pw-description">${esc(preset.chlo_preset?.description || 'A space for your voice, characters, and story.')}</p>
            <p class="pw-muted">${blocks.filter(block => block.entry).length} blocks · ${categories.size} categories</p>
            <div class="pw-detail-actions"><button type="button" data-use="${esc(w.selected)}" class="pw-primary">${icon('play')} Use in chat</button><button type="button" data-edit="${esc(w.selected)}">${icon('pencil')} Edit blocks</button>${button('duplicate', 'Duplicate')}</div>
            <div class="pw-category-summary">${[...categories].map(([category, count]) => `<button type="button" data-category="${esc(category)}">${icon('layer-group')}<strong>${esc(category)}</strong><span>${count} blocks</span>${icon('chevron-right')}</button>`).join('')}</div>
            <p class="pw-muted pw-collection-note">Generation parameters are shared across your collection.</p>`;
    }
}

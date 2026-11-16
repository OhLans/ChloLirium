/** A view of the native list: search/collapse never edit prompt order or state. */
export class PromptOutline {
    constructor({ root, manager, select, insert }) {
        Object.assign(this, { root, manager, select, insert });
        this.collapsed = new Set();
        this.search = root.querySelector('input[type=search]');
        this.status = root.querySelector('[role=status]');
        this.search.addEventListener('input', () => this.filter());
        root.addEventListener('click', event => {
            const section = event.target.closest('.chlo-section-toggle');
            if (section) {
                const key = section.dataset.section;
                if (this.collapsed.has(key)) this.collapsed.delete(key);
                else this.collapsed.add(key);
                this.filter();
            }
            const add = event.target.closest('[data-insert-after]');
            if (add) insert(add.dataset.insertAfter || null);
        });
        root.addEventListener('keydown', event => {
            const inspect = event.target.closest('.prompt_manager_prompt_tokens[role=button]');
            if (inspect && ['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                inspect.click();
                return;
            }
            const name = event.target.closest('.completion_prompt_manager_prompt_name');
            if (name && ['Enter', ' '].includes(event.key)) {
                event.preventDefault();
                select(name.closest('[data-pm-identifier]').dataset.pmIdentifier);
            }
        });
    }

    decorate() {
        const manager = this.manager(), list = manager.listElement;
        if (!list) return;
        list.querySelectorAll('.chlo-insert-line').forEach(node => node.remove());
        const rows = [...list.querySelectorAll('[data-pm-identifier]')];
        let section = '';
        for (const node of [...list.children]) {
            if (node.classList.contains('chlo-prompt-section')) {
                const next = node.nextElementSibling;
                section = next?.dataset.pmIdentifier ?? node.textContent;
                const label = node.querySelector('button')?.textContent ?? node.textContent;
                node.replaceChildren();
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'chlo-section-toggle';
                button.dataset.section = section;
                button.textContent = label;
                node.append(button);
            } else if (node.dataset.pmIdentifier) {
                node.dataset.outlineSection = section;
                const name = node.querySelector('.completion_prompt_manager_prompt_name');
                name.tabIndex = 0;
                name.setAttribute('role', 'button');
                name.setAttribute('aria-label', `Open ${manager.getPromptById(node.dataset.pmIdentifier)?.name ?? 'prompt'}`);
                const tokens = node.querySelector('.prompt_manager_prompt_tokens');
                if (manager.messages?.hasItemWithIdentifier(node.dataset.pmIdentifier)) {
                    tokens.setAttribute('role', 'button');
                    tokens.tabIndex = 0;
                    tokens.title = 'Inspect the assembled prompt';
                }
            }
        }
        const boundary = (id, label, group) => {
            const li = document.createElement('li');
            li.className = 'chlo-insert-line';
            li.dataset.outlineSection = group;
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.insertAfter = id ?? '';
            button.setAttribute('aria-label', label);
            button.title = label;
            button.innerHTML = '<span aria-hidden="true">+</span>';
            li.append(button);
            return li;
        };
        if (rows.length) rows[0].before(boundary(null, 'Add prompt at the beginning', rows[0].dataset.outlineSection));
        for (const row of rows) {
            const prompt = manager.getPromptById(row.dataset.pmIdentifier);
            if (!prompt) continue;
            row.after(boundary(prompt.identifier, `Add prompt after ${prompt.name}`, row.dataset.outlineSection));
        }
        const footer = manager.containerElement.querySelector('.completion_prompt_manager_footer');
        if (footer && !footer.closest('details')) {
            const details = document.createElement('details');
            details.className = 'chlo-prompt-library-tools';
            details.innerHTML = '<summary>Prompt library tools</summary>';
            list.after(details);
            details.append(footer);
        }
        this.filter();
    }

    filter() {
        const manager = this.manager(), list = manager.listElement;
        if (!list) return;
        const query = this.search.value.trim().toLocaleLowerCase();
        const rows = [...list.querySelectorAll('[data-pm-identifier]')];
        const matchingSections = new Set();
        let matches = 0;
        for (const row of rows) {
            const prompt = manager.getPromptById(row.dataset.pmIdentifier);
            const match = !query || `${prompt?.name ?? ''}\n${prompt?.content ?? ''}`.toLocaleLowerCase().includes(query);
            if (match) { matches++; matchingSections.add(row.dataset.outlineSection); }
            row.hidden = !match || (!query && this.collapsed.has(row.dataset.outlineSection));
            row.classList.toggle('chlo-prompt-selected', row.dataset.pmIdentifier === this.selected);
            row.querySelector('[role=button]')?.setAttribute('aria-pressed', String(row.dataset.pmIdentifier === this.selected));
        }
        for (const button of list.querySelectorAll('.chlo-section-toggle')) {
            button.closest('li').hidden = Boolean(query && !matchingSections.has(button.dataset.section));
            button.setAttribute('aria-expanded', String(Boolean(query) || !this.collapsed.has(button.dataset.section)));
        }
        for (const line of list.querySelectorAll('.chlo-insert-line')) line.hidden = Boolean(query) || this.collapsed.has(line.dataset.outlineSection);
        this.status.textContent = query ? `${matches} of ${rows.length} blocks · Clear search to reorder` : `${rows.length} blocks · Drag the handle to reorder`;
        if ($(list).hasClass('ui-sortable')) {
            this.nativeSort ??= { handle: $(list).sortable('option', 'handle'), disabled: $(list).sortable('option', 'disabled') };
            $(list).sortable('option', { handle: '.drag-handle', disabled: Boolean(query) || this.nativeSort.disabled });
        }
    }

    choose(identifier) {
        this.selected = identifier;
        this.filter();
    }

    reveal(identifier) {
        this.search.value = '';
        const row = [...this.manager().listElement.querySelectorAll('[data-pm-identifier]')].find(row => row.dataset.pmIdentifier === identifier);
        if (row) {
            this.collapsed.delete(row.dataset.outlineSection);
            this.choose(identifier);
            row.scrollIntoView({ block: 'nearest' });
        }
    }

    clean() {
        const manager = this.manager();
        manager.containerElement.querySelectorAll('.chlo-insert-line').forEach(node => node.remove());
        for (const button of manager.containerElement.querySelectorAll('.chlo-section-toggle')) button.parentElement.textContent = button.textContent;
        manager.containerElement.querySelectorAll('.chlo-prompt-section').forEach(node => node.hidden = false);
        for (const row of manager.containerElement.querySelectorAll('[data-pm-identifier]')) {
            row.hidden = false;
            row.classList.remove('chlo-prompt-selected');
            const name = row.querySelector('.completion_prompt_manager_prompt_name');
            for (const attribute of ['tabindex', 'role', 'aria-label', 'aria-pressed']) name?.removeAttribute(attribute);
            const tokens = row.querySelector('.prompt_manager_prompt_tokens');
            for (const attribute of ['tabindex', 'role']) tokens?.removeAttribute(attribute);
            if (tokens?.title === 'Inspect the assembled prompt') tokens.removeAttribute('title');
        }
        const tools = manager.containerElement.querySelector('.chlo-prompt-library-tools');
        if (tools) {
            manager.containerElement.querySelector('.completion_prompt_manager_header').after(tools.querySelector('.completion_prompt_manager_footer'));
            tools.remove();
        }
        if (this.nativeSort && $(manager.listElement).hasClass('ui-sortable')) $(manager.listElement).sortable('option', this.nativeSort);
        this.nativeSort = null;
    }
}

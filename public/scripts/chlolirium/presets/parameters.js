/** Move the actual native controls, with all jQuery listeners and IDs intact.
 * Comment anchors restore their exact positions when leaving Parameters. */
export class SharedParameters {
    moved = [];

    move(node, target) {
        if (!node) return;
        const anchor = document.createComment('shared parameter control');
        node.before(anchor);
        this.moved.push({ node, anchor });
        target.append(node);
    }

    mount(host) {
        const range = document.getElementById('range_block_openai');
        this.move(range, host);
        const limits = document.createElement('section');
        limits.className = 'pw-parameter-group';
        limits.innerHTML = '<h3>Context & reply</h3>';
        const behavior = limits.cloneNode();
        behavior.innerHTML = '<h3>Generation behavior</h3>';
        const advanced = document.createElement('details');
        advanced.className = 'pw-parameter-group';
        advanced.innerHTML = '<summary>Advanced generation settings</summary>';
        const children = [...range.children];
        for (const node of children) {
            const isLimit = node.querySelector('#oai_max_context_unlocked, #openai_max_context, #openai_max_tokens, #n_openai');
            const isBehavior = node.querySelector('#stream_toggle, #temp_openai, #top_p_openai');
            this.move(node, isLimit ? limits : isBehavior ? behavior : advanced);
        }
        range.append(limits, behavior, advanced);
        this.groups = [limits, behavior, advanced];
        const formatting = document.createElement('details');
        formatting.className = 'pw-parameter-group';
        formatting.innerHTML = '<summary>Formatting & provider options</summary><p class="pw-muted">Prompt formatting is saved with your prompt preset.</p>';
        this.move(document.getElementById('openai_settings'), formatting);
        this.move(document.getElementById('logit_bias_openai'), formatting);
        host.append(formatting);
        this.formatting = formatting;
    }

    restore() {
        // Child controls return before their containing range panel.
        for (const { node, anchor } of this.moved.reverse()) {
            if (anchor.isConnected) anchor.replaceWith(node);
            else document.getElementById('openai_api-presets').append(node);
        }
        this.moved = [];
        this.groups?.forEach(group => group.remove());
        this.formatting?.remove();
    }
}

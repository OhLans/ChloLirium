let choicesPromise;

/**
 * Load Lucide choices on demand. Return a legacy class first so saved Quick
 * Replies and extensions using showFontAwesomePicker keep their existing format.
 * @returns {Promise<string[][]>} Searchable groups of compatible icon classes.
 */
export function getLucideIconChoices() {
    if (!choicesPromise) {
        choicesPromise = fetch('/icons/lucide/catalog.json')
            .then(response => {
                if (!response.ok) throw new Error('Could not load the Lucide icon catalog.');
                return response.json();
            })
            .then(catalog => catalog.map(({ name, aliases }) => [...aliases, `cl-icon-${name}`]))
            .catch(error => {
                choicesPromise = undefined;
                throw error;
            });
    }
    return choicesPromise;
}

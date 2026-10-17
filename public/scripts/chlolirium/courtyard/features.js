// Developer switches, applied on page reload. Each feature keeps its own
// implementation and stylesheet. Runtime toggling is intentionally not exposed.
export const features = Object.freeze({
    navigator: true,
    characterPanels: true,
    personaPanels: true,
    icons: true, // Requires Navigator; portraits and native clicks stay native.
});

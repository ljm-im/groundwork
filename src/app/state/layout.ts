export const defaults = { right: 360, bottom: .3, upper: .5, bottomClosed: false, propertiesClosed: false };
export type Layout = typeof defaults;
const key = "groundwork/editor-layout-v1";
export function revealInPanel(panel: HTMLElement | undefined, target: Element | null | undefined) {
    if (!panel || !target) return;
    const area = panel.getBoundingClientRect();
    if (area.bottom <= 0 || area.top >= window.innerHeight || area.right <= 0 || area.left >= window.innerWidth) return;

    const top = area.top + panel.clientTop, bottom = top + panel.clientHeight;
    const row = target.getBoundingClientRect();
    const above = row.top < top, below = row.bottom > bottom;
    if (above === below) return;
    const fits = row.height <= panel.clientHeight;
    panel.scrollTop += above === fits ? row.top - top : row.bottom - bottom;
}

export function readLayout(): Layout {
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? "null");
        if (v && Number.isFinite(v.right) && v.right >= 270 &&
            [v.bottom, v.upper].every(n => Number.isFinite(n) && n > 0 && n < 1) &&
            typeof v.bottomClosed === "boolean" && typeof v.propertiesClosed === "boolean")
            return { right: v.right, bottom: v.bottom, upper: v.upper, bottomClosed: v.bottomClosed, propertiesClosed: v.propertiesClosed };
    }
    catch { /* Storage may be unavailable in a private session. */ }
    return { ...defaults };
}
export function saveLayout(layout: Layout) {
    try {
        localStorage.setItem(key, JSON.stringify(layout));
    }
    catch { /* The current session retains its layout. */ }
}
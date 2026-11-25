import { composingKey } from "./numbers.ts";

interface AnchorBounds { top: number; bottom: number; left: number; width: number }
type PopupPosition = { close: () => void } & (
    { anchor: HTMLElement; viewport?: boolean; expanded?: boolean } | { point: { x: number; y: number } }
);

export function menuDirection(event: KeyboardEvent) {
    return !composingKey(event) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key);
}

export function popupBounds(box: AnchorBounds, top: number, bottom: number, desiredHeight: number, gap = 2) {
    const clearance = 16;
    const above = Math.max(0, box.top - top - gap - clearance), below = Math.max(0, bottom - box.bottom - gap - clearance);
    const upwards = desiredHeight > below && above > below;
    const height = Math.min(desiredHeight, upwards ? above : below);
    return { left: box.left, top: upwards ? box.top - gap - height : box.bottom + gap, width: box.width, height, upwards };
}

export function placePopup(menu: HTMLElement, config: PopupPosition) {
    const anchor = "anchor" in config ? config.anchor : null;
    const expanded = "expanded" in config && config.expanded;
    const panel = "viewport" in config && config.viewport ? null : anchor?.closest<HTMLElement>(".panel-content");
    const inset = panel ? parseFloat(getComputedStyle(panel).getPropertyValue("--panel-inset")) : 12;
    function reveal() {
        if (!expanded || !panel || !anchor) return;
        const space = innerHeight - anchor.getBoundingClientRect().bottom;
        if (space < 116) {
            panel.style.setProperty("--editor-clearance", "116px");
            panel.scrollTop += 116 - space;
        }
    }
    reveal();
    menu.showPopover();
    function position() {
        if ("point" in config) {
            const { x, y } = config.point, { width, height } = menu.getBoundingClientRect();
            menu.style.left = Math.max(4, Math.min(x, innerWidth - width - 4)) + "px";
            menu.style.top = Math.max(4, Math.min(y, innerHeight - height - 4)) + "px";
            return;
        }
        const box = config.anchor.getBoundingClientRect(), bounds = panel?.getBoundingClientRect();
        const top = Math.max(0, bounds?.top ?? 0), bottom = Math.min(innerHeight, bounds?.bottom ?? innerHeight);
        if (box.top >= bottom || box.bottom <= top) {
            config.close(); return;
        }
        if (expanded) {
            const width = Math.min(innerWidth - 8, Math.max(360, (panel?.clientWidth ?? box.width) - 2 * inset));
            const left = (bounds?.left ?? box.right - width) + inset;
            menu.style.width = width + "px";
            menu.style.left = Math.max(4, Math.min(left, innerWidth - width - 4)) + "px";
            const desired = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
            const r = popupBounds(box, 0, innerHeight, desired, 0);
            menu.style.top = r.top + "px";
            menu.style.maxHeight = r.height + "px";
            return;
        }
        menu.style.width = box.width + "px";
        const desired = Math.min(320, menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
        const r = popupBounds(box, top, bottom, desired);
        const width = menu.getBoundingClientRect().width;
        const left = r.left + width <= innerWidth - 4 ? r.left : Math.max(4, box.left + box.width - width);
        menu.style.left = left + "px"; menu.style.top = r.top + "px"; menu.style.maxHeight = r.height + "px";
    }
    function outside(event: PointerEvent) {
        const path = event.composedPath();
        if (anchor && path.includes(anchor) || path.includes(menu) ||
            expanded && path.some(n => n instanceof Element && n.matches(".reference-menu"))) return;
        config.close();
    }
    function resizeWindow() {
        reveal();
        position();
    }
    position();
    const resize = new ResizeObserver(position);
    if (anchor) resize.observe(anchor);
    resize.observe(menu);
    if (panel) resize.observe(panel);
    const content = new MutationObserver(position);
    content.observe(menu, { childList: true, subtree: true, characterData: true });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", resizeWindow);
    return { destroy() {
        resize.disconnect(); content.disconnect();
        if (expanded) panel?.style.removeProperty("--editor-clearance");
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", resizeWindow);
    } };
}
interface AnchorBounds { top: number; bottom: number; left: number; width: number }

export function popupBounds(box: AnchorBounds, top: number, bottom: number, desiredHeight: number) {
    const above = Math.max(0, box.top - top - 2), below = Math.max(0, bottom - box.bottom - 2);
    const upwards = desiredHeight > below && above > below;
    const height = Math.min(desiredHeight, upwards ? above : below);
    return { left: box.left, top: upwards ? box.top - 2 - height : box.bottom + 2, width: box.width, height, upwards };
}

export function anchoredPopup(menu: HTMLElement, config: { anchor: HTMLElement; close: () => void; viewport?: boolean }) {
    const { anchor, close } = config, panel = config.viewport ? null : anchor.closest(".panel-content");
    menu.showPopover();
    function position() {
        const box = anchor.getBoundingClientRect(), bounds = panel?.getBoundingClientRect();
        menu.style.width = box.width + "px";
        const top = Math.max(0, bounds?.top ?? 0), bottom = Math.min(innerHeight, bounds?.bottom ?? innerHeight);
        if (box.top >= bottom || box.bottom <= top) {
            close(); return;
        }
        const desired = Math.min(320, menu.scrollHeight + menu.offsetHeight - menu.clientHeight);
        const r = popupBounds(box, top, bottom, desired);
        menu.style.left = r.left + "px"; menu.style.top = r.top + "px"; menu.style.maxHeight = r.height + "px";
    }
    function outside(event: PointerEvent) {
        const path = event.composedPath();
        if (!path.includes(anchor) && !path.includes(menu)) close();
    }
    position();
    const resize = new ResizeObserver(position);
    resize.observe(anchor); resize.observe(menu);
    if (panel) resize.observe(panel);
    const content = new MutationObserver(position);
    content.observe(menu, { childList: true, subtree: true, characterData: true });
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return { destroy() {
        resize.disconnect(); content.disconnect();
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
    } };
}
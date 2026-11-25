<div bind:this={tip} class="tooltip" role="tooltip" popover="manual">{message}</div>

<style>
    .tooltip {
        position: fixed;
        z-index: var(--z-tip);
        inset: auto;
        margin: 0;
        max-width: min(240px, calc(100vw - var(--space-2)));
        padding: var(--space-1) var(--space-2);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--bg-panel);
        color: var(--text);
        box-shadow: var(--shadow-pop);
        font-size: var(--text-sm);
        line-height: var(--leading-sm);
        pointer-events: none;
    }
</style>

<script lang="ts">
    import { onMount, tick } from "svelte";
    let tip: HTMLDivElement, message = $state("");
    onMount(() => {
        let owner: HTMLElement | null = null, timer: ReturnType<typeof setTimeout>;
        const watch = new MutationObserver(() => {
            if (owner && (!owner.isConnected || owner.dataset.tip !== message)) hide();
        });
        function hide() {
            clearTimeout(timer); watch.disconnect(); owner = null; tip.hidePopover();
        }
        function target(el: EventTarget | null) {
            return el instanceof Element ? el.closest<HTMLElement>("[data-tip]") : null;
        }
        function proxy(e: PointerEvent) {
            if (e.buttons || !(e.target instanceof HTMLElement) || !e.target.dataset.tipProxy) return null;
            const hint = document.getElementById(e.target.dataset.tipProxy);
            if (!hint || hint.scrollWidth <= hint.clientWidth) return null;
            const { left, right, top, bottom } = hint.getBoundingClientRect();
            return e.clientX >= left && e.clientX <= right && e.clientY >= top && e.clientY <= bottom ? hint : null;
        }
        function hover(e: PointerEvent) {
            const next = target(e.target) ?? proxy(e);
            if (next === owner) return;
            hide();
            if (!next?.dataset.tip || e.pointerType === "touch") return;
            owner = next; message = next.dataset.tip;
            watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tip"] });
            timer = setTimeout(async () => {
                await tick();
                if (owner !== next || !next.isConnected) return;
                tip.showPopover();
                const b = next.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
                tip.style.left = Math.max(4, Math.min(innerWidth - w - 4, b.left + (b.width - w) / 2)) + "px";
                tip.style.top = (b.bottom + h + 6 <= innerHeight ? b.bottom + 4 : Math.max(2, b.top - h - 4)) + "px";
            }, 500);
        }
        function leave(e: PointerEvent) {
            if (owner && target(e.relatedTarget) !== owner) hide();
        }
        const controller = new AbortController(), options = { capture: true, signal: controller.signal };
        document.addEventListener("pointerover", hover, options); document.addEventListener("pointerout", leave, options);
        document.addEventListener("pointermove", e => {
            if (e.target instanceof HTMLElement && e.target.dataset.tipProxy) hover(e);
        }, options);
        document.addEventListener("pointerdown", hide, options); document.addEventListener("scroll", hide, options);
        window.addEventListener("blur", hide, options);
        return () => {
            controller.abort(); hide();
        };
    });
</script>
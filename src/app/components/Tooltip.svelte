<div bind:this={tip} class="tooltip" role="tooltip" popover="manual">{message}</div>

<style>
    .tooltip { position: fixed; inset: auto; margin: 0; max-width: calc(100vw - 8px); padding: 4px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--ink); box-shadow: 0 3px 12px #244b4226; font-size: 12px; pointer-events: none; }
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
        function hover(e: PointerEvent) {
            const next = target(e.target);
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
        document.addEventListener("pointerdown", hide, options); document.addEventListener("scroll", hide, options);
        window.addEventListener("blur", hide, options);
        return () => {
            controller.abort(); hide();
        };
    });
</script>
<svelte:window onpointermove={trackPointer} onpointerout={leaveWindow} onpointerdown={press} onblur={dismiss} />

{#snippet glyphs(item: HintItem)}
    <span class="hint-glyphs">
        {#each item.glyphs as glyph, i (i)}
            {#if glyph === "plus" || glyph === "or"}<span>{glyph === "plus" ? "+" : "或"}</span>
            {:else if "key" in glyph}<kbd>{glyph.key}</kbd>
            {:else}
                <span class="hint-mouse">
                    <span class="mouse-name">{mouseNames[glyph.mouse]}</span>
                    <Icon name={mouseIcons[glyph.mouse]} />
                </span>
            {/if}
        {/each}
    </span>
{/snippet}

{#snippet entry(item: HintItem)}
    <span class="hint-entry">
        {#if item.glyphs.length}{@render glyphs(item)}{/if}
        <span class="hint-text">{item.text}</span>
    </span>
{/snippet}

<div class="hint-area" bind:this={area}>
    <div id="mode-hint" class="map-chip" role="group" aria-label={hasMore ? "更多操作" : undefined}
        aria-describedby={hasMore ? id : undefined} hidden={!visible.length} bind:this={chip}>
        {#each visible as item (item.text)}{@render entry(item)}{/each}
    </div>
    <div class="hint-measure" aria-hidden="true" bind:this={measure}>
        {#each primary as item (item.text)}{@render entry(item)}{/each}
    </div>
    <div {id} class="popup hint-details" data-mode-hint-details popover="manual" bind:this={popup}>
        <ul aria-label="更多操作">
            {#each items as item (item.text)}
                <li>{@render glyphs(item)}<span class="hint-text">{item.text}</span></li>
            {/each}
        </ul>
    </div>
</div>

<style>
    .hint-area { grid-area: 3 / 1; min-width: 0; position: relative; pointer-events: none; }
    #mode-hint, .hint-measure {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        font-size: var(--text-xs);
        color: var(--text-secondary);
    }
    #mode-hint {
        width: max-content;
        max-width: 100%;
        height: 24px;
        padding-inline: var(--space-2);
    }
    #mode-hint[hidden] { display: none; }
    .hint-measure {
        position: absolute;
        inset-inline-start: 0;
        top: 0;
        width: max-content;
        visibility: hidden;
    }
    .hint-entry, .hint-glyphs { display: flex; flex: none; align-items: center; gap: var(--space-1); }
    .hint-entry, .hint-glyphs { white-space: nowrap; }
    .hint-mouse { display: inline-flex; }
    .mouse-name { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; }
    .hint-glyphs :global(svg.icon) { width: 14px; height: 14px; }
    kbd {
        display: inline-grid;
        place-items: center;
        height: 18px;
        min-width: 18px;
        padding-inline: 4px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--bg-sunken);
        font: inherit;
        color: var(--text);
    }
    .hint-details {
        width: max-content;
        padding: var(--space-2);
        border: 1px solid var(--border);
        overflow: auto;
        pointer-events: auto;
        font-size: var(--text-xs);
        color: var(--text-secondary);
    }
    ul {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: var(--space-1) var(--space-2);
        margin: 0;
        padding: 0;
        list-style: none;
    }
    li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { type HintItem } from "../state/mapText.ts";
    import Icon from "./Icon.svelte";

    const id = $props.id(), gap = 4;
    const mouseIcons = { left: "mouseLeft", right: "mouseRight", middle: "mouseMiddle", wheel: "mouseWheel" } as const;
    const mouseNames = { left: "左键", right: "右键", middle: "中键", wheel: "滚轮" };
    let { items, chip = $bindable() }: { items: readonly HintItem[]; chip?: HTMLDivElement } = $props();
    let area: HTMLDivElement, measure: HTMLDivElement, popup: HTMLDivElement;
    let primary = $derived(items.filter(item => item.primary));
    let count = $state(0), hovered = $state(false);
    let visible = $derived(primary.slice(0, count)), hasMore = $derived(!!visible.length && visible.length < items.length);
    let open = $derived(hasMore && hovered);

    function fit() {
        if (!chip || !area || !measure) return;
        const style = getComputedStyle(chip), spacing = parseFloat(style.columnGap);
        const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
            parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        const widths = Array.from(measure.children, el => el.getBoundingClientRect().width);
        const available = area.getBoundingClientRect().width;
        let total = chrome, next = 0;
        for (const width of widths) {
            total += width + (next ? spacing : 0);
            if (total > available) break;
            next++;
        }
        count = next;
    }
    function positionPopup() {
        if (!chip) return;
        const anchor = chip.getBoundingClientRect(), surface = area.closest(".map-wrap")!.getBoundingClientRect();
        const left = Math.max(12, anchor.left), top = Math.max(0, surface.top);
        popup.style.left = left + "px";
        popup.style.bottom = Math.max(0, innerHeight - anchor.top + gap) + "px";
        popup.style.maxWidth = Math.max(0, Math.min(surface.right, innerWidth) - left - 12) + "px";
        popup.style.maxHeight = Math.max(0, anchor.top - top - gap - 16) + "px";
    }
    function over(box: DOMRect, event: PointerEvent, extension = 0) {
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom + extension;
    }
    function trackPointer(event: PointerEvent) {
        hovered = !!chip && hasMore && event.pointerType !== "touch" && !event.buttons &&
            (over(chip.getBoundingClientRect(), event) || open && over(popup.getBoundingClientRect(), event, gap));
    }
    function leaveWindow(event: PointerEvent) {
        if (!event.relatedTarget) hovered = false;
    }
    function press(event: PointerEvent) {
        if (!(event.target instanceof Element) || !popup.contains(event.target)) dismiss();
    }
    function dismiss() {
        hovered = false;
    }
    $effect(() => {
        if (primary.length) fit();
        else count = 0;
    });
    $effect(() => {
        if (open) {
            positionPopup();
            popup.showPopover();
        }
        else popup.hidePopover();
    });
    onMount(() => {
        const observer = new ResizeObserver(() => {
            fit();
            if (open) positionPopup();
        });
        observer.observe(area);
        observer.observe(measure);
        const reposition = () => {
            if (open) positionPopup();
        };
        window.addEventListener("scroll", reposition, true);
        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", reposition, true);
        };
    });
</script>
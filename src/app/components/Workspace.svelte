<main class="workspace" bind:this={main} style:--right={layout.right + "px"} style:--bottom={layout.bottomClosed ? "0px" : layout.bottom * 100 + "%"}>
    <div class="map-column" class:closed={layout.bottomClosed}>
        <MapCanvas {editor} {theme} />
        <button class="split horizontal" data-split="bottom" aria-label="调整左下面板" data-tip="调整左下面板"
            onpointerdown={e => begin(e, "bottom")} ondblclick={() => toggle("bottomClosed")} onkeydown={e => keyboard(e, "bottom")} ></button>
        <div class="bottom-pane" hidden={layout.bottomClosed}>
            <nav class="bottom-tabs" aria-label="剖面类型">
                <Heading kind="bottom-heading">
                    <span class="bottom-tab" data-bottom-tab="sections" aria-current="true">剖面</span>
                    {#snippet actions()}<small>海拔 / m</small>{/snippet}
                </Heading>
            </nav>
            <div class="plot-pane"><Sections {editor} {theme} /></div>
        </div>
    </div>
    <button class="split vertical" data-split="right" aria-label="调整右栏宽度" data-tip="调整右栏宽度"
        onpointerdown={e => begin(e, "right")} onkeydown={e => keyboard(e, "right")}></button>
    <Sidebar {editor} {layout} onresize={e => begin(e, "upper")} ontoggle={() => toggle("propertiesClosed")} onkey={e => keyboard(e, "upper")} />
</main>
{#if editor.menu}<ContextMenu {editor} />{/if}

<style>
    :global {
        .workspace {
            height: calc(100dvh - var(--topbar-h));
            display: grid;
            grid-template-columns: minmax(360px, 1fr) var(--split-target) clamp(270px, var(--right), calc(100% - 410px));
            min-height: 540px;
        }
        .map-column { display: grid; grid-template-rows: minmax(220px, 1fr) var(--split-target) clamp(110px, var(--bottom), calc(100% - 225px)); min-width: 0; min-height: 0; }
        .map-column.closed { grid-template-rows: minmax(0, 1fr) var(--split-target) 0; }
        .split {
            position: relative;
            z-index: var(--z-split);
            min-height: 0;
            min-width: 0;
            padding: 0;
            background: var(--bg-app);
            border: 0;
            border-radius: 0;
            touch-action: none;
            user-select: none;
        }
        .split::before { content: ""; position: absolute; background: var(--border-region); }
        .split:is(:hover, :focus-visible)::before { background: var(--border-strong); }
        .split.horizontal { cursor: row-resize; width: 100%; }
        .split.horizontal::before { inset: 50% 0 auto; height: 1px; }
        .split.vertical { cursor: col-resize; }
        .split.vertical::before { inset: 0 auto 0 50%; width: 1px; }
        .bottom-pane { display: grid; grid-template-rows: var(--row-h) minmax(0, 1fr); background: var(--bg-panel); min-height: 0; }
        .bottom-pane[hidden] { display: none; }
        .plot-pane { min-width: 0; min-height: 0; }
        .bottom-tabs { display: flex; align-items: stretch; padding: 0 var(--space-3); gap: var(--space-2); background: var(--bg-sunken); }
        .bottom-heading { flex: 1; align-items: stretch; }
        .bottom-tab {
            display: flex;
            align-items: center;
            padding-inline: var(--space-2);
            color: var(--text);
            background: var(--bg-selected);
            box-shadow: inset 0 -2px var(--accent);
        }
        .bottom-tabs small { margin: auto 0 auto auto; color: var(--text-secondary); }
        @media (max-width: 680px) {
            .workspace { display: flex; flex-direction: column; height: auto; }
            .map-column { height: max(340px, 64dvh); }
            .workspace > .split.vertical { display: none; }
            .inspector { height: max(400px, 70dvh); }
        }
    }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { readLayout, saveLayout } from "../state/layout.ts";
    import { clamp } from "../../core/math/geometry.ts";
    import { type Theme } from "../../render/palette.ts";
    import * as session from "../state/session.svelte.ts";
    import MapCanvas from "./MapCanvas.svelte";
    import Sections from "./Sections.svelte";
    import Sidebar from "./Sidebar.svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import Heading from "./Heading.svelte";

    let { editor, theme }: { editor: session.Editor; theme: Theme } = $props();
    let main: HTMLElement;
    let layout = $state(readLayout());
    type Split = "bottom" | "upper" | "right";
    function toggle(key: "bottomClosed" | "propertiesClosed") {
        layout[key] = !layout[key]; saveLayout(layout);
    }
    function adjust(split: Split, delta: number, initial: number) {
        const h = main.clientHeight;
        if (split === "right") layout.right = clamp(initial - delta, 270, main.clientWidth - 410);
        if (split === "bottom") {
            layout.bottomClosed = false; layout.bottom = clamp(initial - delta / h, 110 / h, 1 - 225 / h);
        }
        if (split === "upper") {
            layout.propertiesClosed = false; layout.upper = clamp(initial + delta / h, 125 / h, 1 - 145 / h);
        }
    }
    function begin(ev: PointerEvent, split: Split) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const button = ev.currentTarget as HTMLButtonElement, start = split === "right" ? ev.clientX : ev.clientY;
        const initial = split === "bottom" && layout.bottomClosed ? 0 : split === "upper" && layout.propertiesClosed ? 1 : layout[split];
        button.setPointerCapture(ev.pointerId);
        function move(e: PointerEvent) {
            const delta = (split === "right" ? e.clientX : e.clientY) - start;
            if (Math.abs(delta) >= 2) adjust(split, delta, initial);
        }
        function finish() {
            button.removeEventListener("pointermove", move); saveLayout(layout);
        }
        button.addEventListener("pointermove", move);
        button.addEventListener("lostpointercapture", finish, { once: true });
    }
    function keyboard(e: KeyboardEvent, split: Split) {
        const keys = split === "right" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        if (keys.includes(e.key)) {
            e.preventDefault(); adjust(split, e.key === keys[0] ? -12 : 12, layout[split]); saveLayout(layout);
        }
        if (e.key === "Enter" && split !== "right") toggle(split === "upper" ? "propertiesClosed" : "bottomClosed");
    }
    onMount(() => {
        editor.revealProperties = () => {
            if (layout.propertiesClosed) toggle("propertiesClosed");
        };
        editor.revealSections = () => {
            if (layout.bottomClosed) toggle("bottomClosed");
        };
    });
</script>
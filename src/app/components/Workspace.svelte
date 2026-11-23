<main class="workspace" bind:this={main} style:--right={layout.right + "px"} style:--bottom={layout.bottomClosed ? "0px" : layout.bottom * 100 + "%"}>
    <div class="map-column" class:closed={layout.bottomClosed}>
        <MapCanvas {editor} />
        <button class="split horizontal" data-split="bottom" aria-label="调整左下面板" data-tip="调整左下面板"
            onpointerdown={e => begin(e, "bottom")} ondblclick={() => toggle("bottomClosed")} onkeydown={e => keyboard(e, "bottom")} ></button>
        <div class="bottom-pane" hidden={layout.bottomClosed}>
            <nav class="bottom-tabs" aria-label="剖面类型">
                {#each bottomTabs as [id, name] (id)}
                    <button data-bottom-tab={id} aria-pressed={editor.bottomTab === id} onclick={() => {
                        editor.bottomTab = id;
                    }}>{name}</button>
                {/each}
                {#if editor.bottomTab === "sections"}<small>海拔 / m</small>{/if}
            </nav>
            <div class="plot-pane" hidden={editor.bottomTab !== "sections"}><Sections {editor} /></div>
            {#if editor.bottomTab === "profile"}<Longitudinal {editor} />{/if}
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
            grid-template-columns: minmax(360px, 1fr) 5px clamp(270px, var(--right), calc(100% - 410px));
            min-height: 540px;
        }
        .map-column { display: grid; grid-template-rows: minmax(220px, 1fr) 5px clamp(110px, var(--bottom), calc(100% - 225px)); min-width: 0; min-height: 0; }
        .map-column.closed { grid-template-rows: minmax(0, 1fr) 5px 0; }
        .split { min-height: 0; min-width: 0; padding: 0; background: var(--line); border: 0; border-radius: 0; touch-action: none; user-select: none; }
        .split:hover, .split:focus-visible { background: #90aca0; }
        .split.horizontal { cursor: row-resize; width: 100%; }
        .split.vertical { cursor: col-resize; }
        .bottom-pane { display: grid; grid-template-rows: 31px minmax(0, 1fr); background: var(--paper); min-height: 0; }
        .bottom-pane[hidden], .plot-pane[hidden] { display: none; }
        .plot-pane { min-width: 0; min-height: 0; }
        .bottom-tabs { display: flex; align-items: stretch; border-bottom: 1px solid var(--line); padding: 0 13px; gap: 8px; }
        .bottom-tabs button { border: 0; border-radius: 0; border-bottom: 2px solid transparent; background: transparent; min-height: 0; font-size: 12px; }
        .bottom-tabs button[aria-pressed="true"] { border-color: var(--teal); color: var(--teal); font-weight: 650; }
        .bottom-tabs small { margin: auto 0 auto auto; color: var(--muted); }
        .workspace .sections { border: 0; }
    }
</style>

<script lang="ts">
    import { tick } from "svelte";
    import { readLayout, saveLayout } from "../state/layout.ts";
    import { clamp } from "../../core/math/geometry.ts";
    import * as session from "../state/session.svelte.ts";
    import MapCanvas from "./MapCanvas.svelte";
    import Sections from "./Sections.svelte";
    import Longitudinal from "./Longitudinal.svelte";
    import Sidebar from "./Sidebar.svelte";
    import ContextMenu from "./ContextMenu.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let main: HTMLElement;
    let layout = $state(readLayout());
    const bottomTabs = [["sections", "剖面"], ["profile", "纵断面"]] as const;
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
    $effect(() => {
        if (!layout.bottomClosed && editor.bottomTab === "sections") void tick().then(() => editor.sections());
    });
</script>
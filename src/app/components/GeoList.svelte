<Search id="terrain-search" label="查找地件" bind:value={editor.terrainFilter} />
<div class="geo-stack">
    {#each rows as row (row.key)}
        {#if !row.node}
            <div class="viewport-row list-row" class:insert-before={mark === row.key + "-before"} class:insert-after={mark === row.key + "-after"} role="group" data-stack-row={row.key} aria-label="视口"
                draggable="true" ondragstart={e => start(e, null)} ondragend={clear}>
                <Icon name="eye" /><span>{anchor ? "视口：上方 " + hiddenCount + " 个未显示" : "视口"}</span>
                {#if anchor}<button class="icon-button" data-tip="回到顶部" aria-label="回到顶部" onclick={() => editor.showThrough(null)}><Icon name="up" /></button>{/if}
            </div>
        {:else}
            {@const n = row.node}
            {@const c = n.construction}
            <div class="geo-row" role="group" data-stack-row={row.key} aria-label={n.label} draggable="true" class:disabled={n.disabled} class:outside={anchor && stack.indexOf(n) < hiddenCount}
                class:referenced={editor.hoverRefs.includes(n.id)} class:selected={editor.geoSelection.includes(n.id)}
                class:insert-before={mark === row.key + "-before"} class:insert-after={mark === row.key + "-after"}
                ondragstart={e => start(e, n.id)} ondragend={clear}
                onmouseenter={() => editor.hover(c.type === "strip" ? [...c.of] : [])} onmouseleave={() => editor.hover([])}>
                <button class="object-row" data-geo-node={n.id} aria-pressed={editor.geoSelection.includes(n.id)}
                    onclick={e => editor.select({ kind: "geoNode", id: n.id }, true, e.shiftKey)}
                    oncontextmenu={e => {
                        e.preventDefault(); editor.select({ kind: "geoNode", id: n.id }); editor.menu = { x: e.clientX, y: e.clientY };
                    }}>
                    <Icon name="terrain" /><span class="geo-name">{n.label}</span>
                    {#if problems.includes(n.id)}<span class="issue-error" data-tip="结构错误"><Icon name="issues" /></span>{/if}
                    <small class="list-detail"><Icon name="function" />{n.function.type}{#if n.function.type === "flat"}<span class="flat-amount" use:flagOverflow>{flatAmount(n.function.amount ?? functionDefaults.flat.amount)}</span>{/if}</small>
                    {#if c.type === "strip"}<small class="along">沿 {c.of.map(id => "“" + (d.geoNodes.find(n => n.id === id)?.label ?? id) + "”").join("、")}</small>{/if}
                    {#if n.field && n.field !== "height"}<small class="field-detail"><Icon name="field" />{d.fields[n.field]?.label ?? n.field}</small>{/if}
                </button>
            </div>
        {/if}
    {/each}
</div>

<style>
    .geo-stack { margin-top: var(--space-1); }
    .viewport-row, .geo-row { position: relative; min-height: var(--row-h); }
    .viewport-row { cursor: grab; }
    .viewport-row button { margin-left: auto; }
    .geo-row .object-row { min-width: 0; padding-block: var(--space-1); background: transparent; }
    .geo-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .geo-row .list-detail { display: flex; justify-content: flex-end; gap: var(--space-1); overflow: hidden; }
    .field-detail { display: flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
    .flat-amount, .along { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .flat-amount:global([data-overflow]) { visibility: hidden; }
    .geo-row:hover, .geo-row.outside:hover { background-color: var(--bg-hover); }
    .geo-row.selected, .geo-row.outside.selected { background-color: var(--bg-selected); }
    .referenced { box-shadow: inset 0 0 0 1px var(--warning); }
    .disabled :is(.geo-name, small) { color: var(--text-disabled); text-decoration: line-through; }
    .outside { background: repeating-linear-gradient(45deg, var(--border) 0 1px, transparent 1px var(--stripe-step)) var(--bg-sunken); }
    .insert-before::after, .insert-after::after { content: ""; position: absolute; inset: auto 0; height: 2px; background: var(--accent); pointer-events: none; }
    .insert-before::after { top: 0; }
    .insert-after::after { bottom: 0; }
</style>

<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { displayExpression, displayNumber, flagOverflow } from "../state/numbers.ts";
    import { functionDefaults } from "../../core/design/defaults.ts";
    import { reorderGeo } from "../../core/edit/geoNodes.ts";
    import { type Expression, type GeoNode } from "../../core/design/v5.ts";
    import Icon from "./Icon.svelte";
    import Search from "./Search.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design), stack = $derived(d.geoNodes.toReversed());
    let anchor = $derived(stack.find(n => n.id === editor.viewport)), hiddenCount = $derived(anchor ? stack.indexOf(anchor) + 1 : 0);
    let problems = $derived(editor.island.issues.filter(i => i.kind === "geo-reference").map(i => i.geoNode));
    let order = $derived.by(() => {
        const result: { key: string; node?: GeoNode }[] = stack.map(n => ({ key: "n:" + n.id, node: n }));
        result.splice(hiddenCount, 0, { key: "viewport" });
        return result;
    });
    let rows = $derived(order.filter(r => !r.node || [r.node.label, r.node.function.type, r.node.id, d.fields[r.node.field ?? ""]?.label].some(x => x?.toLowerCase().includes(editor.terrainFilter.trim().toLowerCase()))));
    let mark = $state("");
    let dragged: string | null | undefined;
    let insertion: { index: number; viewport: string | null; at: number } | undefined;
    function flatAmount(value: Expression) {
        if (typeof value === "number") return (value < 0 ? "" : "+") + displayNumber(value, .1);
        return "+" + displayExpression(value, d);
    }
    const mime = "application/x-groundwork-stack";
    function start(e: DragEvent, id: string | null) {
        dragged = id; e.dataTransfer!.setData(mime, JSON.stringify(id)); e.dataTransfer!.effectAllowed = "move";
    }
    function clearMark() {
        mark = ""; insertion = undefined;
    }
    function clear() {
        clearMark(); dragged = undefined;
    }
    onMount(() => {
        const panel = editor.panel;
        function over(e: DragEvent) {
            if (dragged === undefined || !e.dataTransfer?.types.includes(mime)) return;
            const bounds = panel.getBoundingClientRect();
            if (e.clientX < bounds.left || e.clientX >= bounds.right || e.clientY < bounds.top || e.clientY >= bounds.bottom) {
                clearMark(); return;
            }
            e.preventDefault();
            const elements = [...panel.querySelectorAll<HTMLElement>("[data-stack-row]")];
            const before = elements.find(el => {
                const b = el.getBoundingClientRect(); return e.clientY < b.top + b.height / 2;
            });
            const key = (before ?? elements.at(-1))?.dataset.stackRow;
            if (!key) return;
            const line = key + (before ? "-before" : "-after");
            const at = e.clientY < elements[0].getBoundingClientRect().top ? 0 :
                e.clientY >= elements.at(-1)!.getBoundingClientRect().bottom ? order.length : order.findIndex(r => r.key === key) + (before ? 0 : 1);
            if (line !== mark || insertion?.at !== at) {
                const list = order.map(r => r.key);
                const item = dragged === null ? "viewport" : "n:" + dragged;
                const next = list.filter(k => k !== item);
                next.splice(at - Number(list.indexOf(item) < at), 0, item);
                const v = next.indexOf("viewport"), viewport = v ? next[v - 1].slice(2) : null;
                const index = next.filter(k => k !== "viewport").reverse().indexOf(item);
                try {
                    if (dragged !== null) reorderGeo({ ...d }, dragged, index);
                    insertion = { index, viewport, at }; mark = line;
                }
                catch {
                    clearMark();
                }
            }
            e.dataTransfer.dropEffect = insertion ? "move" : "none";
        }
        function drop(e: DragEvent) {
            const target = insertion, id = dragged;
            if (!target || id === undefined) return;
            e.preventDefault(); clear();
            if (id === null) editor.showThrough(target.viewport);
            else editor.edit(d => {
                reorderGeo(d, id, target.index);
            }, () => {
                editor.viewport = target.viewport;
            });
        }
        function leave(e: DragEvent) {
            if (!(e.relatedTarget instanceof Node) || !panel.contains(e.relatedTarget)) clearMark();
        }
        panel.addEventListener("dragover", over); panel.addEventListener("drop", drop); panel.addEventListener("dragleave", leave);
        return () => {
            panel.removeEventListener("dragover", over); panel.removeEventListener("drop", drop); panel.removeEventListener("dragleave", leave);
        };
    });
    onDestroy(() => {
        if (editor.map?.highlights?.length) editor.hover([]);
    });
</script>
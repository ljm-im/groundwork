<h2>地件</h2>
<Search id="terrain-search" label="查找地件" bind:value={editor.terrainFilter} />
<div class="geo-stack">
    {#each rows as row (row.key)}
        {#if !row.node}
            <div class="viewport-row" class:insert-before={mark === row.key + "-before"} class:insert-after={mark === row.key + "-after"} role="group" aria-label="视口"
                draggable="true" ondragstart={e => start(e, null)} ondragend={clear} ondragover={e => over(e, row.key)} ondrop={e => drop(e, row.key)}>
                <Icon name="eye" /><span>{anchor ? "视口：显示到「" + anchor.name + "」，上方 " + hiddenCount + " 个地件未显示" : "视口"}</span>
                {#if anchor}<button class="flat" onclick={() => editor.showThrough(null)}>回到顶部</button>{/if}
            </div>
        {:else}
            {@const n = row.node}
            {@const c = n.construction}
            <div class="geo-row" role="group" aria-label={n.name} draggable="true" class:disabled={n.disabled} class:outside={anchor && stack.indexOf(n) < hiddenCount}
                class:referenced={editor.hoverRefs.includes(n.id)} class:selected={editor.geoSelection.includes(n.id)} class:strip={c.type === "strip"}
                class:insert-before={mark === row.key + "-before"} class:insert-after={mark === row.key + "-after"}
                ondragstart={e => start(e, n.id)} ondragend={clear} ondragover={e => over(e, row.key)} ondrop={e => drop(e, row.key)}
                onmouseenter={() => editor.hover(c.type === "strip" ? [...c.of] : [])} onmouseleave={() => editor.hover([])}>
                <button class="object-row" data-geo-node={n.id} aria-pressed={editor.geoSelection.includes(n.id)}
                    onclick={e => editor.select({ kind: "geoNode", id: n.id }, true, e.shiftKey)}
                    oncontextmenu={e => {
                        e.preventDefault(); editor.select({ kind: "geoNode", id: n.id }); editor.menu = { x: e.clientX, y: e.clientY };
                    }}>
                    <span class="geo-name">{n.name}</span>
                    {#if problems.includes(n.id)}<span class="danger" title="结构错误"><Icon name="issues" /></span>{/if}
                    <small>{n.function.type}{#if n.function.type === "flat"} = {typeof n.function.value === "number" ? n.function.value : d.variables[n.function.value.var]?.label ?? n.function.value.var}{/if}</small>
                    {#if c.type === "strip"}<span class="along">沿 {c.of.map(id => d.geoNodes.find(n => n.id === id)?.name ?? id).join("·")}</span>{/if}
                    {#if n.field && n.field !== "height"}<span class="badge">{d.fields[n.field]?.label ?? n.field}</span>{/if}
                </button>
                <input type="checkbox" aria-label={"启用" + n.name} title={"启用" + n.name} checked={!n.disabled} onchange={() => editor.toggle(n.id)} />
            </div>
        {/if}
    {/each}
</div>

<style>
    .geo-stack { margin-top: 5px; }
    .viewport-row, .geo-row { position: relative; display: flex; align-items: center; gap: 5px; border-bottom: 1px solid var(--line); min-height: 30px; }
    .viewport-row { font-size: 12px; color: var(--teal); background: var(--paper); cursor: grab; padding: 4px; }
    .viewport-row button { margin-left: auto; white-space: nowrap; font-size: 11px; }
    .geo-row .object-row { min-height: 31px; flex: 1; min-width: 0; border: 0; gap: 4px; flex-wrap: wrap; padding: 5px 3px 5px 8px; font-size: 12px; }
    .geo-row .object-row small { font-size: 10px; margin-left: 3px; }
    .geo-row input { margin: 0 4px; accent-color: var(--teal); }
    .geo-row.strip::before { content: ""; position: absolute; inset: 5px auto 5px 1px; border-left: 2px dashed #7e927e; }
    .along { font-size: 10px; color: var(--muted); }
    .selected { background: var(--light); }
    .referenced { outline: 1px solid #bc752e; outline-offset: -1px; }
    .disabled { opacity: .5; }
    .disabled .geo-name { text-decoration: line-through; }
    .outside { background: repeating-linear-gradient(-45deg, #e8e0bf66 0 2px, transparent 2px 7px); color: #7c7356; }
    .geo-row.outside .object-row { background: transparent; }
    .insert-before::after, .insert-after::after { content: ""; position: absolute; left: 0; right: 0; height: 2px; background: var(--teal); pointer-events: none; z-index: 1; }
    .insert-before::after { top: 0; }
    .insert-after::after { bottom: 0; }
</style>

<script lang="ts">
    import { onDestroy } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { reorderGeo } from "../../core/edit/geoNodes.ts";
    import { type GeoNode } from "../../core/design/v5.ts";
    import Icon from "./Icon.svelte";
    import Search from "./Search.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design), stack = $derived(d.geoNodes.toReversed());
    let anchor = $derived(stack.find(n => n.id === editor.viewport)), hiddenCount = $derived(anchor ? stack.indexOf(anchor) : 0);
    let problems = $derived(editor.island.issues.filter(i => i.kind === "geo-reference").map(i => i.geoNode));
    let order = $derived.by(() => {
        const result: { key: string; node?: GeoNode }[] = stack.map(n => ({ key: "n:" + n.id, node: n }));
        result.splice(anchor ? hiddenCount + 1 : 0, 0, { key: "viewport" });
        return result;
    });
    let rows = $derived(order.filter(r => !r.node || [r.node.name, r.node.function.type, r.node.id, d.fields[r.node.field ?? ""]?.label].some(x => x?.toLowerCase().includes(editor.terrainFilter.trim().toLowerCase()))));
    let mark = $state("");
    function start(e: DragEvent, id: string | null) {
        e.dataTransfer!.setData("application/x-groundwork-stack", JSON.stringify(id)); e.dataTransfer!.effectAllowed = "move";
    }
    function clear() {
        mark = "";
    }
    function after(e: DragEvent) {
        const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); return e.clientY > b.y + b.height / 2;
    }
    function over(e: DragEvent, key: string) {
        if (!e.dataTransfer?.types.includes("application/x-groundwork-stack")) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move"; mark = key + (after(e) ? "-after" : "-before");
    }
    function drop(e: DragEvent, key: string) {
        e.preventDefault(); clear();
        const data = e.dataTransfer?.getData("application/x-groundwork-stack");
        if (!data) return;
        const id: string | null = JSON.parse(data);
        const above = order.slice(0, order.findIndex(r => r.key === key) + +after(e)).flatMap(r => r.node && r.node.id !== id ? [r.node.id] : []);
        if (id === null) editor.showThrough(above.at(-1) ?? null);
        else editor.edit(d => {
            reorderGeo(d, id, d.geoNodes.length - 1 - above.length);
        });
    }
    onDestroy(() => {
        if (editor.map?.highlights?.length) editor.hover([]);
    });
</script>
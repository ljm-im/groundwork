<div class="geo-stack">
    {#each rows as row (row.key)}
        {@const insertion = mark === row.key + "-before" ? "before" : mark === row.key + "-after" ? "after" : undefined}
        {#if !row.node}
            <ListRow icon="eye" name={anchor ? "视口：上方 " + hiddenCount + " 个未显示" : "视口"} {insertion}
                rowAttributes={{ "data-stack-row": row.key }} ondragstart={e => start(e, null)} ondragend={clear}>
                {#snippet actions()}
                    {#if anchor}<button class="icon-button" data-tip="回到顶部" aria-label="回到顶部" onclick={() => editor.showThrough(null)}><Icon name="up" /></button>{/if}
                {/snippet}
            </ListRow>
        {:else}
            {@const n = row.node}
            {@const c = n.construction}
            <ListRow icon="terrain" name={n.label} problem={problems.get(n.id)?.join("\n")} {insertion}
                rowAttributes={{ "data-stack-row": row.key }} attributes={{ "data-geo-node": n.id }}
                muted={!!n.disabled} outside={!!anchor && stack.indexOf(n) < hiddenCount} referenced={editor.hoverRefs.includes(n.id)}
                selected={editor.selection?.kind === "geoNode" && editor.selection.id === n.id}
                select={() => editor.focus("geoNode", n.id)} onmenu={event => editor.openMenu({ kind: "geoNode", id: n.id }, event)}
                ondragstart={e => start(e, n.id)} ondragend={clear}
                onmouseenter={() => {
                    if (dragged !== undefined || editor.tool !== "select" || editor.gesture) return;
                    editor.hoverSelection({ kind: "geoNode", id: n.id });
                    editor.hover(c.type === "strip" ? [...c.of] : []);
                }} onmouseleave={() => {
                    editor.hoverSelection();
                    editor.hover([]);
                }}>
                {#snippet detail()}
                    <small class="list-detail"><Icon name="function" builtin={isBuiltinFunction(n.function.type)} />{n.function.type}{#if n.function.type === "flat"}<span class="flat-amount" use:flagOverflow>{flatAmount(n, n.function.amount)}</span>{/if}</small>
                    {#if c.type === "strip"}<small class="along">沿 {c.of.map(id => "“" + (d.geoNodes.find(n => n.id === id)?.label ?? id) + "”").join("、")}</small>{/if}
                    {#if n.field !== heightId}<small class="field-detail"><Icon name="field" />{d.fields[n.field]?.label ?? n.field}</small>{/if}
                {/snippet}
            </ListRow>
        {/if}
    {:else}<EmptyState search={!!editor.terrainFilter.trim()} text="没有地件" />{/each}
</div>

<style>
    .geo-stack { margin-top: var(--space-1); }
    .list-detail { display: flex; justify-content: flex-end; gap: var(--space-1); overflow: hidden; }
    .field-detail { display: flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
    .flat-amount, .along { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .flat-amount:global([data-overflow]) { visibility: hidden; }
</style>

<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { SvelteMap } from "svelte/reactivity";
    import * as session from "../state/session.svelte.ts";
    import { heightId } from "../../core/design/defaults.ts";
    import { isBuiltinFunction, parameterDefault, parameterStep } from "../../core/design/functionTable.ts";
    import { geoParameter } from "../../core/design/parameters.ts";
    import { flagOverflow, referenceLabel } from "../state/numbers.ts";
    import { displayValue } from "../../core/design/display.ts";
    import { reorderGeo } from "../../core/edit/geoNodes.ts";
    import { type Expression, type GeoNode } from "../../core/design/v5.ts";
    import { matchesSearch } from "../state/inspector.ts";
    import { designProblemText } from "../state/designMessages.ts";
    import Icon from "./Icon.svelte";
    import ListRow from "./ListRow.svelte";
    import EmptyState from "./EmptyState.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.project.design), stack = $derived(d.geoNodes.toReversed());
    let slots = $derived(editor.numberEdits.slots);
    let anchor = $derived(stack.find(n => n.id === editor.viewport)), hiddenCount = $derived(anchor ? stack.indexOf(anchor) + 1 : 0);
    let problems = $derived.by(() => {
        const byNode = new SvelteMap<string, string[]>();
        for (const issue of editor.project.issues) {
            const id = issue.geoNode;
            if (issue.severity !== "error" || !id) continue;
            const message = designProblemText(issue, d, "property"), messages = byNode.get(id);
            if (messages) messages.push(message);
            else byNode.set(id, [message]);
        }
        return byNode;
    });
    let order = $derived.by(() => {
        const result: { key: string; node?: GeoNode }[] = stack.map(n => ({ key: "n:" + n.id, node: n }));
        result.splice(hiddenCount, 0, { key: "viewport" });
        return result;
    });
    let rows = $derived.by(() => {
        const matches = order.filter(r => r.node && matchesSearch(editor.terrainFilter, r.node.label, r.node.function.type, r.node.id, d.fields[r.node.field]?.label));
        return matches.length ? order.filter(row => !row.node || matches.includes(row)) : [];
    });
    let mark = $state("");
    let dragged: string | null | undefined;
    let insertion: { index: number; viewport: string | null; at: number } | undefined;
    function flatAmount(n: GeoNode, authored: Expression | undefined) {
        const p = geoParameter(n, ["function", "amount"]);
        if (!p || p.type === "geometry") return "";
        const value = authored ?? parameterDefault(p, n.id);
        return (typeof value === "number" && value < 0 ? "" : "+") + displayValue(value, parameterStep(p, d.fields[n.field]), "", key => {
            const item = referenceLabel(key, d, slots);
            return item.name + (item.property ? "." + item.property : "");
        });
    }
    const mime = "application/x-groundwork-stack";
    function start(e: DragEvent, id: string | null) {
        editor.hoverSelection();
        editor.hover([]);
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
        if (editor.hoverRefs.length) editor.hover([]);
    });
</script>
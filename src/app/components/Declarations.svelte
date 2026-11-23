{#if !properties}
    <Part title="变量" count={Object.keys(d.variables).length}>
        {#each Object.entries(d.variables) as [id, v] (id)}
            <div class="declaration">
                <button class="object-row" data-select-variable={id} aria-pressed={h?.kind === "variable" && h.id === id} onclick={() => editor.select({ kind: "variable", id })}>
                    {v.label ?? id}<small>{v.value}</small>
                </button>
                {#if v.range}<input class="variable-slider" type="range" data-variable={id} aria-label={v.label ?? id} min={v.range[0]} max={v.range[1]} step={v.range[2]} value={v.value}
                    oninput={e => {
                        v.value = e.currentTarget.valueAsNumber; e.currentTarget.previousElementSibling!.querySelector("small")!.textContent = String(v.value); editor.pendingLevels.add(id); editor.schedule();
                    }} />{/if}
            </div>
        {/each}
        <button data-add="variable" onclick={() => editor.addDeclaration("variable")}>新建变量</button>
    </Part>
    <Part title="场" count={Object.keys(d.fields).length + 1}>
        <button class="object-row" aria-pressed={h?.kind === "field" && h.id === "height"} onclick={() => editor.select({ kind: "field", id: "height" })}>高度</button>
        {#each Object.entries(d.fields) as [id, f] (id)}
            <button class="object-row" aria-pressed={h?.kind === "field" && h.id === id} onclick={() => editor.select({ kind: "field", id })}>{f.label ?? id}<small>{f.default}</small></button>
        {/each}
        <button data-add="field" onclick={() => editor.addDeclaration("field")}>新建场</button>
    </Part>
{:else if h && h.kind === "field" && h.id === "height"}<h2>高度</h2><div class="sub">内置场 · 单位 m</div>
{:else if h && item}
    <h2>{item.label ?? h.id}</h2>
    <label class="field">名称<input value={item.label ?? h.id} onchange={e => {
        const label = e.currentTarget.value.trim() || h!.id; editor.edit(d => {
            table(d)[h!.id].label = label;
        });
    }} /></label>
    {#if h.kind === "variable"}
        <label class="field">当前值<input type="number" step="any" value={d.variables[h.id].value} onchange={e => {
            const v = e.currentTarget.valueAsNumber; editor.edit(d => {
                d.variables[h!.id].value = v;
            });
        }} /></label>
        <Part title="滑块范围">
            {#each ["最小值", "最大值", "步长"] as label, i (label)}
                <label class="field">{label}<input data-range={i} type="number" step="any" value={d.variables[h.id].range?.[i] ?? ""} onchange={changeRange} /></label>
            {/each}
            <button onclick={() => editor.edit(d => {
                delete d.variables[h!.id].range;
            })}>清空范围</button>
        </Part>
    {:else}<label class="field">默认值<input type="number" step="any" value={d.fields[h.id].default} onchange={e => {
        const v = e.currentTarget.valueAsNumber; editor.edit(d => {
            d.fields[h!.id].default = v;
        });
    }} /></label>{/if}
    <div class="part"><button class="danger" onclick={() => editor.removeSelected()}>删除{h.kind === "field" ? "场" : "变量"}</button></div>
{/if}

<style>
    .declaration { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 7px; }
    .variable-slider { width: 79px; accent-color: var(--teal); }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Design } from "../../core/design/v5.ts";
    import Part from "./Part.svelte";
    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let d = $derived(editor.island.design), h = $derived(editor.selection);
    function table(d: Design) {
        return h?.kind === "variable" ? d.variables : d.fields;
    }
    let item = $derived(h && table(d)[h.id]);
    function changeRange(e: Event) {
        const root = (e.currentTarget as HTMLInputElement).closest(".part")!;
        const controls = [...root.querySelectorAll<HTMLInputElement>("[data-range]")];
        if (controls.every(c => !c.value)) editor.edit(d => {
            delete d.variables[h!.id].range;
        });
        else if (controls.every(c => c.value !== "")) {
            const [min, max, step] = controls.map(c => c.valueAsNumber);
            editor.edit(d => {
                d.variables[h!.id].range = [min, max, step];
            });
        }
    }
</script>
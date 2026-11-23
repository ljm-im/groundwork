<h2>显示</h2>
<Part title="场">
    <label class="toggle">显示等值线<input type="checkbox" data-layer="contours" checked={editor.layers.contours} /></label>
    <PropertySelect label="显示的场" group="场" icon="field" value={editor.displayField} options={fields} choose={field => editor.showField(field)} />
</Part>
{#each groups as [title, keys] (title)}
    <Part {title}>{#each keys as key (key)}<label class="toggle">{layerNames[key]}<input type="checkbox" data-layer={key} checked={editor.layers[key]} /></label>{/each}</Part>
{/each}
<Part title="网格">
    <label class="toggle">显示网格<input type="checkbox" data-layer="grid" checked={editor.layers.grid} /></label>
    <label class="toggle">显示细分网格<input type="checkbox" data-layer="fineGrid" checked={editor.layers.fineGrid} /></label>
    <label class="field">间距方式<select data-grid-setting="mode" value={editor.displayGrid.mode}>
        <option value="meters">固定米数</option><option value="pixels">固定像素</option>
    </select></label>
    {#if editor.displayGrid.mode === "meters"}
        <label class="field">间距（m）<input type="number" data-grid-setting="meters" min="0" step="any" value={editor.displayGrid.meters} /></label>
    {:else}
        <label class="field">目标间距（px）<input type="number" data-grid-setting="pixels" min="0" step="any" value={editor.displayGrid.pixels} /></label>
    {/if}
</Part>

<script lang="ts">
    import { layerNames } from "../state/layers.ts";
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import PropertySelect from "./PropertySelect.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let fields = $derived([{ id: "height", name: "高度" },
        ...Object.entries(editor.island.design.fields).map(([id, f]) => ({ id, name: f.label ?? id }))]);
    const groups = [
        ["编辑控制点", ["network", "geoNodes", "buildings", "sections"]],
        ["平面图", ["labels", "marks", "issues"]]
    ] as const;
</script>
<div class="panel-inset">
    <Part title="场">
        <PropertySelect label="显示的场" group="场" icon="field" value={editor.displayField} options={fields} choose={field => editor.showField(field)} />
        <label class="toggle"><input type="checkbox" data-layer="contours" checked={editor.layers.contours} />显示等值线</label>
        <label class="toggle"><input type="checkbox" data-layer="contourLabels" checked={editor.layers.contourLabels} disabled={!editor.layers.contours} />标注数值</label>
    </Part>
    <Part title="平面图">
        {#each mapLayers as key (key)}<label class="toggle"><input type="checkbox" data-layer={key} checked={editor.layers[key]} />{layerNames[key]}</label>{/each}
    </Part>
    <Part title="网格">
        <label class="toggle"><input type="checkbox" data-layer="grid" checked={editor.layers.grid} />显示网格</label>
        <label class="toggle"><input type="checkbox" data-layer="fineGrid" checked={editor.layers.fineGrid} />显示细分网格</label>
        <PropertySelect label="间距方式" value={editor.displayGrid.mode} options={gridModes} choose={mode => editor.setGrid("mode", mode)} attributes={{ "data-grid-setting": "mode" }} />
        {#if editor.displayGrid.mode === "meters"}
            <FieldRow label="间距" unit="m"><input aria-label="网格间距" type="number" data-grid-setting="meters" min="0" step={displaySteps.gridUnits} value={editor.displayGrid.meters} /></FieldRow>
        {:else}
            <FieldRow label="目标间距" unit="px"><input aria-label="网格目标间距" type="number" data-grid-setting="pixels" min="0" step={displaySteps.gridPixels} value={editor.displayGrid.pixels} /></FieldRow>
        {/if}
    </Part>
</div>

<style>
    .toggle:has(input:disabled) { color: var(--text-disabled); }
    input[type="number"] { appearance: textfield; }
    input::-webkit-inner-spin-button, input::-webkit-outer-spin-button { appearance: none; }
</style>

<script lang="ts">
    import { fieldEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { displaySteps } from "../../core/design/functionTable.ts";
    import { layerNames } from "../state/layers.ts";
    import * as session from "../state/session.svelte.ts";
    import FieldRow from "./FieldRow.svelte";
    import Part from "./Part.svelte";
    import PropertySelect from "./PropertySelect.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let fields = $derived(fieldEntries(editor.project.design.fields).map(([id, f]) => ({ id, name: f.label, builtin: isBuiltin("field", id) })));
    const gridModes = [{ id: "meters", name: "固定米数" }, { id: "pixels", name: "固定像素" }];
    const mapLayers = ["geoNodes", "labels", "sections", "marks", "issues"] as const;
</script>
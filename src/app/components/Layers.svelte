<div class="panel-inset">
    <Part title="场">
        <PropertySelect label="显示的场" group="场" icon="field" value={editor.displayField} options={fields} choose={field => editor.showField(field)} />
        {@render toggle("contours", "显示等值线")}
        {@render toggle("contourLabels", "标注数值", !editor.layers.contours)}
    </Part>
    <Part title="平面图">
        {#each mapLayers as key (key)}{@render toggle(key, layerNames[key])}{/each}
    </Part>
    <Part title="网格">
        {@render toggle("grid", "显示网格")}
        {@render toggle("fineGrid", "显示细分网格")}
        <PropertySelect label="间距方式" value={editor.displayGrid.mode} options={gridModes} choose={mode => editor.setGrid("mode", mode)} attributes={{ "data-grid-setting": "mode" }} />
        {#each [editor.displayGrid.mode] as mode (mode)}
            <NumberInput {editor} kind="literal" label={mode === "meters" ? "间距" : "目标间距"} unit={mode === "meters" ? "m" : "px"}
                step={mode === "meters" ? displaySteps.gridUnits : displaySteps.gridPixels} attributes={{ "data-grid-setting": mode }}
                setting={{ value: editor.displayGrid[mode], change: value => editor.setGrid(mode, value), validate: spacing }} />
        {/each}
    </Part>
</div>

{#snippet toggle(key: Layer, label: string, disabled = false)}
    <CheckboxRow {label} checked={editor.layers[key]} {disabled} attributes={{ "data-layer": key }} change={value => editor.layer(key, value)} />
{/snippet}

<script lang="ts">
    import { declarationEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { displaySteps } from "../../core/design/functionTable.ts";
    import { layerNames } from "../state/layers.ts";
    import { type Layer } from "../types.ts";
    import * as session from "../state/session.svelte.ts";
    import CheckboxRow from "./CheckboxRow.svelte";
    import NumberInput from "./NumberInput.svelte";
    import Part from "./Part.svelte";
    import PropertySelect from "./PropertySelect.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let fields = $derived(declarationEntries("field", editor.project.design.fields).map(([id, f]) => ({ id, name: f.label, builtin: isBuiltin("field", id) })));
    const gridModes = [{ id: "meters", name: "固定米数" }, { id: "pixels", name: "固定像素" }];
    const mapLayers = ["geoNodes", "labels", "sections", "marks", "issues", "geometry"] as const;
    function spacing(value: number) {
        if (!Number.isFinite(value) || value <= 0) throw Error("间距必须大于 0");
    }
</script>
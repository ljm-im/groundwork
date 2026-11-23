<h2>显示</h2>
<Part title="地图显示的场">
    {#each [["height", "高度"], ...Object.entries(editor.island.design.fields).map(([id, f]) => [id, f.label ?? id])] as [id, label] (id)}
        <label class="toggle">{label}<input type="radio" name="display-field" value={id} checked={editor.displayField === id} onchange={() => editor.showField(id)} /></label>
    {/each}
</Part>
{#each groups as [title, keys] (title)}
    <Part {title}>{#each keys as key (key)}<label class="toggle">{layerNames[key]}<input type="checkbox" data-layer={key} checked={editor.layers[key]} /></label>{/each}</Part>
{/each}

<script lang="ts">
    import { layerNames } from "../state/layers.ts";
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    let { editor }: { editor: session.Editor } = $props();
    const groups = [
        ["编辑控制点", ["network", "geoNodes", "buildings", "sections"]],
        ["平面图", ["contours", "trees", "labels", "issues"]]
    ] as const;
</script>
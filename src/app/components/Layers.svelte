<h2>图层</h2>
{#each groups as [title, keys] (title)}
    <Part {title}>{#each keys as key (key)}<label class="toggle">{layerNames[key]}<input type="checkbox" data-layer={key} checked={editor.layers[key]} /></label>{/each}</Part>
{/each}

<script lang="ts">
    import { layerNames } from "../state/layers.ts";
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    let { editor }: { editor: session.Editor } = $props();
    const groups = [
        ["编辑控制点", ["network", "coast", "ridges", "zones", "buildings", "plantingAreas", "sections"]],
        ["平面图", ["contours", "trees", "labels", "issues"]]
    ] as const;
</script>
{#snippet segments(label: string, options: readonly (readonly [string, string, IconName])[], selected: string, choose: (id: string) => void)}
    <FieldRow {label}>
        <div class="segmented" role="group" aria-label={label}>
            {#each options as [id, name, icon] (id)}
                <button class="icon-button" aria-pressed={selected === id} aria-label={name} data-tip={name} onclick={() => choose(id)}><Icon name={icon} /></button>
            {/each}
        </div>
    </FieldRow>
{/snippet}
<Part title="节点">
    {@render segments("节点类型", nodeModes, node.mode, mode => editor.pathNodeMode(control, mode as PathNode["mode"]))}
    {@render segments("后一段", segmentTypes, node.next ?? "curve", type => editor.segment(control, type as NonNullable<PathNode["next"]>))}
    {#if node.next === "arc"}
        <FieldRow><button onclick={() => editor.segment(control, "tangent")}><Icon name="tangent" />相切</button></FieldRow>
    {/if}
</Part>

<style>
    .segmented { display: flex; align-items: center; }
    .segmented button { flex: none; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type PathNode } from "../../core/design/v5.ts";
    import { type GeoControl } from "../../core/edit/geoControls.ts";
    import { nodeModes, segmentTypes } from "../state/inspector.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import Part from "./Part.svelte";
    import FieldRow from "./FieldRow.svelte";

    let { editor, node, control }: { editor: session.Editor; node: PathNode; control: GeoControl } = $props();
</script>
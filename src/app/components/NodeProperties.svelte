{#snippet segments(label: string, options: readonly (readonly [string, string, IconName])[], selected: string, choose: (id: string) => void, unavailable?: string)}
    <FieldRow {label}>
        <div class="segmented" role="group" aria-label={label}>
            {#each options as [id, name, icon] (id)}
                <button class="icon-button" aria-pressed={selected === id} aria-label={name} data-tip={name} disabled={id === unavailable}
                    onclick={() => choose(id)}><Icon name={icon} /></button>
            {/each}
        </div>
    </FieldRow>
{/snippet}
{@render segments("节点类型", nodeModes, node.mode, mode => editor.pathNodeMode(control, mode as CurveNode["mode"]),
    canSetManual(curve, control.index) ? undefined : "manual")}
{#if segment}
    {@render segments("后一段", segmentTypes, segment, type => editor.segment(control, type as SegmentType))}
    {#if segment === "arc"}
        <FieldRow><button disabled={neighbor(curve, control.index, -1) === undefined} onclick={() => editor.segment(control, "tangent")}><Icon name="tangent" />相切</button></FieldRow>
    {/if}
{/if}

<style>
    .segmented { display: flex; align-items: center; }
    .segmented button { flex: none; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Curve, type CurveNode } from "../../core/design/v5.ts";
    import { neighbor, segmentType, type SegmentType } from "../../core/design/path.ts";
    import { canSetManual } from "../../core/edit/paths.ts";
    import { type GeoControl } from "../../core/edit/geoControls.ts";
    import { nodeModes, segmentTypes } from "../state/inspector.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import FieldRow from "./FieldRow.svelte";

    let { editor, curve, control }: { editor: session.Editor; curve: Curve; control: GeoControl } = $props();
    let node = $derived(curve.nodes[control.index]);
    let segment = $derived(segmentType(curve, control.index));
</script>
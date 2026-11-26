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
{#if control.role === "vertex"}
    {@render segments("节点类型", nodeModes, node.mode, mode => editor.pathNodeMode(control, mode as CurveNode["mode"]),
        canSetManual(curve, control.index) ? undefined : "manual")}
{:else if segment}
    {@render segments("线段类型", segmentTypes, segment, type => editor.segment(control, type as SegmentType))}
    {#if segment === "arc" && node.bulge !== undefined}
        <NumberInput {editor} label="圆心角" kind="literal" unit="°" step={1}
            setting={{ value: degreesFromBulge(node.bulge), change: value => editor.segmentAngle(control, value), validate: bulgeFromDegrees }}>
            {#snippet action()}
                <button class="icon-button" aria-label="相切" data-tip="相切" disabled={neighbor(curve, control.index, -1) === undefined}
                    onclick={() => editor.segment(control, "tangent")}><Icon name="tangent" /></button>
            {/snippet}
        </NumberInput>
    {/if}
{/if}

<style>
    .segmented { display: flex; align-items: center; }
    .segmented button { flex: none; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Curve, type CurveNode } from "../../core/design/v5.ts";
    import { bulgeFromDegrees, degreesFromBulge, neighbor, segmentType, type SegmentType } from "../../core/design/path.ts";
    import { canSetManual } from "../../core/edit/paths.ts";
    import { type GeoControl } from "../../core/edit/geoControls.ts";
    import { nodeModes, segmentTypes } from "../state/inspector.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import FieldRow from "./FieldRow.svelte";
    import NumberInput from "./NumberInput.svelte";

    let { editor, curve, control }: { editor: session.Editor; curve: Curve; control: GeoControl } = $props();
    let node = $derived(curve.nodes[control.index]);
    let segment = $derived(segmentType(curve, control.index));
</script>
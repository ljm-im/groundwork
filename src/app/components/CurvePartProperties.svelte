{#if control.role === "vertex"}
    <FieldRow label="节点类型">
        <SegmentedButtons label="节点类型" options={nodeModes} value={node.mode} choose={mode => mode === node.mode ? undefined : editor.pathNodeMode(control, mode)}
            unavailable={canSetManual(curve, control.index) ? [] : ["manual"]} />
    </FieldRow>
{:else if segment}
    <FieldRow label="线段类型">
        <SegmentedButtons label="线段类型" options={segmentTypes} value={segment} choose={type => editor.segment(control, type)} />
    </FieldRow>
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

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Curve } from "../../core/design/v5.ts";
    import { bulgeFromDegrees, degreesFromBulge, neighbor, segmentType } from "../../core/design/path.ts";
    import { canSetManual } from "../../core/edit/paths.ts";
    import { type GeoControl } from "../../core/edit/geoControls.ts";
    import { nodeModes, segmentTypes } from "../state/inspector.ts";
    import Icon from "./Icon.svelte";
    import FieldRow from "./FieldRow.svelte";
    import NumberInput from "./NumberInput.svelte";
    import SegmentedButtons from "./SegmentedButtons.svelte";

    let { editor, curve, control }: { editor: session.Editor; curve: Curve; control: GeoControl } = $props();
    let node = $derived(curve.nodes[control.index]);
    let segment = $derived(segmentType(curve, control.index));
</script>
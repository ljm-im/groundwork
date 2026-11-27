<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={item.label} icon={geometryIcon(item)} {category} label={category + "名称"}
            rename={label => editor.edit(d => {
                d.geometry[id].label = label;
            })}
            redraw={"curve" in item ? () => editor.redrawGeometry(id) : undefined}
            copy={() => editor.duplicateGeometry(id)} remove={() => editor.removeElement({ kind: "geometry", id })} />
    {/snippet}
    <CheckboxRow label="独立" checked={!!item.independent} change={value => editor.setGeometryIndependent(id, value)} />
    {#if "curve" in item}
        <SelectedCurvePart {editor} curve={item.curve} {path} inset={false} part={control(item.curve, "vertex", nodeId)} />
        <SelectedCurvePart {editor} curve={item.curve} {path} inset={false} part={control(item.curve, "segment", segmentId)} />
    {/if}
</PropertyPane>

<script lang="ts">
    import { type Curve, type GeometryObject } from "../../core/design/v5.ts";
    import { type GeoControl } from "../../core/edit/geoControls.ts";
    import CheckboxRow from "./CheckboxRow.svelte";
    import { geometryIcon } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import SelectedCurvePart from "./SelectedCurvePart.svelte";

    let { editor, id, item, path = -1 }: { editor: session.Editor; id: string; item: GeometryObject; path?: number } = $props();
    let category = $derived("curve" in item ? "曲线" : "点");
    let nodeId = $state<string>(), segmentId = $state<string>();
    function control(curve: Curve, role: "vertex" | "segment", remembered?: string): GeoControl {
        const active = editor.vertex;
        const limit = curve.nodes.length - (role === "segment" && !curve.closed ? 1 : 0);
        const index = active?.path === path && active.role === role ? active.index :
            Math.max(0, curve.nodes.findIndex((node, i) => i < limit && node.id === remembered));
        return { role, path, index, point: curve.nodes[index].p };
    }
    $effect(() => {
        const active = editor.vertex;
        if (!("curve" in item) || active?.path !== path) return;
        const id = item.curve.nodes[active.index]?.id;
        if (active.role === "vertex") nodeId = id;
        if (active.role === "segment") segmentId = id;
    });
</script>
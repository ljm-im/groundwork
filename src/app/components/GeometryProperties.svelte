<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={item.label} icon={geometryIcon(item)} {category} label={category + "名称"}
            rename={label => editor.edit(d => {
                d.geometry[id].label = label;
            })}
            redraw={"curve" in item ? () => editor.redrawGeometry(id) : undefined}
            redrawing={editor.curveToolActive(slot?.key ?? curveKey(id))}
            copy={() => editor.duplicateGeometry(id)} remove={() => editor.removeElement({ kind: "geometry", id })} />
    {/snippet}
    <CheckboxRow label="独立" checked={!!item.independent} change={value => editor.setGeometryIndependent(id, value)} />
    {#if "curve" in item}
        <SelectedCurvePart {editor} curve={item.curve} control={control(item.curve, "vertex", nodeId)}>
            {#snippet values(index, nodeId)}
                {#if profile && profile.curve.nodes[index]}
                    {@const { holder, node, curve, name } = profile}
                    <Part title={name}>
                        {#each nodeQuantities(profileGroups[holder.group].kind) as quantity (quantity)}
                            {@const address = [holder.group, holder.index, ...nodeQuantityPath(nodeId, quantity)]}
                            {@const label = quantity === "slope" ? "坡度" : holder.group === "lines" ? "增量" : "高度"}
                            {#if !needsNodeValue(curve, index)}
                                <CheckboxRow label={"覆盖" + label + "插值"} checked={!interpolates(curve.nodes[index], quantity)}
                                    change={value => editor.setNodeOverride(slot!.key, index, quantity, value)} />
                            {/if}
                            <Parameter {editor} {node} {address} />
                        {/each}
                    </Part>
                {/if}
            {/snippet}
        </SelectedCurvePart>
        <SelectedCurvePart {editor} curve={item.curve} control={control(item.curve, "segment", segmentId)} />
    {/if}
</PropertyPane>

<script lang="ts">
    import { type Curve, type GeometryObject } from "../../core/design/v5.ts";
    import { geometryPath, type GeoControl } from "../../core/edit/geoControls.ts";
    import { curveKey, memberLabel, nodeQuantities, nodeQuantityPath, profileGroups } from "../../core/design/curveReferences.ts";
    import { interpolates, needsNodeValue } from "../../core/design/polyline.ts";
    import CheckboxRow from "./CheckboxRow.svelte";
    import { geometryIcon } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import SelectedCurvePart from "./SelectedCurvePart.svelte";
    import Part from "./Part.svelte";
    import Parameter from "./Parameter.svelte";

    let { editor, id, item, path = -1 }: { editor: session.Editor; id: string; item: GeometryObject; path?: number } = $props();
    let category = $derived("curve" in item ? "曲线" : "点");
    let slot = $derived(editor.geometryPage?.slot);
    let profile = $derived.by(() => {
        const holder = editor.geometryPage?.holder;
        if (!holder || !slot?.holder || holder.group !== "ridges" && holder.group !== "valleys" && holder.group !== "lines") return;
        const owner = slot.holder.location.id;
        const node = editor.project.design.geoNodes.find(n => n.id === owner);
        const placed = editor.project.resolved.geoNodes.find(n => n.id === node?.id);
        const curve = placed && geometryPath(placed, path);
        if (node && curve)
            return { node, curve, holder: { ...holder, group: holder.group }, name: memberLabel(holder.group) + " " + (holder.index + 1) };
    });
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
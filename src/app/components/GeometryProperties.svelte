<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={item.label} icon={geometryIcon(item)} {category} label={category + "名称"}
            rename={label => editor.edit(d => {
                d.geometry[id].label = label;
            })}
            redraw={"curve" in item ? () => editor.redrawGeometry(id) : undefined}
            copy={() => editor.duplicateGeometry(id)} remove={() => editor.removeElement({ kind: "geometry", id })} />
    {/snippet}
    {#if "curve" in item}
        <SelectedCurvePart {editor} curve={item.curve} {path} inset={false} />
    {/if}
</PropertyPane>

<script lang="ts">
    import { type GeometryObject } from "../../core/design/v5.ts";
    import { geometryIcon } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import SelectedCurvePart from "./SelectedCurvePart.svelte";

    let { editor, id, item, path = -1 }: { editor: session.Editor; id: string; item: GeometryObject; path?: number } = $props();
    let category = $derived("curve" in item ? "曲线" : "点");
</script>
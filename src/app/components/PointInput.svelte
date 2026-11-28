{#if slot}
    <GeometryInput {label} summary={pointHolderName(editor.project.design, slot.value)}
        active={!!holder && holder.group !== "peaks" && editor.holderSelected(holder.group, holder.index)}
        onclick={() => editor.openPoint(target)} redraw={() => editor.movePointOnMap(target)}
        redrawLabel={"选取或移动" + label} redrawing={editor.pointToolActive(target)} reference={{ editor, target }}
        onmouseenter={() => editor.hoverSelectionPath(editor.placementPath(holder, target.root))} onmouseleave={() => editor.hoverSelection()} />
{/if}

<script lang="ts">
    import { pointHolderName } from "../../core/design/curveReferences.ts";
    import { pointSlotForSelection, type HolderLayer } from "../../core/edit/selection.ts";
    import * as session from "../state/session.svelte.ts";
    import GeometryInput from "./GeometryInput.svelte";

    let { editor, label, holder }: { editor: session.Editor; label: string; holder?: HolderLayer } = $props();
    let target = $derived({ root: editor.selection!, holder });
    let slot = $derived(editor.selection && pointSlotForSelection(editor.project.design, target));
</script>
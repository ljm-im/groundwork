{#if (control?.role === "vertex" || control?.role === "segment") && control.path === path && curve.nodes[control.index]}
    {@const index = control.index}
    {@const segment = control.role === "segment"}
    {@const name = segment ? "线段" : "节点"}
    {@const id = curve.nodes[index].id}
    {@const step = segment ? segmentNeighbor : neighbor}
    {@const removable = segment ? segmentRemovalIndex(curve, index) !== undefined : canRemoveNode(curve)}
    <Subitem label={name + " " + (index + 1)} {inset} flush={!inset} curveNode={segment ? undefined : id} curveSegment={segment ? id : undefined}
        onmouseenter={() => editor.hoverSelection(editor.selection ?? undefined, control)} onmouseleave={() => editor.hoverSelection()}>
        {#snippet actions()}
            {#if !segment && isEndpoint(curve, index)}
                <button class="icon-button" aria-label="继续画" data-tip="继续画" onclick={() => editor.continueCurve(control)}><Icon name="pen" /></button>
            {/if}
            <button class="icon-button" aria-label={"上一个" + name} data-tip={"上一个" + name} disabled={step(curve, index, -1) === undefined}
                onclick={() => editor.stepCurvePart(-1)}><Icon name="chevronLeft" /></button>
            <button class="icon-button" aria-label={"下一个" + name} data-tip={"下一个" + name} disabled={step(curve, index, 1) === undefined}
                onclick={() => editor.stepCurvePart(1)}><Icon name="chevronRight" /></button>
            {#if removable}
                <button class="icon-button danger" aria-label={"删除" + name} data-tip={"删除" + name}
                    onclick={() => editor.removeCurvePart(editor.selection!, control)}><Icon name="delete" /></button>
            {/if}
        {/snippet}
        {#if values && !segment}{@render values(index, id)}{/if}
        <CurvePartProperties {editor} {curve} {control} />
    </Subitem>
{/if}

<script lang="ts">
    import { type Snippet } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { type Curve } from "../../core/design/v5.ts";
    import { neighbor, segmentNeighbor } from "../../core/design/path.ts";
    import { canRemoveNode, isEndpoint, segmentRemovalIndex } from "../../core/edit/paths.ts";
    import CurvePartProperties from "./CurvePartProperties.svelte";
    import Icon from "./Icon.svelte";
    import Subitem from "./Subitem.svelte";
    let { editor, curve, path, values, inset = true }: { editor: session.Editor; curve: Curve; path: number; inset?: boolean; values?: Snippet<[number, string]> } = $props();
    let control = $derived(editor.vertex);
</script>
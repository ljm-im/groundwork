<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={section.label} category="剖面线" icon="sectionMark" rename={label => editor.edit(d => {
            d.sections.find(s => s.id === section.id)!.label = label;
        })} copy={() => editor.copySection(section.id)} remove={() => editor.removeElement({ kind: "section", id: section.id })} />
    {/snippet}
    {#snippet children(tab)}
        {#if tab === "label"}
            <LabelProperties {editor} target={{ group: "sections", id: section.id }} showLabel={section.showLabel ?? true}
                setLabelVisibility={visible => editor.edit(d => {
                    d.sections.find(s => s.id === section.id)!.showLabel = visible;
                })} />
        {:else}
            <GeometryInput label="剖面线" icon="section" active={false} onclick={() => editor.select({ kind: "section", id: section.id })}
                onmouseenter={() => editor.hoverSelection({ kind: "section", id: section.id })} onmouseleave={() => editor.hoverSelection()} />
            {#each section.points as holder, index (index)}
                <GeometryInput label={index === 0 ? "起点" : "终点"} summary={editor.project.design.geometry[holder.point].label}
                    active={editor.holderSelected("endpoints", index)} onclick={() => editor.openPoint(holderLayer("endpoints", index))}
                    onmouseenter={() => editor.hoverHolder("endpoints", index, true)} onmouseleave={() => editor.hoverSelection()} />
            {/each}
        {/if}
    {/snippet}
</PropertyPane>

<script lang="ts">
    import { holderLayer } from "../../core/edit/selection.ts";
    import * as session from "../state/session.svelte.ts";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import LabelProperties from "./LabelProperties.svelte";
    import GeometryInput from "./GeometryInput.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let section = $derived(editor.project.design.sections.find(s => s.id === editor.selection?.id)!);
</script>
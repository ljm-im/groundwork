<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={section.label} category="剖面线" icon="sectionMark" rename={label => editor.edit(d => {
            d.sections.find(s => s.id === section.id)!.label = label;
        })} copy={() => editor.copySection(section.id)} remove={() => editor.removeSelected()} />
    {/snippet}
    {#snippet children(tab)}
        {#if tab === "label"}
            <LabelProperties {editor} target={{ group: "sections", id: section.id }} showLabel={section.showLabel ?? true}
                setLabelVisibility={visible => editor.edit(d => {
                    d.sections.find(s => s.id === section.id)!.showLabel = visible;
                })} />
        {:else}
            <GeometryInput label="剖面线" icon="section" active={editor.objectGeometry?.kind === "section" && editor.objectGeometry.index === undefined}
                onclick={() => editor.focusObjectGeometry({ kind: "section", id: section.id })} />
            {#each section.points as holder, index (index)}
                <GeometryInput label={index === 0 ? "起点" : "终点"} summary={editor.project.design.geometry[holder.point].label}
                    active={editor.objectGeometry?.kind === "section" && editor.objectGeometry.index === index}
                    onclick={() => editor.openPoint(holder.point, undefined, index)} />
            {/each}
        {/if}
    {/snippet}
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import LabelProperties from "./LabelProperties.svelte";
    import GeometryInput from "./GeometryInput.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let section = $derived(editor.project.design.sections.find(s => s.id === editor.selection?.id)!);
</script>
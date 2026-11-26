<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={section.label} category="剖面线" icon="sectionMark" rename={label => editor.edit(d => {
            d.sections.find(s => s.id === section.id)!.label = label;
        })} remove={() => editor.removeSelected()} />
    {/snippet}
    {#snippet children(tab)}
        {#if tab === "label"}
            <LabelProperties {editor} target={{ group: "sections", id: section.id }} showLabel={section.showLabel ?? true}
                setLabelVisibility={visible => editor.edit(d => {
                    d.sections.find(s => s.id === section.id)!.showLabel = visible;
                })} />
        {:else}
            <GeometryInput label="剖面线" icon="section" active={editor.objectGeometry?.kind === "section"}
                onclick={() => editor.focusObjectGeometry({ kind: "section", id: section.id })} />
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
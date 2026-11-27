{#if mark}
    <PropertyPane {editor}>
        {#snippet title()}
            <PropertyTitle name={mark.label} category={mark.kind === "scale" ? "比例尺" : "文字标记"} icon={markIcon[mark.kind]} rename={label => editor.edit(d => {
                d.marks[index].label = label;
            })} copy={() => editor.copyMark(mark!.id)} remove={() => editor.removeSelected()} />
        {/snippet}
        <Part>
            <PropertySelect label="跟随" value={mark!.follow} options={follows} choose={value => editor.setMarkFollow(mark!.id, value as MarkFollow)} />
            {#if mark.follow === "map"}
                <GeometryInput label="位置" summary={editor.project.design.geometry[mark.point.point].label}
                    active={false} onclick={() => editor.openPoint()}
                    onmouseenter={() => editor.hoverSelectionPath(editor.placementPath())} onmouseleave={() => editor.hoverSelection()} />
            {/if}
            {#if mark!.kind === "text"}
                <CheckboxRow label="显示高度" checked={mark.showElevation ?? false} change={visible => {
                    editor.edit(d => {
                        const m = d.marks[index]; if (m.kind === "text") m.showElevation = visible;
                    });
                }} />
                <NumberInput {editor} label={markParameters.text.label} unit={markParameters.text.unit} step={markParameters.text.step} address={["marks", index, ...markParameters.text.key]} self={"mark:" + mark!.id + ".elevation"} />
            {:else if mark!.follow === "map"}
                <NumberInput {editor} label={markParameters.scale.label} unit={markParameters.scale.unit} step={markParameters.scale.step} address={["marks", index, ...markParameters.scale.key]} self={"mark:" + mark!.id + ".length"} />
            {/if}
        </Part>
    </PropertyPane>
{:else}
    {#each filtered as item (item.kind + ":" + item.id)}
        <ListRow name={item.label} icon={item.icon} attributes={item.kind === "mark" ? { "data-mark": item.id } : { "data-section": item.id }}
            selected={editor.selection?.kind === item.kind && editor.selection.id === item.id}
            select={() => editor.focus(item.kind, item.id)} onmenu={event => editor.openMenu({ kind: item.kind, id: item.id }, event)}
            onmouseenter={() => editor.hoverSelection({ kind: item.kind, id: item.id })} onmouseleave={() => editor.hoverSelection()}>
            {#snippet detail()}<small class="list-detail">{item.detail}</small>{/snippet}
        </ListRow>
    {:else}<EmptyState search={items.length > 0 && !!editor.markFilter.trim()} text="没有标记" />{/each}
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { markParameters } from "../../core/design/functionTable.ts";
    import { type MarkFollow } from "../../core/design/v5.ts";
    import { matchesSearch } from "../state/inspector.ts";
    import PropertySelect from "./PropertySelect.svelte";
    import CheckboxRow from "./CheckboxRow.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import ListRow from "./ListRow.svelte";
    import EmptyState from "./EmptyState.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import Part from "./Part.svelte";
    import NumberInput from "./NumberInput.svelte";

    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    const follows = [{ id: "screen", name: "屏幕" }, { id: "map", name: "地图" }];
    const markIcon = { scale: "scaleMark", text: "textMark" } as const;
    let marks = $derived(editor.project.design.marks);
    let items = $derived([
        ...marks.map(m => ({ id: m.id, label: m.label, kind: "mark" as const, icon: markIcon[m.kind], detail: m.kind === "scale" ? "比例尺" : "文字标记" })),
        ...editor.project.design.sections.map(s => ({ id: s.id, label: s.label, kind: "section" as const, icon: "sectionMark" as const, detail: "剖面线" }))
    ]);
    let filtered = $derived(items.filter(item => matchesSearch(editor.markFilter, item.label, item.detail)));
    let index = $derived(properties ? marks.findIndex(m => m.id === editor.selection?.id) : -1);
    let mark = $derived(marks[index]);
</script>
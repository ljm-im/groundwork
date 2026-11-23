{#if mark}
    <PropertyTitle name={mark.label} rename={label => editor.edit(d => {
        d.marks[index].label = label;
    })}
        copy={() => editor.copyMark(mark.id)} remove={() => editor.removeSelected()} />
    {#if mark.kind === "text"}
        <label class="toggle">显示高度<input type="checkbox" checked={mark.showElevation ?? false} onchange={e => {
            const visible = e.currentTarget.checked;
            editor.edit(d => {
                const m = d.marks[index]; if (m.kind === "text") m.showElevation = visible;
            });
        }} /></label>
        <NumberInput {editor} label="高度" unit="m" address={["marks", index, "elevation"]} self={"mark:" + mark.id + ".elevation"} />
    {:else}
        <NumberInput {editor} label="长度" unit="m" address={["marks", index, "length"]} self={"mark:" + mark.id + ".length"} />
    {/if}
{:else}
    <h2>标记</h2>
    {#each marks as item (item.id)}
        <button class="object-row" data-mark={item.id} aria-pressed={editor.selection?.kind === "mark" && editor.selection.id === item.id}
            onclick={() => editor.focus("mark", item.id)} oncontextmenu={e => {
                e.preventDefault();
                editor.select({ kind: "mark", id: item.id });
                editor.menu = { x: e.clientX, y: e.clientY };
            }}><Icon name={item.kind === "scale" ? "scaleMark" : "textMark"} />{item.label}</button>
    {/each}
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import NumberInput from "./NumberInput.svelte";

    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let marks = $derived(editor.island.design.marks);
    let index = $derived(properties ? marks.findIndex(m => m.id === editor.selection?.id) : -1);
    let mark = $derived(marks[index]);
</script>
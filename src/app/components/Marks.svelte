{#if mark}
    <PropertyPane {editor}>
        {#snippet title()}
            <PropertyTitle name={mark!.label} icon="marks" rename={label => editor.edit(d => {
                d.marks[index].label = label;
            })} copy={() => editor.copyMark(mark!.id)} remove={() => editor.removeSelected()} />
        {/snippet}
        <Part>
            <PropertySelect label="跟随" value={mark!.follow} options={follows} choose={value => editor.setMarkFollow(mark!.id, value as MarkFollow)} />
            {#if mark!.kind === "text"}
                <label class="toggle"><input type="checkbox" checked={mark!.showElevation ?? false} onchange={e => {
                    const visible = e.currentTarget.checked;
                    editor.edit(d => {
                        const m = d.marks[index]; if (m.kind === "text") m.showElevation = visible;
                    });
                }} />显示高度</label>
                <NumberInput {editor} label="高度" unit="m" address={["marks", index, "elevation"]} self={"mark:" + mark!.id + ".elevation"} />
            {:else if mark!.follow === "ground"}
                <NumberInput {editor} label="长度" unit="m" address={["marks", index, "length"]} self={"mark:" + mark!.id + ".length"} />
            {/if}
        </Part>
    </PropertyPane>
{:else}
    <Search id="mark-search" label="查找标记" bind:value={editor.markFilter} />
    {#each filtered as item (item.id)}
        <button class="object-row" data-mark={item.id} aria-pressed={editor.selection?.kind === "mark" && editor.selection.id === item.id}
            onclick={() => editor.focus("mark", item.id)} oncontextmenu={e => {
                e.preventDefault();
                editor.openMenu({ kind: "mark", id: item.id }, e.clientX, e.clientY);
            }}><Icon name="marks" />{item.label}<small class="list-detail">{item.kind === "scale" ? "比例尺" : "文字"}</small></button>
    {:else}<div class="list-empty">没有匹配的结果</div>{/each}
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type MarkFollow } from "../../core/design/v5.ts";
    import PropertySelect from "./PropertySelect.svelte";
    import Search from "./Search.svelte";
    import Icon from "./Icon.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import Part from "./Part.svelte";
    import NumberInput from "./NumberInput.svelte";

    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    const follows = [{ id: "screen", name: "画面" }, { id: "ground", name: "地面" }];
    let marks = $derived(editor.project.design.marks);
    let filtered = $derived(marks.filter(m => [m.label, m.id, m.kind === "scale" ? "比例尺" : "文字标记"]
        .some(text => text.toLowerCase().includes(editor.markFilter.trim().toLowerCase()))));
    let index = $derived(properties ? marks.findIndex(m => m.id === editor.selection?.id) : -1);
    let mark = $derived(marks[index]);
</script>
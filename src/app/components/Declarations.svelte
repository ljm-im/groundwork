{#if !properties}
    <Part title="变量" count={Object.keys(d.variables).length}>
        {#each Object.entries(d.variables) as [id, v] (id)}
            <div class="declaration">
                <button class="object-row" data-select-variable={id} aria-pressed={h?.kind === "variable" && h.id === id} onclick={() => editor.select({ kind: "variable", id })}>
                    <Icon name="variables" />{v.label ?? id}
                </button>
                <div data-variable={id}><NumberInput {editor} label={v.label ?? id} address={["variables", id, "value"]} self={"var:" + id} range={v.range} step={v.range?.[2] ?? (id === "seed" ? 1 : .1)} /></div>
            </div>
        {/each}
        <button data-add="variable" onclick={() => editor.addDeclaration("variable")}>新建变量</button>
    </Part>
    <Part title="场" count={Object.keys(d.fields).length + 1}>
        {#each ["height", ...Object.keys(d.fields)] as id (id)}
            <button class="object-row" data-select-field={id} aria-pressed={h?.kind === "field" && h.id === id} onclick={() => editor.select({ kind: "field", id })}>
                <Icon name="field" />{id === "height" ? "高度" : d.fields[id].label ?? id}{#if id !== "height"}<small>{d.fields[id].default}</small>{/if}
            </button>
        {/each}
        <button data-add="field" onclick={() => editor.addDeclaration("field")}>新建场</button>
    </Part>
{:else if h?.kind === "field" && h.id === "height"}
    <PropertyTitle name="高度" label="场名称" /><div class="sub">内置场 · 单位 m</div>
{:else if h}
    {@const variable = h.kind === "variable"}
    {@const table = variable ? "variables" : "fields"}
    {@const item = d[table][h.id]}
    {#if item}
        <PropertyTitle name={item.label ?? h.id} label={variable ? "变量名称" : "场名称"} rename={name => editor.edit(d => {
            d[table][h!.id].label = name;
        })} remove={() => editor.removeSelected()} />
        {#if variable}
            {@const v = d.variables[h.id]}
            <NumberInput {editor} label="当前值" address={[table, h.id, "value"]} self={"var:" + h.id} range={v.range} step={v.range?.[2] ?? (h.id === "seed" ? 1 : .1)} />
            <Part title="取值范围">
                {#if v.range}
                    {#each ["最小值", "最大值", "步长"] as label, i (label)}
                        <NumberInput {editor} {label} address={[table, h.id, "range", i]} kind="literal" />
                    {/each}
                    <button onclick={() => editor.edit(d => {
                        delete d.variables[h!.id].range;
                    })}>清空范围</button>
                {:else}
                    <button onclick={() => editor.edit(d => {
                        const value = editor.island.resolved.variables[h!.id].value;
                        d.variables[h!.id].range = [Math.min(0, value), Math.max(10, value), .1];
                    })}>添加范围</button>
                {/if}
            </Part>
        {:else}<NumberInput {editor} label="默认值" address={[table, h.id, "default"]} />{/if}
    {/if}
{/if}

<style>
    .declaration { display: grid; grid-template-columns: minmax(0, 1fr) minmax(108px, 59%); align-items: center; gap: 6px; }
    .declaration :global(.number-label) { display: none; }
    .declaration .object-row { gap: 5px; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import Part from "./Part.svelte";
    import Icon from "./Icon.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let d = $derived(editor.island.design), h = $derived(editor.selection);
</script>
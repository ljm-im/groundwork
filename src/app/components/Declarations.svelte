{#if !properties}
    <Part title="自定义输入" icon="inputs" count={Object.keys(d.inputs).length}>
        {#snippet actions()}
            <button class="icon-button" data-add="input" data-tip="新建自定义输入" aria-label="新建自定义输入" onclick={() => editor.addDeclaration("input")}><Icon name="plus" /></button>
        {/snippet}
        {#each Object.entries(d.inputs) as [id, v] (id)}
            <div class="declaration" class:is-selected={h?.kind === "input" && h.id === id}>
                <button class="object-row" data-select-input={id} aria-pressed={h?.kind === "input" && h.id === id} onclick={() => editor.select({ kind: "input", id })}>
                    <Icon name="inputs" /><span>{v.label ?? id}</span>
                </button>
                <div data-input={id}><NumberInput {editor} label={v.label ?? id} address={["inputs", id, "value"]} self={"input:" + id}
                    range={v.range} step={v.range?.[2] ?? (id === "seed" ? 1 : .1)} compact /></div>
            </div>
        {/each}
    </Part>
    <Part title="场" icon="field" count={Object.keys(d.fields).length + 1}>
        {#snippet actions()}
            <button class="icon-button" data-add="field" data-tip="新建场" aria-label="新建场" onclick={() => editor.addDeclaration("field")}><Icon name="plus" /></button>
        {/snippet}
        {#each ["height", ...Object.keys(d.fields)] as id (id)}
            <button class="object-row" data-select-field={id} aria-pressed={h?.kind === "field" && h.id === id} onclick={() => editor.select({ kind: "field", id })}>
                <Icon name="field" />{id === "height" ? "高度" : d.fields[id].label ?? id}
                {#if id !== "height"}<small class="list-detail">{typeof d.fields[id].default === "string" ? displayExpression(d.fields[id].default, d) : displayNumber(editor.island.resolved.fields[id].default, .1)}</small>{/if}
            </button>
        {/each}
    </Part>
{:else if h?.kind === "field" && h.id === "height"}
    <PropertyPane {editor}>
        {#snippet title()}<PropertyTitle name="高度" icon="field" />{/snippet}
        <div class="sub">内置场（单位 m）</div>
    </PropertyPane>
{:else if h}
    {@const variable = h.kind === "input"}
    {@const table = variable ? "inputs" : "fields"}
    {@const item = d[table][h.id]}
    {#if item}
        <PropertyPane {editor}>
            {#snippet title()}
                <PropertyTitle name={item.label ?? h!.id} icon={variable ? "inputs" : "field"} label={variable ? "自定义输入名称" : "场名称"}
                    rename={name => editor.edit(d => {
                        d[table][h!.id].label = name;
                    })} remove={() => editor.removeSelected()} />
            {/snippet}
            {#if variable}
                {@const v = d.inputs[h!.id]}
                <Part>
                    <NumberInput {editor} label="当前值" address={[table, h!.id, "value"]} self={"input:" + h!.id} range={v.range}
                        step={v.range?.[2] ?? (h!.id === "seed" ? 1 : .1)} />
                </Part>
                <Part title="取值范围">
                    {#snippet actions()}
                        {#if v.range}
                            <button class="icon-button danger" data-tip="清空范围" aria-label="清空范围" onclick={() => editor.edit(d => {
                                delete d.inputs[h!.id].range;
                            })}><Icon name="delete" /></button>
                        {:else}
                            <button class="icon-button" data-tip="添加范围" aria-label="添加范围" onclick={() => editor.edit(d => {
                                const value = editor.island.resolved.inputs[h!.id].value;
                                d.inputs[h!.id].range = [Math.min(0, value), Math.max(10, value), .1];
                            })}><Icon name="plus" /></button>
                        {/if}
                    {/snippet}
                    {#if v.range}
                        {#each ["最小值", "最大值", "步长"] as label, i (label)}
                            <NumberInput {editor} {label} address={[table, h!.id, "range", i]} kind="literal" step={v.range[2]} />
                        {/each}
                    {/if}
                </Part>
            {:else}<NumberInput {editor} label="默认值" address={[table, h!.id, "default"]} />{/if}
        </PropertyPane>
    {/if}
{/if}

<style>
    .declaration {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(var(--name-w), 55%);
        align-items: center;
        gap: var(--space-1);
        padding-right: var(--space-3);
    }
    .declaration .object-row { background: transparent; }
    .declaration .object-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .declaration:hover { background: var(--bg-hover); }
    .declaration.is-selected { background: var(--bg-selected); }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { displayExpression, displayNumber } from "../state/numbers.ts";
    import Part from "./Part.svelte";
    import Icon from "./Icon.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let d = $derived.by(() => {
        editor.revision;
        return editor.island.design;
    }), h = $derived(editor.selection);
</script>
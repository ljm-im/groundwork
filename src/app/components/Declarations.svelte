{#if !properties}
    <Search id="variable-search" label="查找变量" bind:value={editor.variableFilter} />
    <Part title="输入">
        {#snippet actions()}
            <button class="icon-button" data-add="input" data-tip="新建自定义输入" aria-label="新建自定义输入" onclick={() => editor.addDeclaration("input")}><Icon name="plus" /></button>
        {/snippet}
        {#each inputs as [id, v] (id)}
            {@const builtin = isBuiltin("input", id)}
            <div class="declaration" class:is-selected={h?.kind === "input" && h.id === id}>
                <button class="object-row" data-select-input={id} aria-pressed={h?.kind === "input" && h.id === id} onclick={() => editor.select({ kind: "input", id })}
                    oncontextmenu={e => {
                        e.preventDefault();
                        if (!builtin) editor.openMenu({ kind: "input", id }, e.clientX, e.clientY);
                    }}>
                    <Icon name="inputs" {builtin} /><span>{v.label ?? id}</span>
                </button>
                <div data-input={id}><NumberInput {editor} label={v.label ?? id} address={["inputs", id, "value"]} self={"input:" + id}
                    range={v.range} step={v.range[2]} compact /></div>
            </div>
        {:else}<div class="list-empty">没有匹配的结果</div>{/each}
    </Part>
    <Part title="场">
        {#snippet actions()}
            <button class="icon-button" data-add="field" data-tip="新建场" aria-label="新建场" onclick={() => editor.addDeclaration("field")}><Icon name="plus" /></button>
        {/snippet}
        {#each fields as [id, field] (id)}
            <button class="object-row" data-select-field={id} aria-pressed={h?.kind === "field" && h.id === id} onclick={() => editor.select({ kind: "field", id })}
                oncontextmenu={e => {
                    e.preventDefault();
                    if (!isBuiltin("field", id)) editor.openMenu({ kind: "field", id }, e.clientX, e.clientY);
                }}>
                <Icon name="field" builtin={isBuiltin("field", id)} />{field.label}
            </button>
        {:else}<div class="list-empty">没有匹配的结果</div>{/each}
    </Part>
{:else if h?.kind === "input" || h?.kind === "field"}
    {@const variable = h.kind === "input"}
    {@const table = variable ? "inputs" : "fields"}
    {@const item = d[table][h.id]}
    {#if item}
        {@const builtin = isBuiltin(h.kind, h.id)}
        <PropertyPane {editor}>
            {#snippet title()}
                <PropertyTitle name={item.label ?? h!.id} icon={variable ? "inputs" : "field"} label={variable ? "自定义输入名称" : "场名称"}
                    {builtin} rename={!builtin ? name => editor.edit(d => {
                        d[table][h!.id].label = name;
                    }) : undefined}
                    remove={builtin ? undefined : () => editor.removeSelected()} />
            {/snippet}
            {#if variable}
                {@const v = d.inputs[h!.id]}
                <Part>
                    <NumberInput {editor} label="当前值" address={[table, h!.id, "value"]} self={"input:" + h!.id} range={v.range} step={v.range[2]} />
                </Part>
                <Part title="取值范围">
                    {#each ["最小值", "最大值", "步长"] as label, i (label)}
                        <NumberInput {editor} {label} address={[table, h!.id, "range", i]} kind="literal" step={v.range[2]} inputStep={i === 2} />
                    {/each}
                </Part>
            {:else}
                {@const f = d.fields[h.id]}
                {@const precision = fieldPrecision(f)}
                <Part>
                    <FieldRow label="单位" readOnlyValue={builtin ? f.unit ?? "" : undefined}>
                        <input class="input-box" aria-label="单位" value={f.unit ?? ""} onchange={e => {
                            const unit = e.currentTarget.value.trim();
                            if (unit === (f.unit ?? "")) return;
                            editor.edit(d => {
                                if (unit) d.fields[h!.id].unit = unit;
                                else delete d.fields[h!.id].unit;
                            });
                        }} />
                    </FieldRow>
                    {#if builtin}
                        <FieldRow label="精度" unit={f.unit} readOnlyValue={displayValue(precision, precision)} />
                    {:else}
                        <NumberInput {editor} label="精度" unit={f.unit} address={["fields", h.id, "precision"]} kind="literal"
                            step={precision} fallback={defaultFieldPrecision} inputStep />
                    {/if}
                </Part>
            {/if}
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
    import { defaultFieldPrecision, declarationEntries, fieldPrecision, isBuiltin } from "../../core/design/defaults.ts";
    import { displayValue } from "../state/numbers.ts";
    import Search from "./Search.svelte";
    import Part from "./Part.svelte";
    import Icon from "./Icon.svelte";
    import FieldRow from "./FieldRow.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let d = $derived.by(() => {
        editor.revision;
        return editor.project.design;
    }), h = $derived(editor.selection);
    const matches = (id: string, name: string) => (name + " " + id).toLowerCase().includes(editor.variableFilter.trim().toLowerCase());
    let inputs = $derived(declarationEntries("input", d.inputs).filter(([id, input]) => matches(id, input.label ?? id)));
    let fields = $derived(declarationEntries("field", d.fields).filter(([id, field]) => matches(id, field.label)));
</script>
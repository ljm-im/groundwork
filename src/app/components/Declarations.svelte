{#if !properties}
    <Part title="输入">
        {#snippet actions()}
            <AddButton label="新建自定义输入" attributes={{ "data-add": "input" }} action={() => editor.addDeclaration("input")} />
        {/snippet}
        {#each inputs as [id, v] (id)}
            {@const builtin = isBuiltin("input", id)}
            <ListRow icon="inputs" name={v.label ?? id} {builtin} actionsWidth="55%" attributes={{ "data-select-input": id }} selected={h?.kind === "input" && h.id === id}
                select={() => editor.focus("input", id)} onmenu={builtin ? undefined : event => editor.openMenu({ kind: "input", id }, event)}>
                {#snippet actions()}
                    <div data-input={id}><NumberInput {editor} label={v.label ?? id} address={["inputs", id, "value"]} self={"input:" + id}
                        range={v.range} step={v.range[2]} compact namedInput /></div>
                {/snippet}
            </ListRow>
        {:else}<EmptyState search />{/each}
    </Part>
    <Part title="场">
        {#snippet actions()}
            <AddButton label="新建场" attributes={{ "data-add": "field" }} action={() => editor.addDeclaration("field")} />
        {/snippet}
        {#each fields as [id, field] (id)}
            {@const builtin = isBuiltin("field", id)}
            <ListRow icon="field" name={field.label} {builtin} attributes={{ "data-select-field": id }} selected={h?.kind === "field" && h.id === id}
                select={() => editor.focus("field", id)} onmenu={builtin ? undefined : event => editor.openMenu({ kind: "field", id }, event)} />
        {:else}<EmptyState search />{/each}
    </Part>
    <Part title="曲线">
        {#snippet actions()}
            <AddButton label="新建曲线" attributes={{ "data-add": "curve" }} active={editor.toolActive("sharedCurve")} action={startCurve} />
        {/snippet}
        {#each curves as [id, item] (id)}
            {@const target = { kind: "curve" as const, id }}
            <ListRow icon={item.curve.closed ? "closedPath" : "curve"} name={item.label} attributes={{ "data-select-curve": id }}
                selected={h?.kind === "curve" && h.id === id} select={() => editor.focus("curve", id)}
                onmenu={event => editor.openMenu(target, event)} onmouseenter={() => editor.hoverSelection(target)} onmouseleave={() => editor.hoverSelection()} />
        {:else}<EmptyState search={!!editor.variableFilter.trim()} text="没有曲线" />{/each}
    </Part>
{:else if h?.kind === "curve" && d.curves[h.id]}
    {@const item = d.curves[h.id]}
    {@const key = curveKey(h.id)}
    {@const icon = item.curve.closed ? "closedPath" : "curve"}
    <PropertyPane {editor}>
        {#snippet title()}
            <PropertyTitle name={item.label} {icon} label="曲线名称" rename={name => editor.edit(d => {
                d.curves[h!.id].label = name;
            })}
                removeLabel="删除曲线" remove={() => editor.removeElement(h!)} />
        {/snippet}
        <Part>
            <GeometryInput label="曲线" {icon} count={item.curve.nodes.length} active={editor.geometry?.kind === "curve"}
                onclick={() => editor.focusGeometry({ kind: "curve", index: -1 })}
                redraw={() => editor.drawCurve(key)} redrawing={editor.curveToolActive(key)} />
            <SelectedCurvePart {editor} curve={item.curve} path={-1} />
        </Part>
    </PropertyPane>
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
                        <input class="input-box" aria-label="单位" value={f.unit ?? ""}
                            use:pendingInput={input => commitUnit(h!.id, input.value)}
                            onchange={e => commitUnit(h!.id, e.currentTarget.value)} />
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

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { defaultFieldPrecision, declarationEntries, fieldPrecision, isBuiltin } from "../../core/design/defaults.ts";
    import { curveKey } from "../../core/design/curveReferences.ts";
    import { displayValue } from "../../core/design/display.ts";
    import { matchesSearch } from "../state/inspector.ts";
    import { pendingInput } from "../state/pendingInput.ts";
    import AddButton from "./AddButton.svelte";
    import ListRow from "./ListRow.svelte";
    import EmptyState from "./EmptyState.svelte";
    import Part from "./Part.svelte";
    import FieldRow from "./FieldRow.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import SelectedCurvePart from "./SelectedCurvePart.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let d = $derived(editor.project.design), h = $derived(editor.selection);
    const matches = (id: string, name: string) => matchesSearch(editor.variableFilter, name + " " + id);
    let inputs = $derived(declarationEntries("input", d.inputs).filter(([id, input]) => matches(id, input.label ?? id)));
    let fields = $derived(declarationEntries("field", d.fields).filter(([id, field]) => matches(id, field.label)));
    let curves = $derived(Object.entries(d.curves).filter(([, item]) => matchesSearch(editor.variableFilter, item.label)));
    function startCurve() {
        editor.setTool("sharedCurve");
        editor.map.canvas.focus({ preventScroll: true });
    }
    function commitUnit(id: string, text: string) {
        const unit = text.trim();
        if (unit === (d.fields[id].unit ?? "")) return;
        editor.edit(d => {
            if (unit) d.fields[id].unit = unit;
            else delete d.fields[id].unit;
        });
    }
</script>
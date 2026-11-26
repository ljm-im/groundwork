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
    <Part title="几何">
        {#snippet actions()}
            <AddButton label="新建几何对象" attributes={{ "data-add": "geometry" }} options={geometryTools}
                active={geometryTools.some(({ id }) => editor.toolActive(id))} choose={id => editor.addGeometry(id as GeometryTool)} />
        {/snippet}
        {#each geometries as [id, item] (id)}
            {@const target = { kind: "geometry" as const, id }}
            <ListRow icon={geometryIcon(item)} name={item.label} attributes={{ "data-select-geometry": id }}
                selected={h?.kind === "geometry" && h.id === id} select={() => editor.focus("geometry", id)}
                onmenu={event => editor.openMenu(target, event)} onmouseenter={() => editor.hoverSelection(target)} onmouseleave={() => editor.hoverSelection()} />
        {:else}<EmptyState search={eligibleGeometry.length > 0 && !!editor.variableFilter.trim()} text="没有点和曲线" />{/each}
    </Part>
{:else if h?.kind === "input" || h?.kind === "field"}
    {@const variable = h.kind === "input"}
    {@const table = variable ? "inputs" : "fields"}
    {@const item = d[table][h.id]}
    {#if item}
        {@const builtin = isBuiltin(h.kind, h.id)}
        <PropertyPane {editor}>
            {#snippet title()}
                <PropertyTitle name={item.label ?? h!.id} category={variable ? "输入" : "场"} icon={variable ? "inputs" : "field"} label={variable ? "自定义输入名称" : "场名称"}
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
    import { displayValue } from "../../core/design/display.ts";
    import { geometryIcon, matchesSearch } from "../state/inspector.ts";
    import { pendingInput } from "../state/pendingInput.ts";
    import AddButton from "./AddButton.svelte";
    import ListRow from "./ListRow.svelte";
    import EmptyState from "./EmptyState.svelte";
    import Part from "./Part.svelte";
    import FieldRow from "./FieldRow.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import NumberInput from "./NumberInput.svelte";
    let { editor, properties = false }: { editor: session.Editor; properties?: boolean } = $props();
    let d = $derived(editor.project.design), h = $derived(editor.selection);
    const matches = (name: string) => matchesSearch(editor.variableFilter, name);
    let inputs = $derived(declarationEntries("input", d.inputs).filter(([id, input]) => matches(input.label ?? id)));
    let fields = $derived(declarationEntries("field", d.fields).filter(([, field]) => matches(field.label)));
    let eligibleGeometry = $derived(Object.entries(d.geometry).filter(([id, item]) => item.listed || (editor.geometryUses.get(id)?.length ?? 0) >= 2));
    let geometries = $derived(eligibleGeometry.filter(([, item]) => matches(item.label)));
    const geometryTools = [{ id: "geometryPoint", name: "点", icon: "point" }, { id: "geometryCurve", name: "曲线", icon: "curve" },
        { id: "geometryClosed", name: "闭合曲线", icon: "closedPath" }] as const;
    type GeometryTool = typeof geometryTools[number]["id"];
    function commitUnit(id: string, text: string) {
        const unit = text.trim();
        if (unit === (d.fields[id].unit ?? "")) return;
        editor.edit(d => {
            if (unit) d.fields[id].unit = unit;
            else delete d.fields[id].unit;
        });
    }
</script>
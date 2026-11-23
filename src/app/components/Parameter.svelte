<div class="parameter" class:inline={!bound && kind !== "number"} data-parameter={address.join(".")}>
    <label class="field">{label}
        {#if !bound}<input aria-label={label} type="number" step="any" value={typeof value === "number" ? value : ""} placeholder={optional ? "未设置" : ""}
            onchange={e => {
                if (e.currentTarget.value === "" && optional) write(undefined); else if (Number.isFinite(e.currentTarget.valueAsNumber)) write(e.currentTarget.valueAsNumber);
            }} />
        {:else}<span>{bindingName}</span>{/if}
    </label>
    {#if bound}
        <div class="binding">
            {#if "field" in bound}<label>× <input type="number" aria-label={label + "缩放"} step="any" value={bound.scale ?? 1} onchange={e => write({ ...bound!, scale: e.currentTarget.valueAsNumber })} /></label>{/if}
            <label>+ <input type="number" aria-label={label + "偏移"} step="any" value={bound.offset ?? 0} onchange={e => write({ ...bound!, offset: e.currentTarget.valueAsNumber })} /></label>
            <button onclick={() => write(resolved(bound!, d, field => editor.island.inputAt(node.id, field, editor.geoCenter(node.id))))}>解除绑定</button>
        </div>
    {:else if kind !== "number"}
        <div class="binding">
            {#if choosing}
                <select aria-label={"选择绑定" + (kind === "height" ? "变量" : "场")} value="" onchange={e => bind(e.currentTarget.value)}>
                    <option value="" disabled>请选择</option>
                    {#if kind === "height"}
                        {#each Object.entries(d.variables) as [id, v] (id)}<option value={id}>{v.label ?? id}</option>{/each}
                        <option value={newOption}>新建变量…</option>
                    {:else}
                        <option value="height">高度</option>{#each Object.entries(d.fields) as [id, f] (id)}<option value={id}>{f.label ?? id}</option>{/each}
                    {/if}
                </select>
            {:else}<button onclick={() => choosing = true}>绑定{kind === "height" ? "变量" : "场"}</button>{/if}
        </div>
    {/if}
</div>

<style>
    .parameter { border-bottom: 1px solid var(--line); padding-bottom: 3px; }
    .parameter.inline { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px; }
    .parameter.inline .field input { width: 60px; }
    .binding { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 5px; font-size: 11px; }
    .binding input { width: 52px; }
    .binding button, .binding select { font-size: 11px; min-height: 23px; padding: 1px 5px; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type GeoNode, type Height, type FieldInput } from "../../core/design/v5.ts";
    import { addVariable, bindHeight, bindField, resolved } from "../../core/edit/geoNodes.ts";
    import { geoAt } from "../state/geoTools.ts";
    let { editor, node, address, label, kind = "number", optional = false }: { editor: session.Editor; node: GeoNode; address: (string | number)[]; label: string; kind?: "height" | "field" | "number"; optional?: boolean } = $props();
    let choosing = $state(false), d = $derived(editor.island.design);
    function parent(n: GeoNode): Record<string, Height | FieldInput | undefined> {
        return address.slice(0, -1).reduce<object>((v, key) => Reflect.get(v, key), n.function) as Record<string, Height | FieldInput | undefined>;
    }
    let key = $derived(String(address.at(-1))), value = $derived(parent(node)[key]);
    let bound = $derived(typeof value === "object" ? value : undefined);
    let bindingName = $derived(bound ? "var" in bound ? d.variables[bound.var]?.label ?? bound.var : bound.field === "height" ? "高度" : d.fields[bound.field]?.label ?? bound.field : "");
    let newOption = $derived(Object.keys(d.variables).reduce((s, id) => s.length > id.length ? s : "＋".repeat(id.length + 1), "＋"));
    function write(v: Height | FieldInput | undefined) {
        editor.editNode(node.id, n => {
            if (v === undefined) delete parent(n)[key]; else parent(n)[key] = v;
        });
    }
    function bind(id: string) {
        editor.edit(d => {
            const target = parent(geoAt(d, node.id)), variable = kind === "height" && id === newOption ? addVariable(d, typeof value === "number" ? value : 0) : id;
            target[key] = kind === "height" ? bindHeight(variable) : bindField(id);
        });
    }
</script>
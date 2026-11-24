{#snippet param(address: Address)}
    <Parameter {editor} node={n} {address} />
{/snippet}
{#snippet geometry(label: string, kind: GeometryTarget["kind"], index: number, icon: "point" | "polyline" | "closedPath", count: number, heightAt?: Address, redraw?: DrawTool, member?: number)}
    {@const active = editor.map.geometry?.kind === kind && editor.map.geometry.index === index}
    <GeometryInput {label} {icon} {count} {active} onclick={() => editor.focusGeometry({ kind, index })}
        redraw={redraw ? () => editor.setTool(redraw, n.id, member) : undefined} />
    {#if heightAt && active && vertex?.role === "parameter" && vertex.path === index && vertex.index < count}
        {@render param(icon === "point" ? [...heightAt, "h"] : [...heightAt, vertex.index, "h"])}
    {/if}
{/snippet}
{#snippet action(label: string, icon: "plus" | "delete", click: () => void)}
    <button class="icon-button" class:danger={icon === "delete"} aria-label={label} data-tip={label} onclick={click}><Icon name={icon} /></button>
{/snippet}
<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={n.label} icon="terrain" rename={name => editor.editNode(n.id, item => item.label = name)} disabled={!!n.disabled}
            toggle={() => editor.toggle(n.id)} copy={() => editor.duplicate(n.id)} remove={() => editor.removeGeo(n.id)} />
    {/snippet}
    {#snippet children(tab)}
        {#if tab === "label"}
            <LabelProperties {editor} target={{ group: "geoNodes", id: n.id }} showLabel={n.showLabel ?? false}
                setLabelVisibility={visible => editor.editNode(n.id, item => item.showLabel = visible)} />
        {:else if tab === "region"}
            <Part>
                <FieldRow label="构造方式"><span>{c.type === "free" ? "自由构造" : "条带"}</span></FieldRow>
                {#if c.type === "free"}
                    {#each c.paths as path, i (i)}
                        {@render geometry(c.paths.length === 1 ? "边界" : "边界 " + (i + 1), "path", i, "closedPath", path.nodes.length)}
                    {/each}
                {:else if c.type === "strip"}
                    <GeometryInput label="边" icon="polyline" summary={stripSummary(c)} active={editor.tool === "strip" && editor.map.draft?.owner === n.id}
                        onclick={() => editor.setTool("strip", n.id)} />
                    {#each [0, 1] as i (i)}
                        <Parameter {editor} node={n} address={["widths", i]} construction />
                    {/each}
                {/if}
            </Part>
            {#if vertex?.role === "vertex" && vertex.path >= 0 && pathNode}
                <NodeProperties {editor} node={pathNode} control={vertex} />
            {/if}
        {:else if tab === "function"}
            <Part>
                <PropertySelect label="函数" group="函数" icon="function" value={f.type}
                    options={allowedFunctions(n).map(id => ({ id, name: id, builtin: isBuiltinFunction(id) }))}
                    choose={id => editor.switchFunction(n, id as GeoFunction["type"])} />
                <PropertySelect label="输出到" group="场" icon="field" value={n.field} options={fields}
                    choose={id => editor.editNode(n.id, v => v.field = id)} />
                {#if f.type === "slope"}
                    <PropertySelect label="坡面形式" value={f.kind} options={[{ id: "path", name: "沿路径" }, { id: "radial", name: "径向" }]}
                        choose={kind => editor.switchFunction(n, "slope", kind === "radial" ? "radial" : "path")} />
                {/if}
                {#each mainParameters as p (p.key.join("."))}
                    {#if p.type !== "geometry"}{@render param(p.key)}
                    {:else if f.type === "coast" && p.key[0] === "shore"}
                        {@render geometry(p.label, "path", -1, "closedPath", f.shore.nodes.length, undefined, "shore")}
                    {:else if f.type === "coast"}
                        {@render geometry(p.label, "parameter", 0, "point", 1, undefined, "harbor")}
                    {:else if f.type === "slope" && f.kind === "path"}
                        {@render geometry(p.label, "parameter", 0, "polyline", f.line.points.length, ["line", "points"], "slopeLine")}
                        {#each functionTable.slope.toggles ?? [] as toggle (toggle.label)}
                            <label class="toggle"><input type="checkbox" checked={Boolean(readAt(f, toggle.key) ?? toggle.default)} onchange={e => {
                                const value = e.currentTarget.checked;
                                editor.editNode(n.id, item => writeAt(item.function, toggle.key, value));
                            }} />{toggle.label}</label>
                        {/each}
                    {:else if f.type === "slope"}
                        {@render geometry(p.label, "parameter", 0, "point", 1, undefined, "center")}
                    {/if}
                {/each}
            </Part>
            {#if advancedParameters.length}
                <Part>
                    <Subitem label="高级" open={editor.subitemOpen(n.id, "advanced", 0)} onclick={() => editor.toggleSubitem(n.id, "advanced", 0)}>
                        {#each advancedParameters as p (p.key.join("."))}{@render param(p.key)}{/each}
                    </Subitem>
                </Part>
            {:else if f.type === "mountain"}
                <Part title="山脊">
                    {#snippet actions()}{@render action("添加山脊", "plus", () => editor.setTool("ridge", n.id))}{/snippet}
                    {#each f.ridges as ridge, j (j)}
                        <Subitem label={"山脊 " + (j + 1)} open={editor.subitemOpen(n.id, "ridges", j)} onclick={() => editor.toggleSubitem(n.id, "ridges", j)}>
                            {#snippet actions()}{@render action("删除山脊 " + (j + 1), "delete", () => removeMember("ridges", j))}{/snippet}
                            {@render geometry(geoParameter(n, ["function", "ridges", j, "line"])!.label, "parameter", j, "polyline", ridge.line.points.length, ["ridges", j, "line", "points"], "ridge", j)}
                            <label class="toggle"><input type="checkbox" checked={!!ridge.line.smooth} onchange={e => {
                                const smooth = e.currentTarget.checked;
                                editor.editNode(n.id, item => {
                                    if (item.function.type === "mountain") item.function.ridges[j].line.smooth = smooth;
                                });
                            }} />{functionTable.mountain.toggles?.[0].label}</label>
                            {#each memberParameters("ridges", j) as key (key.join("."))}
                                {@render param(key)}
                            {/each}
                        </Subitem>
                    {/each}
                </Part>
                <Part title="山峰">
                    {#snippet actions()}{@render action("添加山峰", "plus", () => editor.setTool("peak", n.id))}{/snippet}
                    {#each f.peaks.keys() as j (j)}
                        <Subitem label={"山峰 " + (j + 1)} open={editor.subitemOpen(n.id, "peaks", j)} onclick={() => editor.toggleSubitem(n.id, "peaks", j)}>
                            {#snippet actions()}{@render action("删除山峰 " + (j + 1), "delete", () => removeMember("peaks", j))}{/snippet}
                            {@render geometry(geoParameter(n, ["function", "peaks", j, "at", "p"])!.label, "parameter", f.ridges.length + j, "point", 1, ["peaks", j, "at"], "peak", j)}
                            {#each memberParameters("peaks", j) as key (key.join("."))}
                                {@render param(key)}
                            {/each}
                        </Subitem>
                    {/each}
                </Part>
            {/if}
        {:else}<ObjectProblems {editor} />{/if}
    {/snippet}
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { allowedFunctions } from "../../core/edit/geoNodes.ts";
    import { type GeoFunction, type Strip } from "../../core/design/v5.ts";
    import { declarationEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { canWrite, functionParameters, functionTable, isBuiltinFunction } from "../../core/design/functionTable.ts";
    import { geoAt, type DrawTool } from "../state/geoTools.ts";
    import { geoParameter, readAt, writeAt, type Address } from "../../core/design/parameters.ts";
    import { geometryPath, removeGeometryItem, type GeometryTarget } from "../../core/edit/geoControls.ts";
    import Icon from "./Icon.svelte";
    import FieldRow from "./FieldRow.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import Part from "./Part.svelte";
    import LabelProperties from "./LabelProperties.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import PropertySelect from "./PropertySelect.svelte";
    import Parameter from "./Parameter.svelte";
    import NodeProperties from "./NodeProperties.svelte";
    import Subitem from "./Subitem.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.project.design), n = $derived(geoAt(d, editor.selection!.id));
    let c = $derived(n.construction), f = $derived(n.function);
    let fields = $derived(declarationEntries("field", d.fields).filter(([id]) => canWrite(f.type, id))
        .map(([id, field]) => ({ id, name: field.label, builtin: isBuiltin("field", id) })));
    let specs = $derived(functionParameters(f));
    let mainParameters = $derived(specs.filter(p => !p.advanced && !p.key.includes("*") && (p.type !== "geometry" || p.default !== "empty")));
    let advancedParameters = $derived(specs.filter(p => p.advanced));
    function memberParameters(group: "ridges" | "peaks", i: number) {
        return specs.filter(p => p.key[0] === group && p.type !== "geometry" && p.key.slice(2).every(part => part !== "*") && p.key.at(-1) !== "h")
            .map(p => [group, i, ...p.key.slice(2)]);
    }
    let vertex = $derived.by(() => {
        editor.revision;
        return editor.map.vertex;
    });
    let pathNode = $derived(vertex?.role === "vertex" ? geometryPath(n, vertex.path)?.nodes[vertex.index] : undefined);
    function removeMember(group: "ridges" | "peaks", index: number) {
        editor.edit(d => {
            removeGeometryItem(d, geoAt(d, n.id), [group], index);
        }, () => {
            editor.removeSubitem(n.id, group, index);
            editor.map.geometry = undefined; editor.map.vertex = undefined;
        });
    }
    function nameOf(id: string) {
        return geoAt(d, id)?.label ?? id;
    }
    function stripSummary(construction: Strip) {
        const names = construction.of.map(id => "“" + nameOf(id) + "”");
        const edge = names.length === 2 ? names.join("和") + "的公共边" : names[0] + "的轮廓";
        const range = construction.range;
        return range ? edge + "，从 " + range.from + " 到 " + range.to : edge;
    }
</script>
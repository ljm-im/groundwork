{#snippet param(address: Address)}
    <Parameter {editor} node={n} {address} />
{/snippet}
{#snippet geometry(label: string, kind: GeometryTarget["kind"], index: number, icon: "point" | "curve" | "closedPath", count: number, heightAt?: Address, redraw?: DrawTool, member?: number)}
    {@const active = editor.geometry?.kind === kind && editor.geometry.index === index}
    <GeometryInput {label} {icon} {count} {active} onclick={() => editor.focusGeometry({ kind, index })}
        redraw={redraw ? () => editor.setTool(redraw, n.id, member) : undefined}
        redrawing={redraw && editor.toolActive(redraw, n.id, member)} />
    {#if heightAt && active && vertex?.role === "parameter" && vertex.path === index}
        {@render param([...heightAt, "h"])}
    {/if}
{/snippet}
{#snippet curveInput(label: string, curve: Curve, path: number, redraw: DrawTool, member?: number)}
    {@render geometry(label, "path", path, curve.closed ? "closedPath" : "curve", curve.nodes.length, undefined, redraw, member)}
    <CheckboxRow label="闭合" checked={curve.closed} disabled={curve.nodes.length < 3}
        change={closed => editor.setCurveClosed(n.id, path, closed)} />
{/snippet}
{#snippet selectedNode(curve: Curve, path: number, address?: Address)}
    {#if vertex?.role === "vertex" && vertex.path === path && curve.nodes[vertex.index]}
        {@const control = vertex}
        {@const index = control.index}
        <Subitem label={"节点 " + (index + 1)} inset curveNode={curve.nodes[index].id}>
            {#snippet actions()}
                <button class="icon-button" aria-label="上一个节点" data-tip="上一个节点" disabled={neighbor(curve, index, -1) === undefined}
                    onclick={() => editor.stepVertex(-1)}><Icon name="chevronLeft" /></button>
                <button class="icon-button" aria-label="下一个节点" data-tip="下一个节点" disabled={neighbor(curve, index, 1) === undefined}
                    onclick={() => editor.stepVertex(1)}><Icon name="chevronRight" /></button>
                {#if canRemoveNode(curve)}
                    <button class="icon-button danger" aria-label="删除节点" data-tip="删除节点" onclick={() => editor.removeGeo(n.id, control)}><Icon name="delete" /></button>
                {/if}
            {/snippet}
            {#if address}{@render param([...address, "nodes", index, "h"])}{/if}
            <NodeProperties {editor} {curve} {control} />
        </Subitem>
    {/if}
{/snippet}
{#snippet memberActions(group: "ridges" | "peaks", label: string, index: number)}
    <button class="icon-button" aria-label={"复制" + label} data-tip={"复制" + label} onclick={() => editor.changeMember(n.id, group, index, true)}><Icon name="copy" /></button>
    <button class="icon-button danger" aria-label={"删除" + label} data-tip={"删除" + label} onclick={() => editor.changeMember(n.id, group, index, false)}><Icon name="delete" /></button>
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
            {#if c.type === "free"}
                <Part title="边界">
                    {#snippet actions()}<AddButton label="添加边界" active={editor.toolActive("addPath", n.id)} action={() => editor.setTool("addPath", n.id)} />{/snippet}
                    {#each c.paths as path, i (editor.subitemKey(n.id, "paths", i))}
                        <Subitem label={"边界 " + (i + 1)} open={editor.subitemOpen(n.id, "paths", i)} onclick={() => editor.toggleSubitem(n.id, "paths", i)}>
                            {#snippet actions()}
                                {#if c.type === "free" && c.paths.length > 1}
                                    <button class="icon-button danger" aria-label="删除边界" data-tip="删除边界" onclick={() => editor.removePath(n.id, i)}><Icon name="delete" /></button>
                                {/if}
                            {/snippet}
                            {@render geometry("边界线", "path", i, "closedPath", path.nodes.length)}
                            {@render selectedNode(path, i)}
                        </Subitem>
                    {/each}
                </Part>
            {:else if c.type === "strip"}
                <Part>
                    <GeometryInput label="边" icon="curve" summary={stripSummary(c)} active={editor.toolActive("strip", n.id)}
                        onclick={() => editor.setTool("strip", n.id)} />
                    {#each [0, 1] as i (i)}
                        <Parameter {editor} node={n} address={["widths", i]} construction />
                    {/each}
                </Part>
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
                        {@render selectedNode(f.shore, -1)}
                    {:else if f.type === "coast"}
                        {@render geometry(p.label, "parameter", 0, "point", 1, undefined, "harbor")}
                    {:else if f.type === "slope" && f.kind === "path"}
                        {@render geometry(p.label, "path", -1, f.line.closed ? "closedPath" : "curve", f.line.nodes.length, undefined, "slopeLine")}
                        {@render selectedNode(f.line, -1, ["line"])}
                        <CheckboxRow label="闭合" checked={f.line.closed} disabled={f.line.nodes.length < 3}
                            change={closed => editor.setCurveClosed(n.id, -1, closed)} />
                        {#each functionTable.slope.toggles ?? [] as toggle (toggle.label)}
                            <CheckboxRow label={toggle.label} checked={Boolean(readAt(f, toggle.key) ?? toggle.default)}
                                change={value => editor.editNode(n.id, item => writeAt(item.function, toggle.key, value))} />
                        {/each}
                    {:else if f.type === "slope"}
                        {@render geometry(p.label, "parameter", 0, "point", 1, undefined, "center")}
                    {/if}
                {/each}
            </Part>
            {#if advancedParameters.length}
                <Part>
                    <Subitem label="高级" open={editor.subitemOpen(n.id, "advanced")} onclick={() => editor.toggleSubitem(n.id, "advanced")}>
                        {#each advancedParameters as p (p.key.join("."))}{@render param(p.key)}{/each}
                    </Subitem>
                </Part>
            {:else if f.type === "mountain"}
                <Part title="山脊">
                    {#snippet actions()}<AddButton label="添加山脊" active={editor.toolActive("ridge", n.id)} action={() => editor.setTool("ridge", n.id)} />{/snippet}
                    {#each f.ridges as ridge, j (editor.subitemKey(n.id, "ridges", j))}
                        <Subitem label={"山脊 " + (j + 1)} open={editor.subitemOpen(n.id, "ridges", j)} onclick={() => editor.toggleSubitem(n.id, "ridges", j)}>
                            {#snippet actions()}{@render memberActions("ridges", "山脊 " + (j + 1), j)}{/snippet}
                            {@render curveInput(geoParameter(n, ["function", "ridges", j, "line"])!.label, ridge.line, -1 - j, "ridge", j)}
                            {#each memberParameters("ridges", j) as key (key.join("."))}
                                {@render param(key)}
                            {/each}
                            {@render selectedNode(ridge.line, -1 - j, ["ridges", j, "line"])}
                        </Subitem>
                    {/each}
                </Part>
                <Part title="山峰">
                    {#snippet actions()}<AddButton label="添加山峰" active={editor.toolActive("peak", n.id)} action={() => editor.setTool("peak", n.id)} />{/snippet}
                    {#each f.peaks.keys() as j (editor.subitemKey(n.id, "peaks", j))}
                        <Subitem label={"山峰 " + (j + 1)} open={editor.subitemOpen(n.id, "peaks", j)} onclick={() => editor.toggleSubitem(n.id, "peaks", j)}>
                            {#snippet actions()}{@render memberActions("peaks", "山峰 " + (j + 1), j)}{/snippet}
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
    import { canRemoveNode } from "../../core/edit/paths.ts";
    import { neighbor } from "../../core/design/path.ts";
    import { type Curve, type GeoFunction, type Strip } from "../../core/design/v5.ts";
    import { declarationEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { canWrite, functionParameters, functionTable, isBuiltinFunction } from "../../core/design/functionTable.ts";
    import { geoAt } from "../state/geoTools.ts";
    import { type DrawTool } from "../../core/edit/types.ts";
    import { geoParameter, readAt, writeAt, type Address } from "../../core/design/parameters.ts";
    import { type GeometryTarget } from "../../core/edit/geoControls.ts";
    import Icon from "./Icon.svelte";
    import AddButton from "./AddButton.svelte";
    import CheckboxRow from "./CheckboxRow.svelte";
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
    let vertex = $derived(editor.vertex);
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
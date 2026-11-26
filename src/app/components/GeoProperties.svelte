{#snippet param(address: Address)}
    <Parameter {editor} node={n} {address} />
{/snippet}
{#snippet geometry(label: string, index: number, redraw: DrawTool, member?: number)}
    {@const active = editor.geometry?.kind === "parameter" && editor.geometry.index === index}
    <GeometryInput {label} {active} onclick={() => editor.focusGeometry({ kind: "parameter", index })}
        onmouseenter={() => hover("parameter", index)} onmouseleave={clearHover}
        redraw={() => editor.setTool(redraw, n.id, member)} redrawing={editor.toolActive(redraw, n.id, member)} />
{/snippet}
{#snippet curveInput(label: string, curve: Curve, index: number, heightAt?: Address)}
    {@const kind = index < 0 ? "curve" : "outline"}
    {@const slot = geometrySlot(d, n.id, index)!}
    {@const referenced = heightAt && isCurveRef(editor.curves.value(slot))}
    <GeometryInput {label} icon={curve.closed ? "closedPath" : "curve"} count={curve.nodes.length}
        active={editor.geometry?.kind === kind && editor.geometry.index === index}
        onclick={() => editor.focusGeometry({ kind, index })} onmouseenter={() => hover(kind, index)} onmouseleave={clearHover}
        redraw={() => editor.drawCurve(slot.key)} redrawing={editor.curveToolActive(slot.key)}
        reference={{ editor, slot, name: index >= 0 ? slot.holder?.label : label }} />
    {#if heightAt}
        <CheckboxRow label="闭合" checked={curve.closed} disabled={curve.nodes.length < 3}
            change={closed => editor.setCurveClosed(n.id, index, closed)} />
    {/if}
    <SelectedCurvePart {editor} {curve} path={index}>
        {#snippet height(i, id)}
            {#if heightAt}{@render param([...heightAt, ...(referenced ? ["h", id] : ["nodes", i, "h"])])}{/if}
        {/snippet}
    </SelectedCurvePart>
{/snippet}
{#snippet memberActions(group: "ridges" | "peaks", index: number)}
    {@const name = group === "ridges" ? "山脊" : "山峰"}
    {@const copy = "复制" + name}
    {@const remove = "删除" + name}
    <button class="icon-button" aria-label={copy} data-tip={copy} onclick={() => editor.changeMember(n.id, group, index, true)}><Icon name="copy" /></button>
    <button class="icon-button danger" aria-label={remove} data-tip={remove} onclick={() => editor.changeMember(n.id, group, index, false)}><Icon name="delete" /></button>
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
            {#if c.type === "outline"}
                <Part title="区域">
                    {#snippet actions()}<AddButton label="添加轮廓" active={editor.toolActive("addOutline", n.id)} action={() => editor.setTool("addOutline", n.id)} />{/snippet}
                    {#each c.outlines.keys() as i (editor.subitemKey(n.id, "outlines", i))}
                        {@const outline = geometryPath(resolved, i)!}
                        <Subitem label={"轮廓 " + (i + 1)} open={editor.subitemOpen(n.id, "outlines", i)} onclick={() => editor.toggleSubitem(n.id, "outlines", i)}
                            outline={outline.nodes[0].id} selected={editor.outline === i} onmouseenter={() => hover("outline", i)} onmouseleave={clearHover}>
                            {#snippet actions()}
                                <button class="icon-button" aria-label="复制轮廓" data-tip="复制轮廓" onclick={() => editor.changeMember(n.id, "outlines", i, true)}><Icon name="copy" /></button>
                                {#if c.type === "outline" && c.outlines.length > 1}
                                    <button class="icon-button danger" aria-label="删除轮廓" data-tip="删除轮廓" onclick={() => editor.removeOutline(n.id, i)}><Icon name="delete" /></button>
                                {/if}
                            {/snippet}
                            {@render curveInput("曲线", outline, i)}
                        </Subitem>
                    {/each}
                </Part>
            {:else if c.type === "strip"}
                <Part title="区域">
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
                        {@render curveInput(p.label, geometryPath(resolved, -1)!, -1)}
                    {:else if f.type === "coast"}
                        {@render geometry(p.label, 0, "harbor")}
                    {:else if f.type === "slope" && f.kind === "path"}
                        {@render curveInput(p.label, geometryPath(resolved, -1)!, -1, ["line", "curve"])}
                        {#each functionTable.slope.toggles ?? [] as toggle (toggle.label)}
                            <CheckboxRow label={toggle.label} checked={Boolean(readAt(f, toggle.key) ?? toggle.default)}
                                change={value => editor.editNode(n.id, item => writeAt(item.function, toggle.key, value))} />
                        {/each}
                    {:else if f.type === "slope"}
                        {@render geometry(p.label, 0, "center")}
                    {/if}
                {/each}
            </Part>
            {#if advancedParameters.length}
                <Part>
                    <Subitem label="高级" open={editor.subitemOpen(n.id, "advanced")} onclick={() => editor.toggleSubitem(n.id, "advanced")}>
                        {#each advancedParameters as p (p.key.join("."))}{@render param(p.key)}{/each}
                    </Subitem>
                </Part>
            {/if}
            {#if f.type === "mountain"}
                <Part title="山脊">
                    {#snippet actions()}<AddButton label="添加山脊" active={editor.toolActive("ridge", n.id)} action={() => editor.setTool("ridge", n.id)} />{/snippet}
                    {#each f.ridges.keys() as j (editor.subitemKey(n.id, "ridges", j))}
                        <Subitem label={"山脊 " + (j + 1)} open={editor.subitemOpen(n.id, "ridges", j)} onclick={() => editor.toggleSubitem(n.id, "ridges", j)}
                            onmouseenter={() => hover("curve", -1 - j)} onmouseleave={clearHover}>
                            {#snippet actions()}{@render memberActions("ridges", j)}{/snippet}
                            {@render curveInput(geoParameter(n, ["function", "ridges", j, "curve"])!.label, geometryPath(resolved, -1 - j)!, -1 - j, ["ridges", j, "curve"])}
                            {#each memberParameters("ridges", j) as key (key.join("."))}
                                {@render param(key)}
                            {/each}
                        </Subitem>
                    {/each}
                </Part>
                <Part title="山峰">
                    {#snippet actions()}<AddButton label="添加山峰" active={editor.toolActive("peak", n.id)} action={() => editor.setTool("peak", n.id)} />{/snippet}
                    {#each f.peaks.keys() as j (editor.subitemKey(n.id, "peaks", j))}
                        <Subitem label={"山峰 " + (j + 1)} open={editor.subitemOpen(n.id, "peaks", j)} onclick={() => editor.toggleSubitem(n.id, "peaks", j)}
                            onmouseenter={() => hover("parameter", f.ridges.length + j)} onmouseleave={clearHover}>
                            {#snippet actions()}{@render memberActions("peaks", j)}{/snippet}
                            {@render geometry(geoParameter(n, ["function", "peaks", j, "at"])!.label, f.ridges.length + j, "peak", j)}
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
    import { geometrySlot, isCurveRef } from "../../core/design/curveReferences.ts";
    import { type Curve, type GeoFunction, type Strip } from "../../core/design/v5.ts";
    import { declarationEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { canWrite, functionParameters, functionTable, isBuiltinFunction } from "../../core/design/functionTable.ts";
    import { geoAt } from "../state/geoTools.ts";
    import { type DrawTool } from "../../core/edit/types.ts";
    import { geoParameter, readAt, writeAt, type Address } from "../../core/design/parameters.ts";
    import { geometryPath, type GeoControl } from "../../core/edit/geoControls.ts";
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
    import SelectedCurvePart from "./SelectedCurvePart.svelte";
    import Subitem from "./Subitem.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.project.design), n = $derived(geoAt(d, editor.selection!.id));
    let resolved = $derived(geoAt(editor.project.resolved, n.id));
    let c = $derived(n.construction), f = $derived(n.function);
    let fields = $derived(declarationEntries("field", d.fields).filter(([id]) => canWrite(f.type, id))
        .map(([id, field]) => ({ id, name: field.label, builtin: isBuiltin("field", id) })));
    let specs = $derived(functionParameters(f));
    let mainParameters = $derived(specs.filter(p => !p.advanced && !p.key.includes("*") && (p.type !== "geometry" || p.default !== "empty")));
    let advancedParameters = $derived(specs.filter(p => p.advanced));
    function memberParameters(group: "ridges" | "peaks", i: number) {
        return specs.filter(p => p.key[0] === group && p.type !== "geometry" && p.key.slice(2).every(part => part !== "*") && p.key.at(-1) !== "h")
            .map(p => [group, i, ...p.key.slice(2)]).filter(key => geoParameter(n, ["function", ...key]));
    }
    function hover(role: GeoControl["role"], path: number, index = 0) {
        editor.hoverSelection({ kind: "geoNode", id: n.id }, { role, path, index });
    }
    function clearHover() {
        editor.hoverSelection();
    }
    function nameOf(id: string) {
        return geoAt(d, id)?.label ?? id;
    }
    function stripSummary(construction: Strip) {
        const names = construction.of.map(id => "“" + nameOf(id) + "”");
        const edge = names.length === 2 ? names.join("和") + "的公共边" : names[0] + "的轮廓";
        const range = construction.range;
        return range ? edge + "，从“" + range.from + "”到“" + range.to + "”" : edge;
    }
</script>
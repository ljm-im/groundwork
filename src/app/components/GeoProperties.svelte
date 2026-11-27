{#snippet param(address: Address)}
    <Parameter {editor} node={n} {address} />
{/snippet}
{#snippet geometry(label: string, point: PointHolder, index: number, redraw: DrawTool, member?: number)}
    {@const active = editor.geometry?.kind === "parameter" && editor.geometry.index === index}
    <GeometryInput {label} {active} summary={d.geometry[point.point].label} onclick={() => editor.openPoint(point, { kind: "parameter", index })}
        onmouseenter={() => hover("parameter", index)} onmouseleave={clearHover}
        redraw={() => editor.setTool(redraw, n.id, member)} redrawing={editor.toolActive(redraw, n.id, member)} />
{/snippet}
{#snippet curveInput(label: string, curve: ProfileCurve, index: number, profile?: { group: ProfileGroup; index: number })}
    {@const kind = index < 0 ? "curve" : "outline"}
    {@const slot = geometrySlot(d, n.id, index)!}
    <GeometryInput {label}
        active={editor.geometry?.kind === kind && editor.geometry.index === index}
        onclick={() => editor.openCurve(slot)} onmouseenter={() => hover(kind, index)} onmouseleave={clearHover}
        redraw={() => editor.pickOrRedrawCurve(slot.key, label)} redrawing={editor.curveToolActive(slot.key)}
        reference={{ editor, slot, name: index >= 0 ? slot.holder?.label : label }} />
    {#if profile?.group === "lines"}
        {@const holder = editor.curves.holder(slot.holder!)}
        <CheckboxRow label={smoothIncrement.label} checked={holder.value.ease ?? smoothIncrement.default}
            change={ease => editor.setLineEase(slot.key, ease)} />
    {/if}
    {#if profile}
        <CheckboxRow label="闭合" checked={curve.closed} disabled={curve.nodes.length < 3}
            change={closed => editor.setCurveClosed(n.id, index, closed)} />
    {/if}
    <SelectedCurvePart {editor} {curve} path={index}>
        {#snippet values(i, id)}
            {#if profile}
                {@const quantities = nodeQuantities(profileGroups[profile.group].kind)}
                {#each quantities as quantity (quantity)}
                    {@const address = [profile.group, profile.index, ...nodeQuantityPath(id, quantity)]}
                    {@const label = quantity === "slope" ? "坡度" : profile.group === "lines" ? "增量" : "高度"}
                    {#if !needsNodeValue(curve, i)}
                        <CheckboxRow label={"覆盖" + label + "插值"} checked={!interpolates(curve.nodes[i], quantity)}
                            change={value => editor.setNodeOverride(slot.key, i, quantity, value)} />
                    {/if}
                    {@render param(address)}
                {/each}
            {/if}
        {/snippet}
    </SelectedCurvePart>
{/snippet}
{#snippet memberActions(group: FunctionMember, index: number)}
    {@const name = memberLabel(group)}
    {@const copy = "复制" + name}
    {@const remove = "删除" + name}
    <button class="icon-button" aria-label={copy} data-tip={copy} onclick={() => editor.changeMember(n.id, group, index, true)}><Icon name="copy" /></button>
    <button class="icon-button danger" aria-label={remove} data-tip={remove} onclick={() => editor.changeMember(n.id, group, index, false)}><Icon name="delete" /></button>
{/snippet}
{#snippet profileMembers(group: ProfileGroup, count: number)}
    {@const spec = profileGroups[group]}
    <Part title={spec.label}>
        {#snippet actions()}<AddButton label={"添加" + spec.label} active={editor.toolActive(spec.tool, n.id)} action={() => editor.setTool(spec.tool, n.id)} />{/snippet}
        {#each Array(count).keys() as j (editor.subitemKey(n.id, group, j))}
            {@const path = profileIndex(f, group, j)}
            <Subitem label={spec.label + " " + (j + 1)} open={editor.subitemOpen(n.id, group, j)} onclick={() => editor.toggleSubitem(n.id, group, j)}
                onmouseenter={() => hover("curve", path)} onmouseleave={clearHover} reference={{ editor, slot: geometrySlot(d, n.id, path)! }}>
                {#snippet actions()}{@render memberActions(group, j)}{/snippet}
                {@render curveInput(spec.curve, geometryPath(resolved, path)!, path, { group, index: j })}
            </Subitem>
        {/each}
    </Part>
{/snippet}
<PropertyPane {editor}>
    {#snippet title()}
        <PropertyTitle name={n.label} category="地件" icon="terrain" rename={name => editor.editNode(n.id, item => item.label = name)} disabled={!!n.disabled}
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
                            outline={outline.nodes[0].id} selected={editor.outline === i} onmouseenter={() => hover("outline", i)} onmouseleave={clearHover}
                            reference={{ editor, slot: geometrySlot(d, n.id, i)! }}>
                            {#snippet actions()}
                                {#if c.outlines.length > 1}
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
                    options={allowedFunctions(n).map(id => ({ id, name: functionTable[id].name, builtin: isBuiltinFunction(id) }))}
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
                        {@render geometry(p.label, f.harbor.center, 0, "harbor")}
                    {:else if f.type === "slope"}
                        {@render geometry(p.label, f.center, 0, "center")}
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
                {@render profileMembers("ridges", f.ridges.length)}
                {@render profileMembers("valleys", f.valleys.length)}
                <Part title="山峰">
                    {#snippet actions()}<AddButton label="添加山峰" active={editor.toolActive("peak", n.id)} action={() => editor.setTool("peak", n.id)} />{/snippet}
                    {#each f.peaks.keys() as j (editor.subitemKey(n.id, "peaks", j))}
                        <Subitem label={"山峰 " + (j + 1)} open={editor.subitemOpen(n.id, "peaks", j)} onclick={() => editor.toggleSubitem(n.id, "peaks", j)}
                            onmouseenter={() => hover("parameter", f.ridges.length + j)} onmouseleave={clearHover}>
                            {#snippet actions()}{@render memberActions("peaks", j)}{/snippet}
                            {@render geometry(geoParameter(n, ["function", "peaks", j, "at"])!.label, f.peaks[j].at, f.ridges.length + j, "peak", j)}
                            {#each memberParameters("peaks", j) as key (key.join("."))}
                                {@render param(key)}
                            {/each}
                        </Subitem>
                    {/each}
                </Part>
            {:else if f.type === "slope" && f.kind === "path"}
                {@render profileMembers("lines", f.lines.length)}
            {/if}
        {:else}<ObjectProblems {editor} />{/if}
    {/snippet}
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { allowedFunctions } from "../../core/edit/geoNodes.ts";
    import { geometrySlot, memberLabel, nodeQuantities, nodeQuantityPath, profileGroups, profileIndex, type FunctionMember, type ProfileGroup } from "../../core/design/curveReferences.ts";
    import { type PointHolder, type ProfileCurve, type GeoFunction, type Strip } from "../../core/design/v5.ts";
    import { declarationEntries, isBuiltin } from "../../core/design/defaults.ts";
    import { canWrite, functionParameters, functionTable, isBuiltinFunction, smoothIncrement } from "../../core/design/functionTable.ts";
    import { geoAt } from "../state/geoTools.ts";
    import { type DrawTool } from "../../core/edit/types.ts";
    import { geoParameter, type Address } from "../../core/design/parameters.ts";
    import { interpolates, needsNodeValue } from "../../core/design/polyline.ts";
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
    function memberParameters(group: "peaks", i: number) {
        return specs.flatMap(p => p.key[0] === group && p.type !== "geometry" ? [[group, i, ...p.key.slice(2)]] : []);
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
{#snippet param(address: Address, label: string, unit = "", field = false)}
    <Parameter {editor} node={n} {address} {label} {unit} {field} />
{/snippet}
{#snippet geometry(label: string, kind: GeometryTarget["kind"], index: number, icon: "point" | "polyline" | "closedPath", count: number, heightAt?: Address, redraw?: DrawTool, member?: number)}
    {@const active = editor.map.geometry?.kind === kind && editor.map.geometry.index === index}
    <GeometryInput {label} {icon} {count} {active} onclick={() => editor.focusGeometry({ kind, index })}
        redraw={redraw ? () => editor.setTool(redraw, n.id, member) : undefined} />
    {#if heightAt && active && vertex?.role === "parameter" && vertex.path === index && vertex.index < count}
        {@render param(icon === "point" ? [...heightAt, "h"] : [...heightAt, vertex.index, "h"],
            (icon === "point" ? "" : "顶点 " + (vertex.index + 1) + " ") + (n.function.type === "slope" ? "增量" : "高度"), height ? "m" : "")}
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
                        <Parameter {editor} node={n} address={["widths", i]} label={c.of.length === 1 ? ["向内", "向外"][i] : nameOf(c.of[i]!) + "一侧"} unit="m" construction />
                    {/each}
                {/if}
            </Part>
            {#if vertex?.role === "vertex" && vertex.path >= 0 && pathNode}
                <NodeProperties {editor} node={pathNode} control={vertex} />
            {/if}
        {:else if tab === "function"}
            <Part>
                <PropertySelect label="函数" group="内置函数" icon="function" value={f.type} options={allowedFunctions(n).map(id => ({ id, name: id, builtin: true }))}
                    choose={id => editor.switchFunction(n, id as GeoFunction["type"])} />
                <PropertySelect label="输出到" group="场" icon="field" value={n.field ?? "height"} options={[{ id: "height", name: "高度", builtin: true },
                    ...(fieldFunctions.includes(f.type) ? Object.entries(d.fields).map(([id, field]) => ({ id, name: field.label ?? id })) : [])]}
                    choose={id => editor.editNode(n.id, v => v.field = id)} />
                {#if f.type === "flat"}{@render param(["amount"], "增量", height ? "m" : "")}
                {:else if f.type === "ground"}{@render param(["value"], "数值", "m")}
                {:else if f.type === "coast"}
                    {@render geometry("海岸线", "path", -1, "closedPath", f.shore.nodes.length, undefined, "shore")}
                    {@render param(["roughness"], "海岸粗糙度", "m", true)}
                    {@render geometry("港湾圆心", "parameter", 0, "point", 1, undefined, "harbor")}
                    {@render param(["harbor", "radius"], "港湾半径", "m")}
                    {@render param(["harbor", "span"], "过渡宽度", "m")}
                {:else if f.type === "mountain"}
                    {@render param(["floor"], "作用下限", "m")}
                {:else if f.type === "cliff"}
                    {@render param(["factor"], "悬崖系数", "", true)}{@render param(["seaLevel"], "海平面", "m")}
                {:else if f.type === "erosion"}
                    {@render param(["strength"], "侵蚀强度", "", true)}{@render param(["floor"], "作用下限", "m")}
                    {@render param(["radius"], "笔刷半径", "m")}
                {:else if f.type === "islets"}
                    {@render param(["density"], "礁石密度", "", true)}{@render param(["reach"], "离岸距离", "m")}
                    {@render param(["threshold"], "密度阈值")}{@render param(["seaLevel"], "海平面", "m")}
                {:else if f.type === "slope"}
                    <PropertySelect label="坡面形式" value={f.kind} options={[{ id: "path", name: "沿路径" }, { id: "radial", name: "径向" }]}
                        choose={kind => {
                            editor.setTool(kind === "radial" ? "center" : "slopeLine", n.id); editor.revision++;
                        }} />
                    {#if f.kind === "path"}
                        {@render geometry("坡线", "parameter", 0, "polyline", f.line.points.length, ["line", "points"], "slopeLine")}
                        {#each [["smooth", "平滑折线"], ["ease", "平滑增量过渡"]] as [key, label] (key)}
                            <label class="toggle"><input type="checkbox" checked={key === "ease" ? !!f.ease : !!f.line.smooth} onchange={e => {
                                const value = e.currentTarget.checked;
                                editor.editNode(n.id, item => {
                                    if (item.function.type === "slope" && item.function.kind === "path") {
                                        if (key === "ease") item.function.ease = value;
                                        else item.function.line.smooth = value;
                                    }
                                });
                            }} />{label}</label>
                        {/each}
                    {:else}
                        {@render geometry("圆心", "parameter", 0, "point", 1, undefined, "center")}
                        {@render param(["radius"], "半径", "m")}{@render param(["value"], "增量", height ? "m" : "")}{@render param(["rate"], "径向变化率", height ? "m/m" : "")}
                    {/if}
                {:else if f.type === "add"}{@render param(["amount"], "增量", height ? "m" : "")}{@render param(["feather"], "羽化宽度", "m")}
                {:else if f.type === "noise"}
                    {@render param(["amplitude"], "振幅", height ? "m" : "", true)}{@render param(["scale"], "噪声尺度", "m")}
                    {@render param(["octaves"], "倍频数")}{@render param(["feather"], "羽化宽度", "m")}
                {:else if f.type === "batter"}{@render param(["grade"], "放坡坡度", "m/m")}{/if}
                {#if ["coast", "mountain", "cliff", "islets", "erosion", "noise"].includes(f.type)}{@render param(["seed"], "种子")}{/if}
            </Part>
            {#if f.type === "erosion"}
                <Part>
                    <Subitem label="高级" open={editor.subitemOpen(n.id, "advanced", 0)} onclick={() => editor.toggleSubitem(n.id, "advanced", 0)}>
                        {#each advancedErosion as [key, label, unit] (key)}{@render param([key], label, unit)}{/each}
                    </Subitem>
                </Part>
            {:else if f.type === "mountain"}
                <Part title="山脊">
                    {#snippet actions()}{@render action("添加山脊", "plus", () => editor.setTool("ridge", n.id))}{/snippet}
                    {#each f.ridges as ridge, j (j)}
                        <Subitem label={"山脊 " + (j + 1)} open={editor.subitemOpen(n.id, "ridges", j)} onclick={() => editor.toggleSubitem(n.id, "ridges", j)}>
                            {#snippet actions()}{@render action("删除山脊 " + (j + 1), "delete", () => removeMember("ridges", j))}{/snippet}
                            {@render geometry("山脊线", "parameter", j, "polyline", ridge.line.points.length, ["ridges", j, "line", "points"], "ridge", j)}
                            <label class="toggle"><input type="checkbox" checked={!!ridge.line.smooth} onchange={e => {
                                const smooth = e.currentTarget.checked;
                                editor.editNode(n.id, item => {
                                    if (item.function.type === "mountain") item.function.ridges[j].line.smooth = smooth;
                                });
                            }} />平滑折线</label>
                            {@render param(["ridges", j, "widths", 0], "左侧宽度", "m")}{@render param(["ridges", j, "widths", 1], "右侧宽度", "m")}
                            {#each ["widthNoise", "heightNoise"] as key (key)}
                                {@const name = key === "widthNoise" ? "宽度起伏" : "高度起伏"}
                                {@render param(["ridges", j, key, "amount"], name + "幅度", "%")}
                                {@render param(["ridges", j, key, "wavelength"], name + "波长", "m")}
                            {/each}
                        </Subitem>
                    {/each}
                </Part>
                <Part title="山峰">
                    {#snippet actions()}{@render action("添加山峰", "plus", () => editor.setTool("peak", n.id))}{/snippet}
                    {#each f.peaks.keys() as j (j)}
                        <Subitem label={"山峰 " + (j + 1)} open={editor.subitemOpen(n.id, "peaks", j)} onclick={() => editor.toggleSubitem(n.id, "peaks", j)}>
                            {#snippet actions()}{@render action("删除山峰 " + (j + 1), "delete", () => removeMember("peaks", j))}{/snippet}
                            {@render geometry("位置", "parameter", f.ridges.length + j, "point", 1, ["peaks", j, "at"], "peak", j)}
                            {@render param(["peaks", j, "radius"], "半径", "m")}{@render param(["peaks", j, "noise"], "半径起伏", "m")}{@render param(["peaks", j, "scale"], "噪声尺度", "m")}
                        </Subitem>
                    {/each}
                </Part>
            {/if}
        {:else}<ObjectProblems {editor} />{/if}
    {/snippet}
</PropertyPane>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { allowedFunctions, fieldFunctions } from "../../core/edit/geoNodes.ts";
    import { type GeoFunction, type Strip } from "../../core/design/v5.ts";
    import { advancedErosion } from "../state/inspector.ts";
    import { geoAt, type DrawTool } from "../state/geoTools.ts";
    import { type Address } from "../../core/design/parameters.ts";
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
    let c = $derived(n.construction), f = $derived(n.function), height = $derived((n.field ?? "height") === "height");
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
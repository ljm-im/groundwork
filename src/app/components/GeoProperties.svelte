{#snippet param(address: Address, label: string, field = false)}
    <Parameter {editor} node={n} {address} {label} {field} />
{/snippet}
{#snippet geometry(label: string, kind: GeometryTarget["kind"], index: number, icon: "point" | "polyline" | "closedPath", count: number, heightAt?: Address, redraw?: DrawTool)}
    {@const active = editor.map.geometry?.kind === kind && editor.map.geometry.index === index}
    <div class="geometry">
        <GeometryInput {label} {icon} {count} {active} onclick={() => editor.focusGeometry({ kind, index })} />
        {#if redraw}<button class="small-icon" aria-label={"重画" + label} data-tip={"重画" + label} onclick={() => editor.setTool(redraw, n.id)}><Icon name="pen" /></button>{/if}
    </div>
    {#if heightAt && active && vertex?.role === "parameter" && vertex.path === index && vertex.index < count}
        <section class="vertex"><h5>顶点 {vertex.index + 1}</h5>
            {@render param(icon === "point" ? [...heightAt, "h"] : [...heightAt, vertex.index, "h"], (n.function.type === "slope" ? "增量" : "高度") + (height ? " / m" : ""))}
        </section>
    {/if}
{/snippet}
{#snippet action(label: string, icon: "plus" | "delete", click: () => void)}
    <button class="small-icon" class:danger={icon === "delete"} aria-label={label} data-tip={label} onclick={click}><Icon name={icon} /></button>
{/snippet}
<PropertyTitle name={n.label} showLabel={n.showLabel ?? false} setLabelVisibility={visible => editor.editNode(n.id, item => item.showLabel = visible)} rename={name => editor.editNode(n.id, item => item.label = name)} disabled={!!n.disabled}
    toggle={() => editor.toggle(n.id)} copy={() => editor.duplicate(n.id)} remove={() => editor.removeGeo(n.id)} />
<Prompt {editor} target={{ group: "geoNodes", id: n.id }} />
{#if c.type === "free"}
    <Part title="区域">
        {#each c.paths as path, i (i)}{@render geometry(c.paths.length === 1 ? "边界" : "路径 " + (i + 1), "path", i, "closedPath", path.nodes.length)}{/each}
    </Part>
{/if}
{#if c.type === "strip"}
    <Part title="条带构造">
        <div class="geo-actions">沿 {#each c.of as id (id)}<button class="flat" onclick={() => editor.locateGeo(id)}>{nameOf(id)}</button>{/each}</div>
        {#each [0, 1] as i (i)}
            <Parameter {editor} node={n} address={["widths", i]} label={(c.of.length === 1 ? ["向内宽度", "向外宽度"][i] : "“" + nameOf(c.of[i]!) + "”侧宽度") + " / m"} construction />
        {/each}
        <div class="sub">{drawnRange(c)}</div><div class="geo-actions"><button onclick={() => editor.setTool("strip", n.id)}>重新点选</button>
            <button onclick={() => editor.editNode(n.id, v => {
                if (v.construction.type === "strip") delete v.construction.range;
            })}>取整圈</button></div>
    </Part>
{/if}
<Part title="函数">
    <PropertySelect label="函数" group="内置函数" icon="function" value={f.type} options={allowedFunctions(n).map(id => ({ id, name: id }))}
        newLabel="新建函数" choose={id => editor.switchFunction(n, id as GeoFunction["type"])} create={() => editor.message("自定义函数还没有实现")} />
    <PropertySelect label="输出到" group="场" icon="field" value={n.field ?? "height"} options={[{ id: "height", name: "高度" },
        ...(fieldFunctions.includes(f.type) ? Object.entries(d.fields).map(([id, field]) => ({ id, name: field.label ?? id })) : [])]}
        newLabel="新建场" choose={id => editor.editNode(n.id, v => v.field = id)} create={() => editor.edit(d => {
            const id = addField(d); if (fieldFunctions.includes(f.type)) geoAt(d, n.id).field = id;
        })} />
    <h4 class="parameters-heading">参数</h4>
    {#if f.type === "flat"}{@render param(["amount"], "增量" + (height ? " / m" : ""))}
    {:else if f.type === "ground"}{@render param(["value"], "数值 / m")}
    {:else if f.type === "coast"}
        {@render geometry("海岸线", "path", -1, "closedPath", f.shore.nodes.length, undefined, "shore")}
        {@render param(["roughness"], "海岸粗糙度 / m", true)}
        {#if f.harbor}
            {@render geometry("港湾圆心", "parameter", 0, "point", 1)}
            {@render param(["harbor", "radius"], "港湾半径 / m")}{@render param(["harbor", "span"], "过渡宽度 / m")}
            <button onclick={() => editor.editNode(n.id, n => {
                if (n.function.type === "coast") delete n.function.harbor;
            })}>移除港湾</button>
        {:else}<button onclick={() => editor.editNode(n.id, v => {
            if (v.function.type === "coast") v.function.harbor = { center: editor.geoCenter(n.id), radius: 4, span: 3 };
        })}>添加港湾</button>{/if}
    {:else if f.type === "mountain"}
        {@render param(["floor"], "作用下限 / m")}
        <section class="mountain-group"><div class="group-head"><h4>山脊</h4>{@render action("添加山脊", "plus", () => editor.setTool("ridge", n.id))}</div>
            {#each f.ridges as ridge, j (j)}
                <section class="member"><div class="group-head"><h5>山脊 {j + 1}</h5>{@render action("删除山脊 " + (j + 1), "delete", () => removeMember("ridges", j))}</div>
                    {@render geometry("山脊线", "parameter", j, "polyline", ridge.line.points.length, ["ridges", j, "line", "points"])}
                    <label class="toggle">平滑折线<input type="checkbox" checked={!!ridge.line.smooth} onchange={e => {
                        const smooth = e.currentTarget.checked; editor.editNode(n.id, v => {
                            if (v.function.type === "mountain") v.function.ridges[j].line.smooth = smooth;
                        });
                    }} /></label>
                    {@render param(["ridges", j, "widths", 0], "左侧宽度 / m")}{@render param(["ridges", j, "widths", 1], "右侧宽度 / m")}
                    {#each ["widthNoise", "heightNoise"] as key (key)}
                        {@const name = key === "widthNoise" ? "宽度起伏" : "高度起伏"}
                        {@render param(["ridges", j, key, "amount"], name + "幅度 / %")}
                        {@render param(["ridges", j, key, "wavelength"], name + "波长 / m")}
                    {/each}
                </section>
            {/each}
        </section>
        <section class="mountain-group"><div class="group-head"><h4>山峰</h4>{@render action("添加山峰", "plus", () => editor.setTool("peak", n.id))}</div>
            {#each f.peaks.keys() as j (j)}
                <section class="member"><div class="group-head"><h5>山峰 {j + 1}</h5>{@render action("删除山峰 " + (j + 1), "delete", () => removeMember("peaks", j))}</div>
                    {@render geometry("位置", "parameter", f.ridges.length + j, "point", 1, ["peaks", j, "at"])}
                    {@render param(["peaks", j, "radius"], "半径 / m")}{@render param(["peaks", j, "noise"], "半径起伏 / m")}{@render param(["peaks", j, "scale"], "噪声尺度 / m")}
                </section>
            {/each}
        </section>
    {:else if f.type === "cliff"}
        {@render param(["factor"], "悬崖系数", true)}{@render param(["seaLevel"], "海平面 / m")}
    {:else if f.type === "erosion"}
        {@render param(["strength"], "侵蚀强度", true)}{@render param(["floor"], "作用下限 / m")}
        <details open={editor.erosionOpen} ontoggle={e => {
            if (e.currentTarget.isConnected) editor.erosionOpen = e.currentTarget.open;
        }}><summary>侵蚀参数</summary>
            {#each erosion as [key, label] (key)}{@render param([key], label)}{/each}
        </details>
    {:else if f.type === "islets"}
        {@render param(["density"], "礁石密度", true)}{@render param(["reach"], "离岸距离 / m")}
        {@render param(["threshold"], "密度阈值")}{@render param(["seaLevel"], "海平面 / m")}
    {:else if f.type === "slope"}
        <label class="field">坡面形式<select value={f.kind} onchange={e => {
            editor.setTool(e.currentTarget.value === "radial" ? "center" : "slopeLine", n.id); editor.revision++;
        }}>
            <option value="path">沿路径</option><option value="radial">径向</option></select></label>
        {#if f.kind === "path"}
            {@render geometry("坡线", "parameter", 0, "polyline", f.line.points.length, ["line", "points"], "slopeLine")}
            {#each [["smooth", "平滑折线"], ["ease", "平滑增量过渡"]] as [key, label] (key)}
                <label class="toggle">{label}<input type="checkbox" checked={key === "ease" ? !!f.ease : !!f.line.smooth} onchange={e => {
                    const value = e.currentTarget.checked; editor.editNode(n.id, v => {
                        if (v.function.type === "slope" && v.function.kind === "path") {
                            if (key === "ease") v.function.ease = value; else v.function.line.smooth = value;
                        }
                    });
                }} /></label>
            {/each}
        {:else}
            {@render geometry("圆心", "parameter", 0, "point", 1, undefined, "center")}
            {@render param(["radius"], "半径 / m")}{@render param(["value"], "增量" + (height ? " / m" : ""))}{@render param(["rate"], "径向变化率 / m")}
        {/if}
    {:else if f.type === "add"}{@render param(["amount"], "增量")}{@render param(["feather"], "羽化宽度 / m")}
    {:else if f.type === "noise"}
        {@render param(["amplitude"], "振幅", true)}{@render param(["scale"], "噪声尺度 / m")}
        {@render param(["octaves"], "倍频数")}{@render param(["feather"], "羽化宽度 / m")}
    {:else if f.type === "batter"}{@render param(["grade"], "放坡坡度 / m/m")}{/if}
    {#if ["coast", "mountain", "cliff", "islets", "erosion", "noise"].includes(f.type)}{@render param(["seed"], "种子")}{/if}
</Part>
<ObjectProblems {editor} />


<style>
    h4, h5 { margin: 0; font-size: 12px; }
    .parameters-heading { margin: 12px 0 6px; color: var(--muted); }
    .mountain-group { margin: 11px 0; }
    .group-head, .geometry { display: flex; align-items: center; gap: 4px; }
    .group-head { justify-content: space-between; }
    .member { margin: 4px 0 9px 3px; padding-left: 8px; border-left: 2px solid var(--line); }
    .member h5, .vertex h5 { font-weight: 550; color: var(--muted); }
    .small-icon { min-width: 25px; min-height: 25px; padding: 2px; border: 0; background: transparent; }
    .vertex { margin: 4px 0; padding-left: 8px; border-left: 2px solid var(--teal); }
    .geo-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin: 5px 0; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { allowedFunctions, fieldFunctions, addField } from "../../core/edit/geoNodes.ts";
    import { type GeoFunction } from "../../core/design/v5.ts";
    import { drawnRange, geoAt, type DrawTool } from "../state/geoTools.ts";
    import { type Address } from "../../core/design/parameters.ts";
    import { removeGeometryItem, type GeometryTarget } from "../../core/edit/geoControls.ts";
    import Icon from "./Icon.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import PropertySelect from "./PropertySelect.svelte";
    import Parameter from "./Parameter.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design), n = $derived(geoAt(d, editor.selection!.id)), c = $derived(n.construction), f = $derived(n.function);
    let height = $derived((n.field ?? "height") === "height");
    let vertex = $derived(editor.map.vertex);
    function removeMember(group: "ridges" | "peaks", index: number) {
        editor.edit(d => {
            removeGeometryItem(d, geoAt(d, n.id), [group], index);
        }, () => {
            editor.map.geometry = undefined; editor.map.vertex = undefined;
        });
    }
    function nameOf(id: string) {
        return geoAt(d, id)?.label ?? id;
    }
    const erosion = [["droplets", "水滴数"], ["inertia", "惯性"], ["capacity", "携沙能力"], ["minCapacity", "最小携沙量"], ["deposition", "沉积率"],
        ["erosion", "侵蚀率"], ["evaporation", "蒸发率"], ["gravity", "重力"], ["lifetime", "寿命 / 步"], ["radius", "笔刷半径 / 格"]];
</script>
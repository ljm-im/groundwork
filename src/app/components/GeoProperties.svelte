{#snippet param(address: (string | number)[], label: string, kind: "height" | "field" | "number" = "number", optional = false)}
    <Parameter {editor} node={n} {address} {label} field={kind === "field"} {optional} />
{/snippet}
{#snippet draw(label: string, tool: DrawTool)}
    <button disabled={editor.tool === tool} onclick={() => editor.setTool(tool, n.id)}>{label}</button>
{/snippet}
{#snippet vertices(points: { p: Point; h?: Expression }[], root: (string | number)[], optional = false)}
    {#each points.keys() as i (i)}
        {@render param([...root, i, "p", 0], "顶点 " + (i + 1) + " X / m")}
        {@render param([...root, i, "p", 1], "顶点 " + (i + 1) + " Y / m")}
        {@render param([...root, i, "h"], "顶点 " + (i + 1) + " 高度 / m", "height", optional)}
    {/each}
{/snippet}
<PropertyTitle name={n.name} label="地件名称" rename={name => editor.editNode(n.id, item => item.name = name)} disabled={!!n.disabled}
    toggle={() => editor.toggle(n.id)} copy={() => editor.duplicate(n.id)} remove={() => editor.removeGeo(n.id)} />
<Prompt {editor} target={{ group: "geoNodes", id: n.id }} />
{#if c.type === "free" && editor.map?.vertex?.role === "vertex" && editor.map.vertex.path >= 0}
    {@const v = editor.map.vertex}
    <Part title={"路径节点 " + (v.index + 1)}>
        {#each ["X", "Y"] as axis, i (axis)}<Parameter {editor} node={n} construction address={["paths", v.path, "nodes", v.index, "p", i]} label={axis + " / m"} />{/each}
    </Part>
{/if}
{#if c.type === "strip"}
    <Part title="条带构造">
        <div class="geo-actions">沿 {#each c.of as id (id)}<button class="flat" onclick={() => editor.locateGeo(id)}>{nameOf(id)}</button>{/each}</div>
        {#each [0, 1] as i (i)}
            <Parameter {editor} node={n} address={["widths", i]} label={(c.of.length === 1 ? ["向内宽度", "向外宽度"][i] : "“" + nameOf(c.of[i]!) + "”侧宽度") + " / m"} construction />
        {/each}
        <div class="sub">{drawnRange(c)}</div><div class="geo-actions">{@render draw("重新点选", "strip")}
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
    {#if f.type === "flat" || f.type === "ground"}{@render param(["value"], "数值" + (height ? " / m" : ""), "height")}
    {:else if f.type === "coast"}
        {@render param(["roughness"], "海岸粗糙度 / m", "field")}{@render draw("画海岸线", "shore")}
        {#each f.shore.nodes as v, i (v.id)}
            {@render param(["shore", "nodes", i, "p", 0], "顶点 " + (i + 1) + " X / m")}{@render param(["shore", "nodes", i, "p", 1], "顶点 " + (i + 1) + " Y / m")}
        {/each}
        {#if f.harbor}
            {@render param(["harbor", "center", 0], "港湾 X / m")}{@render param(["harbor", "center", 1], "港湾 Y / m")}
            {@render param(["harbor", "radius"], "港湾半径 / m")}{@render param(["harbor", "span"], "过渡宽度 / m")}
            <button onclick={() => editor.editNode(n.id, n => {
                if (n.function.type === "coast") delete n.function.harbor;
            })}>移除港湾</button>
        {:else}<button onclick={() => editor.editNode(n.id, v => {
            if (v.function.type === "coast") v.function.harbor = { center: editor.geoCenter(n.id), radius: 4, span: 3 };
        })}>添加港湾</button>{/if}
    {:else if f.type === "mountain"}
        {@render param(["floor"], "作用下限 / m", "height", true)}
        <div class="geo-actions">{@render draw("添加山脊", "ridge")}{@render draw("添加山峰", "peak")}</div>
        {#each f.ridges as ridge, j (j)}
            <Part title={"山脊 " + (j + 1)}>
                {@render vertices(ridge.line.points, ["ridges", j, "line", "points"], true)}
                <label class="toggle">平滑折线<input type="checkbox" checked={!!ridge.line.smooth} onchange={e => {
                    const smooth = e.currentTarget.checked; editor.editNode(n.id, v => {
                        if (v.function.type === "mountain") v.function.ridges[j].line.smooth = smooth;
                    });
                }} /></label>
                {@render param(["ridges", j, "widths", 0], "左侧宽度 / m")}{@render param(["ridges", j, "widths", 1], "右侧宽度 / m")}
                {#each ["widthNoise", "heightNoise"] as key (key)}{#each ["振幅", "频率", "相位"] as label, k (label)}
                    {@render param(["ridges", j, key, k], (key === "widthNoise" ? "宽度" : "高度") + label)}
                {/each}{/each}
                <button class="danger" onclick={() => editor.editNode(n.id, v => {
                    editor.map.vertex = undefined;
                    if (v.function.type === "mountain") v.function.ridges.splice(j, 1);
                })}>删除山脊</button>
            </Part>
        {/each}
        {#each f.peaks.keys() as j (j)}
            <Part title={"山峰 " + (j + 1)}>
                {@render param(["peaks", j, "at", "p", 0], "峰顶 X / m")}{@render param(["peaks", j, "at", "p", 1], "峰顶 Y / m")}
                {@render param(["peaks", j, "at", "h"], "峰顶高度 / m", "height")}{@render param(["peaks", j, "radius"], "半径 / m")}
                {@render param(["peaks", j, "noise"], "半径起伏")}{@render param(["peaks", j, "scale"], "噪声尺度 / m")}
                <button class="danger" onclick={() => editor.editNode(n.id, v => {
                    editor.map.vertex = undefined;
                    if (v.function.type === "mountain") v.function.peaks.splice(j, 1);
                })}>删除山峰</button>
            </Part>
        {/each}
    {:else if f.type === "cliff"}
        {@render param(["factor"], "悬崖系数", "field")}{@render param(["seaLevel"], "海平面 / m", "height", true)}
    {:else if f.type === "erosion"}
        {@render param(["strength"], "侵蚀强度", "field")}{@render param(["floor"], "作用下限 / m", "height", true)}
        <details open={editor.erosionOpen} ontoggle={e => {
            if (e.currentTarget.isConnected) editor.erosionOpen = e.currentTarget.open;
        }}><summary>侵蚀参数</summary>
            {#each erosion as [key, label] (key)}{@render param([key], label)}{/each}
        </details>
    {:else if f.type === "islets"}
        {@render param(["density"], "礁石密度", "field")}{@render param(["reach"], "离岸距离 / m")}
        {@render param(["threshold"], "密度阈值", "number", true)}{@render param(["seaLevel"], "海平面 / m", "height", true)}
    {:else if f.type === "slope"}
        <label class="field">坡面形式<select value={f.kind} onchange={e => {
            editor.setTool(e.currentTarget.value === "radial" ? "center" : "slopeLine", n.id); editor.revision++;
        }}>
            <option value="path">沿路径</option><option value="radial">径向</option></select></label>
        {#if f.kind === "path"}
            {@render draw("画坡线", "slopeLine")}{@render vertices(f.line.points, ["line", "points"], true)}
            {#each [["smooth", "平滑折线"], ["ease", "平滑高度过渡"]] as [key, label] (key)}
                <label class="toggle">{label}<input type="checkbox" checked={key === "ease" ? !!f.ease : !!f.line.smooth} onchange={e => {
                    const value = e.currentTarget.checked; editor.editNode(n.id, v => {
                        if (v.function.type === "slope" && v.function.kind === "path") {
                            if (key === "ease") v.function.ease = value; else v.function.line.smooth = value;
                        }
                    });
                }} /></label>
            {/each}
        {:else}
            {@render draw("选圆心", "center")}{@render param(["center", 0], "圆心 X / m")}{@render param(["center", 1], "圆心 Y / m")}
            {@render param(["radius"], "半径 / m")}{@render param(["value"], "基准值", "height")}{@render param(["rate"], "径向变化率 / m")}
        {/if}
    {:else if f.type === "add"}{@render param(["amount"], "增量", "height")}{@render param(["feather"], "羽化宽度 / m")}
    {:else if f.type === "noise"}
        {@render param(["amplitude"], "振幅", "field")}{@render param(["scale"], "噪声尺度 / m")}
        {@render param(["octaves"], "倍频数", "number", true)}{@render param(["feather"], "羽化宽度 / m", "number", true)}
    {:else if f.type === "batter"}{@render param(["grade"], "放坡坡度 / m/m")}{/if}
    {#if ["coast", "mountain", "cliff", "islets", "erosion", "noise"].includes(f.type)}{@render param(["seed"], "种子", "number", true)}{/if}
</Part>
<ObjectProblems {editor} />


<style>
    .geo-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin: 5px 0; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { allowedFunctions, fieldFunctions, addField } from "../../core/edit/geoNodes.ts";
    import { type GeoFunction, type Expression, type Point } from "../../core/design/v5.ts";
    import { drawnRange, geoAt, type DrawTool } from "../state/geoTools.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import PropertySelect from "./PropertySelect.svelte";
    import Parameter from "./Parameter.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design), n = $derived(geoAt(d, editor.selection!.id)), c = $derived(n.construction), f = $derived(n.function);
    let height = $derived((n.field ?? "height") === "height");
    function nameOf(id: string) {
        return geoAt(d, id)?.name ?? id;
    }
    const erosion = [["droplets", "水滴数"], ["inertia", "惯性"], ["capacity", "携沙能力"], ["minCapacity", "最小携沙量"], ["deposition", "沉积率"],
        ["erosion", "侵蚀率"], ["evaporation", "蒸发率"], ["gravity", "重力"], ["lifetime", "寿命 / 步"], ["radius", "笔刷半径 / 格"]];
</script>
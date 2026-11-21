{#snippet roadRow(r: Route)}
    <button class="route-row" data-edge={r.id} onclick={() => editor.focus("edge", r.id)}>
        <span class={"road-symbol " + r.edge.grade}>{r.edge.grade === "stair" ? "≋" : r.edge.grade === "street" ? "═" : "∿"}</span><span>{r.edge.name}</span>
        {#if m.issues.some(i => (i.road === r.id || i.other === r.id) && i.severity === "error")}<i class="route-dot" aria-label="有校验问题"></i>{/if}
        <span class="length mono">{r.length.toFixed(1)} m</span><span class="chev">›</span>
    </button>
{/snippet}
{#snippet stat(label: string, value: string)}<div class="stat"><dt>{label}</dt><dd>{value}</dd></div>{/snippet}
{#snippet back()}<button class="back flat" data-action="back" onclick={() => editor.select(null)}>‹ 返回路网</button>{/snippet}
{#snippet mode(key: string, value: string, inherit = false)}
    <select data-mode={key} {value}>{#if inherit}<option value="">跟随整条边</option>{/if}{#each Object.entries(modes) as [k, label] (k)}<option value={k}>{label}</option>{/each}</select>
{/snippet}
{#if route && h}
    {@const e = route.edge}
    {@const cl = d.roadClasses[e.grade]}
    {@const via = h.kind === "via"}
    {@const index = h.index ?? 0}
    {@render back()}<h2>{e.name}</h2><div class="sub">{d.nodes.find(n => n.id === e.from)?.name} → {d.nodes.find(n => n.id === e.to)?.name}</div>
    <ObjectProblems {editor} />
    <dl class="stat-grid">
        {@render stat("路线长度", route.length.toFixed(1) + " m")}{@render stat("端点落差", route.drop.toFixed(1) + " m")}
        {@render stat("最陡坡度", pct(route.maxGrade))}{@render stat("绕路比", route.detour.toFixed(2))}
        {@render stat("台阶段数", route.stairRuns + " 段")}{@render stat("台阶总长", route.stairLength.toFixed(1) + " m")}
    </dl>
    <Part title="选线参数">
        <label class="field">名称<input class="wide" data-param="name" value={e.name} /></label>
        <label class="field">等级<select data-param="grade" value={e.grade}>{#each Object.entries(d.roadClasses) as [k, v] (k)}<option value={k}>{v.name}</option>{/each}</select></label>
        {#each [["路面宽度 / m", "width", e.width], ["舒适坡度 / %", "comfort", +(e.comfort * 100).toFixed(3)], ["最大坡度 / %", "maxGrade", +(e.maxGrade * 100).toFixed(3)], ["走廊半宽 / m", "corridor", e.corridor]] as [name, key, value] (key)}
            <label class="field">{name}<input type="number" data-param={key} {value} step=".1" min=".1" /></label>
        {/each}
    </Part>
    <div class="sub">等级校验 · {cl.rampLimit != null ? "坡道上限 " + pct(cl.rampLimit) + " · " : ""}{cl.allowStairs ? "台阶上限 " + pct(cl.stairLimit) : "仅设坡道"}</div>
    <Part title="路段">
        <label class="field">整条边默认模式{@render mode("edge", e.mode ?? "route")}</label>
        <label class="field">编辑路段<select data-part-index value={index}>{#each Array.from({ length: e.via.length + 1 }, (_, i) => i) as i (i)}<option value={i}>第 {i + 1} 段</option>{/each}</select></label>
        <label class="field">本段模式{@render mode("segment", e.segments?.[index]?.mode ?? "", true)}</label>
        <div class="field">实际模式<b>{modes[segmentMode(e, index)]}</b></div>
    </Part>
    {#if via}
        <label class="toggle">精确经过此点<input type="checkbox" data-exact-via checked={!!e.segments?.[index]?.exactEnd} /></label>
        <Part title={"途经点 " + (index + 1)}><div class="row-between"><span class="mono">{e.via[index].map(v => v.toFixed(1)).join(", ")} m</span><button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除途经点</button></div></Part>
    {:else}
        <div class="sub">途经点 {e.via.length} 个</div><div class="part"><button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除这条边</button></div>
    {/if}
{:else if node}
    {@const pose = nodePose(d, node) as { point: number[]; normal?: number }}
    {@const linked = m.routes.filter(r => r.edge.from === node.id || r.edge.to === node.id)}
    {@const area = d.yards?.find(y => y.id === node.yard)}
    {@render back()}<h2>{node.name}</h2><div class="sub">{nodeType(node)}</div><ObjectProblems {editor} />
    <dl class="stat-grid">{@render stat("东向 X", pose.point[0].toFixed(2) + " m")}{@render stat("北向 Y", pose.point[1].toFixed(2) + " m")}</dl>
    <Part title="节点属性">
        <label class="field">名称<input class="wide" data-node-param="name" value={node.name} /></label>
        {#if node.type === "gate" && area}
            <div class="field">所属区域<b>{area.name}</b></div><div class="field">沿边界位置<span class="mono">{(node.at! * 100).toFixed(1)}%</span></div>
            <div class="field">外法线<span class="mono">{(pose.normal! / radians).toFixed(1)}°</span></div>
            <div class="sub">{area.kind === "plaza" ? "拖动入口可沿广场边界滑动。" : "拖动院门可沿院墙滑动。打开台地图层可拖动院墙。"}</div>
        {:else if node.type === "door"}
            {@const b = d.buildings.find(b => b.id === node.building)!}
            <div class="field">所属建筑<b>{b.name}</b></div><div class="field">外法线<span class="mono">{(pose.normal! / radians).toFixed(1)}°</span></div><div class="sub">拖动门可沿建筑外墙移动。</div>
            {#if b.summit}
                {@const heights = summitHeights(m.terrain.grid, m.graded.heights, b.center)}
                <dl class="stat-grid">{@render stat("基座实测", heights.ground.toFixed(2) + " m")}{@render stat("25 m 内最高", heights.highest.toFixed(2) + " m")}</dl>
            {/if}
        {:else}
            <label class="field">类型<select data-node-param="type" value={node.type}>{#each ["junction", "endpoint", "viewpoint"] as key (key)}<option value={key}>{types[key]}</option>{/each}</select></label>
        {/if}
        <label class="field">手动朝向 / °<input type="number" step="any" placeholder="自动" data-node-param="direction" value={node.direction ?? ""} /></label>
        {#each throughPairs(node) as pair (pair)}
            {@const main = (pair as string[]).map(id => linked.find(r => r.id === id)!)}
            {@const arms = main.map(r => armBearing(r, node.id))}
            <div class="field">直通方向差<span class="mono">{(180 - angleDiff(arms[0], arms[1]) / radians).toFixed(1)}°</span></div>
            {#each linked.filter(r => !throughPairs(node).flat().includes(r.id)) as r (r.id)}
                <div class="field">{r.edge.name}夹角<span class="mono">{(Math.min(...arms.map(a => angleDiff(a, armBearing(r, node.id)))) / radians).toFixed(1)}°</span></div>
            {/each}
            <div class="sub">直通道路 · {main.map(r => r.edge.name).join(" / ")}</div>
        {/each}
    </Part>
    <Part title="相连的边" count={linked.length}>{#each linked as r (r.id)}{@render roadRow(r)}{/each}</Part>
    <div class="part"><button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>{node.type === "door" ? "删除门" : "删除节点"}</button><div class="sub">{node.type === "door" ? "相连道路保留在原门位。" : "相连的 " + linked.length + " 条边将一并移除，可撤销。"}</div></div>
{:else}
    {@const errors = m.issues.filter(i => i.severity === "error").length}
    <div class="row-between"><h2>路网总览</h2><button class="flat" data-action="reroute-all" onclick={() => editor.rerouteAll()}>重新选线</button></div>
    <div class="sub">{d.nodes.length} 个节点 · {d.edges.length} 条边</div>
    <Search id="search" label="查找道路或节点" bind:value={editor.filter} />
    <Part title="道路" count={routes.length}>{#each routes as r (r.id)}{@render roadRow(r)}{:else}<div class="sub">无匹配道路</div>{/each}</Part>
    <details open={!!q}><summary>节点（{nodes.length}）</summary>{#each nodes as n (n.id)}<button class="object-row" data-node={n.id} onclick={() => editor.focus("node", n.id)}>{n.name}<small>{nodeType(n)}</small></button>{/each}</details>
    <Part title="设计校验"><button class="object-row" data-action="issues" onclick={() => editor.changeTab("issues")}><i class="diamond"></i>{errors} 处问题 · {m.issues.length - errors} 处提示<small>查看 ›</small></button></Part>
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type RoadNode, type Route } from "../types.ts";
    import { nodePose, segmentMode, throughPairs } from "../../core/design/model.ts";
    import { angleDiff, radians } from "../../core/math/geometry.ts";
    import { armBearing, summitHeights } from "../../core/checks/validation.ts";
    import Part from "./Part.svelte";
    import Search from "./Search.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";

    let { editor }: { editor: session.Editor } = $props();
    const types: Record<string, string> = { door: "建筑门", gate: "院门", junction: "路口", endpoint: "端点", viewpoint: "观景点" };
    const modes: Record<string, string> = { route: "选线", smooth: "平滑", straight: "直线" };
    const pct = (v: number) => (v * 100).toFixed(1) + "%";
    let m = $derived(editor.island), d = $derived(m.design), h = $derived(editor.selection);
    let route = $derived(h && ["edge", "via"].includes(h.kind) && m.routes.find(r => r.id === h!.id));
    let node = $derived(h?.kind === "node" && d.nodes.find(n => n.id === h!.id));
    let q = $derived((editor.filter ?? "").trim().toLowerCase());
    let routes = $derived(m.routes.filter(r => r.edge.name.toLowerCase().includes(q)));
    let nodes = $derived(d.nodes.filter(n => n.name.toLowerCase().includes(q)));
    const nodeType = (n: RoadNode) => n.type === "gate" && d.yards?.find(y => y.id === n.yard)?.kind === "plaza" ? "广场入口" : types[n.type];
</script>
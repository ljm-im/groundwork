{#snippet roadRow(route: Route)}
    <button class="route-row" data-edge={route.id} aria-pressed={editor.selection?.id === route.id && ["edge", "via"].includes(editor.selection.kind)}
        onclick={() => editor.focus("edge", route.id)}>
        <Icon name="edge" /><span>{route.edge.label}</span>
        {#if m.issues.some(i => (i.road === route.id || i.other === route.id) && i.severity === "error")}<i class="route-dot" aria-label="有校验问题"></i>{/if}
        <small class="list-detail">{d.roadClasses[route.edge.grade]?.name} {displayNumber(route.length, .1, "m")}</small>
    </button>
{/snippet}
{#snippet stat(label: string, value: number, step: number, unit = "")}
    <FieldRow {label} {unit}><output>{displayNumber(value, step)}</output></FieldRow>
{/snippet}
{#snippet mode(label: string, key: string, value: string, inherit = false)}
    <PropertySelect {label} {value} options={inherit ? [{ id: "", name: "跟随整条道路" }, ...modeOptions] : modeOptions}
        attributes={{ "data-mode": key }} choose={value => changeChoice(editor, { mode: key }, value)} />
{/snippet}
{#snippet edgePane(route: Route, selection: Selection)}
    {@const e = route.edge}
    {@const cl = m.resolved.roadClasses[e.grade]}
    {@const via = selection.kind === "via"}
    {@const index = selection.index ?? 0}
    <PropertyPane {editor}>
        {#snippet title()}
            <PropertyTitle name={e.label} icon="edge" rename={name => editor.edit(d => {
                d.edges[edgeIndex].label = name;
            })} remove={() => {
                if (via) editor.select({ kind: "edge", id: e.id });
                editor.removeSelected();
            }} />
        {/snippet}
        {#snippet children(tab)}
            {#if tab === "label"}
                <LabelProperties {editor} target={{ group: "edges", id: e.id }} showLabel={e.showLabel ?? true}
                    setLabelVisibility={visible => editor.edit(d => {
                        d.edges[edgeIndex].showLabel = visible;
                    })} />
            {:else if tab === "edge"}
                <Part title="路线">
                    <div class="sub">{d.nodes.find(n => n.id === e.from)?.label} → {d.nodes.find(n => n.id === e.to)?.label}</div>
                    {@render stat("路线长度", route.length, .1, "m")}{@render stat("端点落差", route.drop, .1, "m")}
                    <FieldRow label="最陡坡度"><output>{pct(route.maxGrade)}</output></FieldRow>
                    {@render stat("绕路比", route.detour, .01)}
                    {@render stat("台阶段数", route.stairRuns, 1, "段")}{@render stat("台阶总长", route.stairLength, .1, "m")}
                </Part>
                <Part title="选线">
                    <PropertySelect label="等级" value={e.grade} options={Object.entries(d.roadClasses).map(([id, item]) => ({ id, name: item.name }))}
                        attributes={{ "data-param": "grade" }} choose={grade => changeChoice(editor, { param: "grade" }, grade)} />
                    {#each [["路面宽度", "width", "m"], ["舒适坡度", "comfort", "%"], ["最大坡度", "maxGrade", "%"], ["走廊半宽", "corridor", "m"], ["强制台阶终点", "stairUntil", "m"]] as [name, key, unit] (key)}
                        <NumberInput {editor} label={name} {unit} displayFactor={unit === "%" ? 100 : 1} address={["edges", edgeIndex, key]} self={"edge:" + e.id + "." + key} />
                    {/each}
                    <div class="sub">等级校验：{cl.rampLimit != null ? "坡道上限 " + pct(cl.rampLimit) + "，" : ""}{cl.allowStairs ? "台阶上限 " + pct(cl.stairLimit) : "仅设坡道"}</div>
                </Part>
                <Part title="路段">
                    {@render mode("道路默认模式", "edge", e.mode ?? "route")}
                    <PropertySelect label="编辑路段" value={String(index)} options={Array.from({ length: e.via.length + 1 }, (_, i) => ({ id: String(i), name: "第 " + (i + 1) + " 段" }))}
                        attributes={{ "data-part-index": "" }} choose={value => changeChoice(editor, { partIndex: "" }, value)} />
                    {@render mode("本段模式", "segment", e.segments?.[index]?.mode ?? "", true)}
                    <FieldRow label="实际模式"><output>{modes[segmentMode(e, index)]}</output></FieldRow>
                    <GeometryInput label="路线控制点" icon="polyline" count={e.via.length + 2} active={editor.map?.objectGeometry?.kind === "edge"}
                        onclick={() => editor.focusObjectGeometry({ kind: "edge", id: e.id })} />
                </Part>
                {#if via}
                    <Part title={"途经点 " + (index + 1)}>
                        {#snippet actions()}
                            <button class="icon-button danger" data-tip="删除途经点" aria-label="删除途经点" onclick={() => editor.removeSelected()}><Icon name="delete" /></button>
                        {/snippet}
                        <label class="toggle"><input type="checkbox" data-exact-via checked={!!e.segments?.[index]?.exactEnd} />精确经过此点</label>
                        <GeometryInput label="位置" active={editor.map?.objectGeometry?.kind === "via"} onclick={() => editor.focusObjectGeometry({ kind: "via", id: e.id, index })} />
                    </Part>
                {:else}
                    <div class="sub waypoints">{displayNumber(e.via.length, 1)} 个途经点</div>
                {/if}
            {:else}<ObjectProblems {editor} />{/if}
        {/snippet}
    </PropertyPane>
{/snippet}
{#snippet nodePane(node: RoadNode<Expression>)}
    {@const pose = nodePose(m.resolved, node.id) as { normal?: number }}
    {@const linked = m.routes.filter(route => route.edge.from === node.id || route.edge.to === node.id)}
    <PropertyPane {editor}>
        {#snippet title()}
            <PropertyTitle name={node.label} icon="node" rename={name => editor.edit(d => {
                d.nodes[nodeIndex].label = name;
            })} remove={() => editor.removeSelected()} />
        {/snippet}
        {#snippet children(tab)}
            {#if tab === "label"}
                <LabelProperties {editor} target={{ group: "nodes", id: node.id }} showLabel={node.showLabel ?? true}
                    setLabelVisibility={visible => editor.edit(d => {
                        d.nodes[nodeIndex].showLabel = visible;
                    })} />
            {:else if tab === "node"}
                <Part title="节点">
                    {@const manual = m.resolved.nodes[nodeIndex].directionMode !== "auto"}
                    <GeometryInput label="位置" active={editor.map?.objectGeometry?.kind === "node"} onclick={() => editor.focusObjectGeometry({ kind: "node", id: node.id })} />
                    {#if node.type === "door"}
                        {@const b = d.buildings.find(b => b.id === node.building)!}
                        <FieldRow label="所属建筑"><span>{b.label}</span></FieldRow>
                        {@render stat("外法线", pose.normal! / radians, .1, "°")}
                        {#if b.summit}
                            {@const heights = summitHeights(m.terrain.grid, m.graded.heights, b.center, m.terrain.defined)}
                            {@render stat("基座实测", heights.ground ?? NaN, .01, "m")}
                            {@render stat("25 m 内最高", heights.highest, .01, "m")}
                        {/if}
                    {:else}
                        <PropertySelect label="类型" value={node.type} options={Object.entries(types).filter(([id]) => id !== "door").map(([id, name]) => ({ id, name }))}
                            attributes={{ "data-node-param": "type" }} choose={type => changeChoice(editor, { nodeParam: "type" }, type)} />
                    {/if}
                    <label class="toggle"><input type="checkbox" checked={manual} onchange={e => {
                        const mode = e.currentTarget.checked ? "manual" : "auto";
                        editor.edit(d => {
                            d.nodes[nodeIndex].directionMode = mode;
                        });
                    }} />手动朝向</label>
                    {#if manual}<NumberInput {editor} label="朝向" unit="°" address={["nodes", nodeIndex, "direction"]} self={"node:" + node.id + ".direction"} />{/if}
                    {#each throughPairs(node) as pair (pair)}
                        {@const main = (pair as string[]).map(id => linked.find(route => route.id === id)!)}
                        {@const arms = main.map(route => armBearing(route, node.id))}
                        {@render stat("直通方向差", 180 - angleDiff(arms[0], arms[1]) / radians, .1, "°")}
                        {#each linked.filter(route => !throughPairs(node).flat().includes(route.id)) as route (route.id)}
                            {@render stat("“" + route.edge.label + "”夹角", Math.min(...arms.map(a => angleDiff(a, armBearing(route, node.id)))) / radians, .1, "°")}
                        {/each}
                        <div class="sub">直通道路：{main.map(route => "“" + route.edge.label + "”").join(" / ")}</div>
                    {/each}
                </Part>
                <Part title="相连道路" count={linked.length}>{#each linked as route (route.id)}{@render roadRow(route)}{/each}</Part>
            {:else}<ObjectProblems {editor} />{/if}
        {/snippet}
    </PropertyPane>
{/snippet}

{#if route && h}{@render edgePane(route, h)}
{:else if node}{@render nodePane(node)}
{:else}
    {@const errors = m.issues.filter(i => i.severity === "error").length}
    <Search id="search" label="查找道路或节点" bind:value={editor.filter} />
    <Part title="道路" count={routes.length}>{#each routes as item (item.id)}{@render roadRow(item)}{:else}<div class="sub panel-inset">无匹配道路</div>{/each}</Part>
    <details class="part" open={!!q}>
        <summary class="panel-inset">节点（{nodes.length}）</summary>
        {#each nodes as n (n.id)}
            <button class="object-row" data-node={n.id} aria-pressed={editor.selection?.kind === "node" && editor.selection.id === n.id} onclick={() => editor.focus("node", n.id)}>
                <Icon name="node" />{n.label}<small class="list-detail">{types[n.type]}</small>
            </button>
        {/each}
    </details>
    <Part title="设计校验">
        <button class="object-row" data-action="issues" onclick={() => editor.changeTab("issues")}>
            <Icon name="issues" />{errors} 处问题，{m.issues.length - errors} 处提示
        </button>
    </Part>
{/if}

<style>
    .waypoints { margin-top: var(--space-1); }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type Expression, type RoadNode, type Route, type Selection } from "../types.ts";
    import { nodePose, segmentMode, throughPairs } from "../../core/design/model.ts";
    import { angleDiff, radians } from "../../core/math/geometry.ts";
    import { armBearing, summitHeights } from "../../core/checks/validation.ts";
    import { changeChoice } from "../state/fields.ts";
    import { displayNumber } from "../state/numbers.ts";
    import Icon from "./Icon.svelte";
    import NumberInput from "./NumberInput.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import PropertySelect from "./PropertySelect.svelte";
    import FieldRow from "./FieldRow.svelte";
    import Part from "./Part.svelte";
    import LabelProperties from "./LabelProperties.svelte";
    import Search from "./Search.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";

    let { editor, listOnly = false }: { editor: session.Editor; listOnly?: boolean } = $props();
    const types: Record<string, string> = { door: "建筑门", junction: "路口", endpoint: "端点", viewpoint: "观景点" };
    const modes: Record<string, string> = { route: "选线", smooth: "平滑", straight: "直线" };
    const modeOptions = Object.entries(modes).map(([id, name]) => ({ id, name }));
    const pct = (value: number) => displayNumber(value * 100, .1, "%");
    let m = $derived(editor.island), d = $derived(m.design), h = $derived(listOnly ? null : editor.selection);
    let route = $derived.by(() => {
        editor.revision;
        return h && ["edge", "via"].includes(h.kind) && m.routes.find(route => route.id === h!.id);
    });
    let node = $derived(h?.kind === "node" && d.nodes.find(node => node.id === h!.id));
    let nodeIndex = $derived(d.nodes.findIndex(node => node.id === h?.id)), edgeIndex = $derived(d.edges.findIndex(edge => edge.id === h?.id));
    let q = $derived((editor.filter ?? "").trim().toLowerCase());
    let routes = $derived(m.routes.filter(route => route.edge.label.toLowerCase().includes(q)));
    let nodes = $derived(d.nodes.filter(node => node.label.toLowerCase().includes(q)));
</script>
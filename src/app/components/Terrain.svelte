{#snippet tools()}
    <div class="feature-tools">{#each kinds as [key, label] (key)}
        <button data-create={key} class:active={editor.tool === key} onclick={() => {
            editor.select(null, false); editor.setTool(key);
        }}>{label}</button>
    {/each}</div>
{/snippet}
{#snippet back()}<button class="back flat" data-action="terrain-list" onclick={() => {
    editor.setTool("select"); editor.select(null, false);
}}>‹ 地形对象</button>{/snippet}
{#snippet field(label: string, key: string, value: number, min?: number, max?: number)}
    <label class="field">{label}<input type="number" step="any" data-feature-field={key} {min} {max} {value} /></label>
{/snippet}
{#if item && h}
    {@render back()}<h2>{item.name}</h2>{#if editor.tool in featureNames}{@render tools()}{/if}
    <label class="field">名称<input class="wide" data-feature-field="name" value={item.name} /></label>
    {#if kind === "planting"}
        {@const planting = item as Planting}
        <Part title="种植">{@render field("密度", "density", planting.density, 0, 1)}{@render field("成丛程度", "clump", planting.clump, 0, 1)}
            <label class="field">树种<select data-feature-field="species" value={planting.species}>{#each Object.entries(species) as [k, name] (k)}<option value={k}>{name}</option>{/each}</select></label>
            {@render field("最小冠幅半径 / m", "minSize", planting.size[0], .1, planting.size[1])}{@render field("最大冠幅半径 / m", "maxSize", planting.size[1], planting.size[0])}
            <label class="toggle">沿边成排<input type="checkbox" data-feature-field="rows" checked={planting.rows} /></label>{#if planting.rows}{@render field("株距 / m", "spacing", planting.spacing, .5)}{/if}
        </Part>
        <Part title="地形与区域">
            <label class="toggle">顺应地形<input type="checkbox" data-feature-field="natural" checked={planting.natural} /></label>
            {@render field("边缘过渡宽度 / m", "feather", planting.feather, 0)}
        </Part>
    {:else if kind === "clearing"}
        {@const clearing = item as Clearing}
        <Part title="空地"><label class="toggle">只挖掉绿化区里的树，保留零散树<input type="checkbox" data-feature-field="ambient" checked={clearing.cover === "ambient"} /></label>
            {@const shape = clearing.shape}{#if shape.type === "sector"}{@render field("半径 / m", "outer", shape.outer, .1)}{/if}</Part>
    {/if}
    {#if kind === "planting" || kind === "clearing" && "shape" in item && item.shape.type === "polygon"}
        <div class="sub">{editor.tool === "select" ? "Alt 单击或双击边线插入折点。选中折点后可拖动或删除。" : "切换到选择工具可拖动折点。"}</div>
    {/if}
    {#if h.role === "vertex"}<div class="field"><button data-action="whole-feature" onclick={() => editor.select({ kind, id: item.id })}>选中整个{featureNames[kind]}</button>
        <button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除折点 {h.index! + 1}</button></div>
    {:else}<div class="part"><button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除{featureNames[kind]}</button></div>{/if}
{:else}
    <h2>地形</h2>
    <Prompt {editor} title="全岛描述" target={{ group: "design" }} />
    {@render tools()}<Search id="terrain-search" label="查找地形对象" bind:value={editor.terrainFilter} />
    <Part title="地件" count={nodes.length}>
        {#each nodes as n (n.id)}
            <button class="object-row" data-geo-node={n.id} aria-pressed={h?.kind === "geoNode" && h.id === n.id}
                onclick={() => editor.focus("geoNode", n.id)}><span>{n.name}</span><small>{n.function.type} · {n.field ?? "height"}</small></button>
        {/each}
    </Part>
    {#each groups as group (group.key)}
        <Part title={group.name} count={group.items.length}>{#each group.items as obj (obj.id)}
            <button class="object-row" data-feature={group.key} data-id={obj.id} onclick={() => editor.focus(group.key, obj.id)}>{obj.name}<small>›</small></button>
        {:else}<div class="sub">暂无{group.name}</div>{/each}</Part>
    {/each}
    {#if !nodes.length && !groups.length}<div class="sub">无匹配对象</div>{/if}
    <details data-details="density" open={editor.densityOpen}
        ontoggle={e => {
            if (e.currentTarget.isConnected) editor.densityOpen = e.currentTarget.open;
        }}
        onchange={e => {
            editor.densityOpen = e.currentTarget.open;
        }}><summary>默认植树密度</summary>
        <label class="field">自然地表<input type="number" min="0" max="1" step="any" data-density="natural" value={d.vegetation.density.natural} /></label>
    </details>
    <Part title="变量">
        {#each Object.entries(d.variables) as [key, variable] (key)}
            {#if variable.range}
                {@const [min, max, step] = variable.range}
                <label class="slider"><span>{variable.label ?? key}</span><input type="range" data-variable={key} {min} {max} {step}
                    value={variable.value} oninput={e => preview(e, key)} /><output>{variable.value}</output></label>
            {:else}<div class="field">{variable.label ?? key}<output>{variable.value}</output></div>{/if}
        {/each}
    </Part>
    <Part title="随机细节"><label class="field">种子<input type="number" id="seed" value={d.seed} step="1" /></label>
        <button data-action="reseed" onclick={() => {
            const next = ((Math.imul(d.seed, 7) + 13) >>> 0) % 997; d.seed = next === d.seed ? (next + 1) % 997 : next; editor.rebuild();
        }}>换一组随机细节</button></Part>
    <Part title="网格"><div class="field">网格间距<span class="mono">{d.grid.step} m</span></div>
        <div class="field">东西范围<span class="mono">{editor.island.terrain.grid.xMin} … {editor.island.terrain.grid.xMax} m</span></div><div class="field">南北范围<span class="mono">{editor.island.terrain.grid.yMin} … {editor.island.terrain.grid.yMax} m</span></div></Part>
{/if}

<style>
    :global {
        .feature-tools {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin: 12px 0;
        }
        .feature-tools button.active, .object-row[aria-pressed="true"] {
            background: #e1eee6;
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type FeatureKind, type Named } from "../types.ts";
    import { type Planting, type Clearing } from "../../core/design/v5.ts";
    import { featureNames, featureOf, features } from "../../core/edit/landforms.ts";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import Search from "./Search.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design), h = $derived(editor.selection);
    let kind = $derived(h?.kind as FeatureKind), item = $derived(featureOf(d, h));
    let q = $derived(editor.terrainFilter.trim().toLowerCase());
    const kinds = Object.entries(featureNames) as [FeatureKind, string][];
    const species = { mixed: "小乔木与灌木", shrub: "灌木", small: "小乔木", avenue: "行道树", forest: "林木" };
    let groups = $derived(kinds.map(([key, name]) => ({ key, name, items: (features(d, key) as Named[]).filter(v => v.name.toLowerCase().includes(q)) })).filter(g => !q || g.items.length));
    let nodes = $derived(d.geoNodes.filter(n => [n.name, n.id, n.field ?? "height", n.function.type].some(s => s.toLowerCase().includes(q))).reverse());
    function preview(e: Event & { currentTarget: HTMLInputElement }, key: string) {
        if (editor.busy) return;
        d.variables[key].value = e.currentTarget.valueAsNumber;
        e.currentTarget.nextElementSibling!.textContent = e.currentTarget.value;
        editor.pendingLevels.add(key);
        editor.schedule();
    }
</script>
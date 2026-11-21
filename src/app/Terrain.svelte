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
{#snippet height(v: Height, index: number | "peak")}
    {@const key = typeof v === "number" ? "" : v.level}
    <div class="height-fields">
        <label>高度基准<select data-height-mode={index} value={key}><option value="">绝对高度</option>
            {#each Object.keys(d.levels) as k (k)}<option value={k}>{[k, d.levelControls[k]?.[0]].filter(Boolean).join(" ")}</option>{/each}
        </select></label>
        <label>{key ? "偏移" : "海拔"} / m<input type="number" step="any" data-height-value={index} value={typeof v === "number" ? v : v.offset ?? 0} /></label>
    </div>
{/snippet}
{#if zone}
    {@render back()}<h2>{zone.name}</h2>
    <Part title="街尾抬升">
        {#each ["内半径 / m", "外半径 / m"] as label, i (i)}<label class="field">{label}<input type="number" min="0" step="any" data-rise-radius={i} value={zone.height.endRise!.fade[i]} /></label>{/each}
        <div class="sub">内半径以内保持原地面，外半径以外使用完整抬升。</div>
    </Part>
{:else if item && h}
    {@render back()}<h2>{item.name}</h2>{#if editor.tool in featureNames}{@render tools()}{/if}
    <label class="field">名称<input class="wide" data-feature-field="name" value={item.name} /></label>
    {#if kind === "peak"}
        <Part title="山头">{@render height(item.height, "peak")}{@render field("半径 / m", "radius", item.radius, .1)}{@render field("噪声幅度 / m", "noise", item.noise, 0)}
            {@render field("保护半径 / m", "protect", item.protect ?? 10, 0)}{@render field("最小崖坡系数", "cliffMin", item.cliffMin ?? 1.4, 0)}</Part>
    {:else if kind === "ridge"}
        <Part title="山脊宽度">{@render field("左侧 / m", "left", item.widths[0], .1)}{@render field("右侧 / m", "right", item.widths[1], .1)}</Part>
        <Part title="折点高度" count={item.points.length}>
            {#each item.points as p, i (i)}<div class="ridge-point" class:chosen={h.role === "vertex" && h.index === i}>
                <button class="flat" data-vertex={i} onclick={() => editor.vertex(i)}>折点 {i + 1}</button>{@render height(p.height, i)}</div>{/each}
        </Part>
    {:else if kind === "planting"}
        <Part title="种植">{@render field("密度", "density", item.density, 0, 1)}{@render field("成丛程度", "clump", item.clump, 0, 1)}
            <label class="field">树种<select data-feature-field="species" value={item.species}>{#each Object.entries(species) as [k, name] (k)}<option value={k}>{name}</option>{/each}</select></label>
            {@render field("最小冠幅半径 / m", "minSize", item.size[0], .1, item.size[1])}{@render field("最大冠幅半径 / m", "maxSize", item.size[1], item.size[0])}
            <label class="toggle">沿边成排<input type="checkbox" data-feature-field="rows" checked={item.rows} /></label>{#if item.rows}{@render field("株距 / m", "spacing", item.spacing, .5)}{/if}
        </Part>
        <Part title="地形与区域">
            <label class="toggle">顺应地形<input type="checkbox" data-feature-field="natural" checked={item.natural} /></label>
            {@render field("边缘过渡宽度 / m", "feather", item.feather, 0)}
            <label class="toggle">限制种植区域<input type="checkbox" data-feature-field="limitZones" checked={!!item.zones} /></label>
            {#if item.zones}<div class="sub">在所选区域和区外的自然地面种植。</div>{#each d.zones as z (z.id)}
                <label class="toggle">{z.name}<input type="checkbox" data-plant-zone={z.id} checked={item.zones.includes(z.id)} /></label>{/each}{/if}
        </Part>
    {:else if kind === "clearing"}
        <Part title="空地"><label class="toggle">只挖掉绿化区里的树，保留零散树<input type="checkbox" data-feature-field="ambient" checked={item.cover === "ambient"} /></label>
            {#if clearingShape(d, item).type === "sector"}{@render field("半径 / m", "outer", clearingShape(d, item).outer, .1)}{/if}</Part>
    {/if}
    {#if kind === "ridge" || kind === "planting" || kind === "clearing" && clearingShape(d, item).type === "polygon"}
        <div class="sub">{editor.tool === "select" ? "Alt 单击或双击边线插入折点。选中折点后可拖动或删除。" : "切换到选择工具可拖动折点。"}</div>
    {/if}
    {#if h.role === "vertex"}<div class="field"><button data-action="whole-feature" onclick={() => editor.select({ kind, id: item.id })}>选中整个{featureNames[kind]}</button>
        <button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除折点 {h.index! + 1}</button></div>
    {:else}<div class="part"><button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除{featureNames[kind]}</button></div>{/if}
{:else}
    <h2>地形</h2>{@render tools()}<Search id="terrain-search" label="查找地形对象" bind:value={editor.terrainFilter} />
    {#if zones.length}<Part title="地形区域" count={zones.length}>{#each zones as z (z.id)}
        <button class="object-row" data-rise-zone={z.id} onclick={() => editor.focus("zone", z.id)}>{z.name}<small>›</small></button>{/each}</Part>{/if}
    {#each groups as group (group.key)}
        <Part title={group.name} count={group.items.length}>{#each group.items as obj (obj.id)}
            <button class="object-row" data-feature={group.key} data-id={obj.id} onclick={() => editor.focus(group.key, obj.id)}>{obj.name}<small>›</small></button>
        {:else}<div class="sub">暂无{group.name}</div>{/each}</Part>
    {/each}
    {#if !zones.length && !groups.length}<div class="sub">无匹配对象</div>{/if}
    <details data-details="density" open={editor.densityOpen}
        ontoggle={e => {
            if (e.currentTarget.isConnected) editor.densityOpen = e.currentTarget.open;
        }}
        onchange={e => {
            editor.densityOpen = e.currentTarget.open;
        }}><summary>各区默认植树密度</summary>
        {#each Object.entries(d.vegetation.density) as [key, value] (key)}<label class="field">{d.zones.find(z => z.id === key)?.name ?? (key === "natural" ? "自然地表" : key)}
            <input type="number" min="0" max="1" step="any" data-density={key} {value} /></label>{/each}
    </details>
    <Part title="具名标高">{#each Object.entries(d.levelControls) as [key, [label, min, max, step]] (key)}
        <label class="slider"><span>{label}</span><input type="range" data-level={key} {min} {max} {step} value={d.levels[key]} oninput={e => preview(e, key)} /><output>{d.levels[key]} m</output></label>
    {/each}</Part>
    <Part title="随机细节"><label class="field">种子<input type="number" id="seed" value={d.seed} step="1" /></label>
        <button data-action="reseed" onclick={() => {
            const next = ((Math.imul(d.seed, 7) + 13) >>> 0) % 997; d.seed = next === d.seed ? (next + 1) % 997 : next; editor.rebuild();
        }}>换一组随机细节</button></Part>
    <Part title="网格"><div class="field">网格间距<span class="mono">{d.grid.step} m</span></div>
        <div class="field">东西范围<span class="mono">{d.grid.xMin} … {d.grid.xMax} m</span></div><div class="field">南北范围<span class="mono">{d.grid.yMin} … {d.grid.yMax} m</span></div></Part>
{/if}

<style>
    :global {
        .feature-tools {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin: 12px 0;
        }
        .feature-tools button.active, .ridge-point.chosen {
            background: #e1eee6;
        }
        .height-fields {
            display: grid;
            grid-template-columns: minmax(0,1.6fr) minmax(0,1fr);
            gap: 8px;
            padding: 5px 0 9px;
        }
        .height-fields label {
            display: grid;
            gap: 4px;
            min-width: 0;
            font-size: 12px;
            color: #57665b;
        }
        .height-fields select, .height-fields input {
            width: 100%;
            min-width: 0;
        }
        .ridge-point {
            padding: 4px 6px;
            border-bottom: 1px solid #e1e6de;
        }
    }
</style>

<script lang="ts">
    import * as session from "./session.svelte";
    import { type FeatureKind, type Height, type Named } from "./types";
    import { clearingShape } from "../core/model.js";
    import { featureNames, featureOf, features } from "../core/landforms.js";
    import Part from "./Part.svelte";
    import Search from "./Search.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let d = $derived(editor.island.design), h = $derived(editor.selection);
    let kind = $derived(h?.kind as FeatureKind), item = $derived(featureOf(d, h));
    let zone = $derived(h?.kind === "zone" && d.zones.find(z => z.id === h!.id && z.height.endRise));
    let q = $derived(editor.terrainFilter.trim().toLowerCase());
    const kinds = Object.entries(featureNames) as [FeatureKind, string][];
    const species = { mixed: "小乔木与灌木", shrub: "灌木", small: "小乔木", avenue: "行道树", forest: "林木" };
    let groups = $derived(kinds.map(([key, name]) => ({ key, name, items: (features(d, key) as Named[]).filter(v => v.name.toLowerCase().includes(q)) })).filter(g => !q || g.items.length));
    let zones = $derived(d.zones.filter(z => z.height.endRise && z.name.toLowerCase().includes(q)));
    function preview(e: Event & { currentTarget: HTMLInputElement }, key: string) {
        if (editor.busy) return;
        d.levels[key] = e.currentTarget.valueAsNumber;
        e.currentTarget.nextElementSibling!.textContent = e.currentTarget.value + " m";
        editor.pendingLevels.add(key);
        editor.schedule();
    }
</script>
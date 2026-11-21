{#snippet field(label: string, key: string, value: number, min?: number)}
    <label class="field">{label}<input type="number" step="any" {min} data-building-param={key} {value} /></label>
{/snippet}
{#snippet walls()}{#each [0, 1, 2, 3] as i (i)}<option value={i}>墙 {i + 1}</option>{/each}{/snippet}
{#if b}
    <button class="back flat" data-action="buildings-back" onclick={() => {
        editor.select(null); editor.changeTab("buildings");
    }}>‹ 建筑列表</button><h2>{b.name}</h2><ObjectProblems {editor} />
    <Part title="建筑属性">
        <label class="field">名称<input class="wide" data-building-param="name" value={b.name} /></label>
        <label class="field">形状<select data-building-param="shape" value={b.shape}>{#if b.shape === "ring"}<option value="ring">环形</option>{/if}<option value="rect">矩形</option><option value="circle">圆形</option></select></label>
        {#if b.shape === "rect"}{@render field("长 / m", "length", b.size![0], 1)}{@render field("宽 / m", "width", b.size![1], 1)}
        {:else}{@render field("半径 / m", "radius", b.radius!, (b.inner ?? 0) + .3)}{/if}
        {@render field("转角 / °", "angle", +(b.angle ?? 0).toFixed(2))}{@render field("高度 / m", "height", b.height, .1)}
        <label class="toggle">显示标题<input type="checkbox" data-building-param="showTitle" checked={b.showTitle !== false} /></label>
    </Part>
    <Part title="门" count={b.doors.length}>
        {#each b.doors as door (door.id)}
            <div class="door-row"><b>{door.name ?? door.id}</b>
                {#if b.shape === "rect"}<select data-door-wall={door.id} value={door.wall} aria-label={door.name ?? door.id}>{@render walls()}</select>{/if}
                <button class="flat" data-connect-door={door.id} onclick={() => editor.connectDoor(b, door)}>连线</button>
                <button class="flat danger" data-delete-door={door.id} onclick={() => editor.removePart(b, door)}>删除</button>
            </div>
        {/each}
        <div class="field">{#if b.shape === "rect"}<label>新门位置 <select id="new-door-wall" bind:value={wall}>{@render walls()}</select></label>{/if}
            <button data-action="add-door" onclick={() => editor.addDoor(b, wall)}>加门</button></div>
    </Part>
    <div class="sub">拖动建筑移动，拖角点改尺寸，拖外侧手柄旋转。选中后可拖动标题和门。</div><div class="part"><button class="danger" data-action="delete" onclick={() => editor.removeSelected()}>删除建筑</button></div>
{:else}
    <div class="row-between"><h2>建筑</h2><button data-action="place" onclick={() => editor.setTool("building")}>放置建筑</button></div>
    <Search id="building-search" label="查找建筑" bind:value={editor.buildingFilter} />
    <Part title="建筑列表" count={list.length}>
        {#each list as item (item.id)}<button class="object-row" data-building={item.id} onclick={() => editor.focus("building", item.id)}>{item.name}<small>{shapes[item.shape]} ›</small></button>
        {:else}<div class="sub">无匹配建筑</div>{/each}
    </Part>
{/if}

<style>
    :global {
        .door-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 7px 0;
        }
        .door-row b {
            flex: 1;
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte";
    import Part from "./Part.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";
    import Search from "./Search.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let design = $derived(editor.island.design);
    let b = $derived(editor.selection?.kind === "building" && design.buildings.find(v => v.id === editor.selection!.id));
    let list = $derived(design.buildings.filter(v => v.name.toLowerCase().includes(editor.buildingFilter.trim().toLowerCase())));
    let wall = $state(0);
    const shapes = { rect: "矩形", circle: "圆形", ring: "环形" };
</script>
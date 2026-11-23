{#snippet field(label: string, path: (string | number)[], unit = "m")}
    <NumberInput {editor} {label} {unit} address={["buildings", index, ...path]}
        self={"building:" + editor.selection!.id + "." + path.join(".")} step={path.at(-1) === "wall" ? 1 : .1} />
{/snippet}
{#snippet walls()}{#each [0, 1, 2, 3] as i (i)}<option value={i}>墙 {i + 1}</option>{/each}{/snippet}
{#if b}
    <PropertyTitle name={b.label} showLabel={b.showLabel} setLabelVisibility={visible => editor.edit(d => {
        d.buildings[index].showLabel = visible;
    })} rename={name => editor.edit(d => {
        d.buildings[index].label = name;
    })} remove={() => editor.removeSelected()} />
    <Prompt {editor} target={{ group: "buildings", id: b.id }} /><ObjectProblems {editor} />
    <Part title="建筑属性">
        <label class="field">形状<select data-building-param="shape" value={b.shape}>{#if b.shape === "ring"}<option value="ring">环形</option>{/if}<option value="rect">矩形</option><option value="circle">圆形</option></select></label>
        <GeometryInput label="中心" active={editor.map?.objectGeometry?.kind === "building"} onclick={() => editor.focusObjectGeometry({ kind: "building", id: b.id })} />
        {#if b.shape === "rect"}{@render field("长", ["size", 0])}{@render field("宽", ["size", 1])}
        {:else}{@render field("半径", ["radius"])}{#if b.shape === "ring"}{@render field("内半径", ["inner"])}{/if}{/if}
        {@render field("转角", ["angle"], "°")}{@render field("高度", ["height"])}
        {@render field("台基范围", ["pad"])}{@render field("避让距离", ["blockMargin"])}{@render field("避树半径", ["treeRadius"])}
    </Part>
    <Part title="门" count={b.doors.length}>
        {#each b.doors as door, i (door.id)}
            <div class="door-row"><div class="door-title">
                <PropertyTitle name={door.label ?? door.id} showLabel={door.showLabel}
                    rename={label => editor.edit(d => {
                        d.buildings[index].doors[i].label = label;
                    })}
                    setLabelVisibility={visible => editor.edit(d => {
                        d.buildings[index].doors[i].showLabel = visible;
                    })} /></div>
                <button class="flat" data-connect-door={door.id} onclick={() => editor.connectDoor(b, door)}>连线</button>
                <button class="flat danger" data-delete-door={door.id} onclick={() => editor.removePart(b, door)}>删除</button>
            </div>
            {#if b.shape === "rect"}{@render field("墙面编号", ["doors", i, "wall"], "")}{@render field("门的位置", ["doors", i, "t"], "")}
            {:else}{@render field("门的转角", ["doors", i, "angle"], "°")}{/if}
        {/each}
        <div class="field">{#if b.shape === "rect"}<label>新门位置 <select id="new-door-wall" bind:value={wall}>{@render walls()}</select></label>{/if}
            <button data-action="add-door" onclick={() => editor.addDoor(b, wall)}>加门</button></div>
    </Part>
    <div class="sub">拖动建筑移动，拖角点改尺寸，拖外侧手柄旋转。选中后可拖动标签和门。</div>
{:else}
    <div class="row-between"><h2>建筑</h2><button data-action="place" onclick={() => editor.setTool("building")}>放置建筑</button></div>
    <Search id="building-search" label="查找建筑" bind:value={editor.buildingFilter} />
    <Part title="建筑列表" count={list.length}>
        {#each list as item (item.id)}<button class="object-row" data-building={item.id} aria-pressed={editor.selection?.kind === "building" && editor.selection.id === item.id} onclick={() => editor.focus("building", item.id)}>{item.label}<small>{shapes[item.shape]} ›</small></button>
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
        .door-row .door-title {
            flex: 1;
            min-width: 0;
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import PropertyTitle from "./PropertyTitle.svelte";
    import NumberInput from "./NumberInput.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import Part from "./Part.svelte";
    import Prompt from "./Prompt.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";
    import Search from "./Search.svelte";

    let { editor, listOnly = false }: { editor: session.Editor; listOnly?: boolean } = $props();
    let design = $derived(editor.island.design);
    let b = $derived(!listOnly && editor.selection?.kind === "building" && design.buildings.find(v => v.id === editor.selection!.id));
    let list = $derived(design.buildings.filter(v => v.label.toLowerCase().includes(editor.buildingFilter.trim().toLowerCase())));
    let index = $derived(design.buildings.findIndex(v => v.id === editor.selection?.id));
    let wall = $state(0);
    const shapes = { rect: "矩形", circle: "圆形", ring: "环形" };
</script>
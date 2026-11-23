{#snippet field(label: string, path: (string | number)[], unit = "m")}
    <NumberInput {editor} {label} {unit} address={["buildings", index, ...path]}
        self={"building:" + b!.id + "." + path.join(".")} step={path.at(-1) === "wall" ? 1 : .1} />
{/snippet}
{#if b}
    <PropertyPane {editor}>
        {#snippet title()}
            <PropertyTitle name={b!.label} icon="building" rename={name => editor.edit(d => {
                d.buildings[index].label = name;
            })} remove={() => editor.removeSelected()} />
        {/snippet}
        {#snippet children(tab)}
            {#if tab === "label"}
                <LabelProperties {editor} target={{ group: "buildings", id: b!.id }} showLabel={b!.showLabel ?? true} setLabelVisibility={visible => editor.edit(d => {
                    d.buildings[index].showLabel = visible;
                })} />
            {:else if tab === "building"}
                <Part>
                    <PropertySelect label="形状" value={b!.shape} options={shapeOptions.filter(item => item.id !== "ring" || b!.shape === "ring")}
                        attributes={{ "data-building-param": "shape" }} choose={shape => changeChoice(editor, { buildingParam: "shape" }, shape)} />
                    <GeometryInput label="中心" active={editor.map?.objectGeometry?.kind === "building"} onclick={() => editor.focusObjectGeometry({ kind: "building", id: b!.id })} />
                    {#if b!.shape === "rect"}{@render field("长", ["size", 0])}{@render field("宽", ["size", 1])}
                    {:else}{@render field("半径", ["radius"])}{#if b!.shape === "ring"}{@render field("内半径", ["inner"])}{/if}{/if}
                    {@render field("转角", ["angle"], "°")}{@render field("高度", ["height"])}
                    {@render field("台基范围", ["pad"])}{@render field("避让距离", ["blockMargin"])}{@render field("避树半径", ["treeRadius"])}
                </Part>
            {:else if tab === "doors"}
                <Part title="门">
                    {#snippet actions()}
                        <button class="icon-button" data-action="add-door" data-tip="添加门" aria-label="添加门" onclick={() => editor.addDoor(b!, wall)}><Icon name="plus" /></button>
                    {/snippet}
                    {#if b!.shape === "rect"}
                        <PropertySelect label="新门位置" value={String(wall)} options={walls} attributes={{ id: "new-door-wall" }} choose={value => wall = Number(value)} />
                    {/if}
                    {#each b!.doors as door, i (door.id)}
                        <Subitem label={door.label ?? door.id} icon="door" open={editor.subitemOpen(b!.id, "doors", door.id)}
                            onclick={() => editor.toggleSubitem(b!.id, "doors", door.id)}>
                            {#snippet actions()}
                                <button class="icon-button" data-connect-door={door.id} data-tip="连接道路" aria-label={"连接“" + (door.label ?? door.id) + "”"} onclick={() => editor.connectDoor(b!, door)}><Icon name="edge" /></button>
                                <button class="icon-button danger" data-delete-door={door.id} data-tip={"删除“" + (door.label ?? door.id) + "”"} aria-label={"删除“" + (door.label ?? door.id) + "”"} onclick={() => editor.removePart(b!, door)}><Icon name="delete" /></button>
                            {/snippet}
                            <FieldRow label="标签">
                                <input aria-label="门标签" value={door.label ?? door.id} onchange={e => {
                                    const label = e.currentTarget.value.trim();
                                    if (!label || label === (door.label ?? door.id)) e.currentTarget.value = door.label ?? door.id;
                                    else editor.edit(d => {
                                        d.buildings[index].doors[i].label = label;
                                    });
                                }} />
                            </FieldRow>
                            <label class="toggle"><input type="checkbox" checked={door.showLabel ?? true} onchange={e => {
                                const visible = e.currentTarget.checked;
                                editor.edit(d => {
                                    d.buildings[index].doors[i].showLabel = visible;
                                });
                            }} />显示标签</label>
                            {#if b!.shape === "rect"}{@render field("墙面编号", ["doors", i, "wall"], "")}{@render field("门的位置", ["doors", i, "t"], "")}
                            {:else}{@render field("门的转角", ["doors", i, "angle"], "°")}{/if}
                        </Subitem>
                    {/each}
                </Part>
            {:else}<ObjectProblems {editor} />{/if}
        {/snippet}
    </PropertyPane>
{:else}
    <Search id="building-search" label="查找建筑" bind:value={editor.buildingFilter} />
    {#each list as item (item.id)}
        <button class="object-row" data-building={item.id} aria-pressed={editor.selection?.kind === "building" && editor.selection.id === item.id} onclick={() => editor.focus("building", item.id)}>
            <Icon name="building" />{item.label}<small class="list-detail">{shapes[item.shape]}</small>
        </button>
    {:else}<div class="sub panel-inset">无匹配建筑</div>{/each}
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { changeChoice } from "../state/fields.ts";
    import Icon from "./Icon.svelte";
    import PropertyPane from "./PropertyPane.svelte";
    import PropertyTitle from "./PropertyTitle.svelte";
    import PropertySelect from "./PropertySelect.svelte";
    import NumberInput from "./NumberInput.svelte";
    import GeometryInput from "./GeometryInput.svelte";
    import Part from "./Part.svelte";
    import LabelProperties from "./LabelProperties.svelte";
    import ObjectProblems from "./ObjectProblems.svelte";
    import Search from "./Search.svelte";
    import FieldRow from "./FieldRow.svelte";
    import Subitem from "./Subitem.svelte";

    let { editor, listOnly = false }: { editor: session.Editor; listOnly?: boolean } = $props();
    let design = $derived(editor.island.design);
    let index = $derived(design.buildings.findIndex(v => v.id === editor.selection?.id));
    let b = $derived(listOnly ? undefined : design.buildings[index]);
    let list = $derived(design.buildings.filter(v => v.label.toLowerCase().includes(editor.buildingFilter.trim().toLowerCase())));
    let wall = $state(0);
    const shapes = { rect: "矩形", circle: "圆形", ring: "环形" };
    const shapeOptions = [
        { id: "rect", name: shapes.rect, icon: "rect" },
        { id: "circle", name: shapes.circle, icon: "circle" },
        { id: "ring", name: shapes.ring, icon: "circle" }
    ] as const;
    const walls = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: "墙 " + (i + 1) }));
</script>
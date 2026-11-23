<div class="map-tools" aria-label="地图工具">
    {#each tools as [tool, icon, label] (tool)}
        <button data-tool={tool} data-tip={label} aria-label={label} class:active={!!editor.island && editor.tool === tool} aria-pressed={!!editor.island && editor.tool === tool}
            disabled={!editor.island || !!editor.busy} onclick={() => editor.setTool(tool)}><Icon name={icon} /></button>
    {/each}
</div>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    const groups = {
        terrain: [["pen", "pen", "钢笔"], ["rect", "rect", "矩形"], ["circle", "circle", "圆"], ["sector", "sector", "扇形"], ["strip", "strip", "条带"]],
        network: [["node", "node", "新建节点"], ["edge", "edge", "连线"], ["via", "via", "途经点"], ["fork", "fork", "分岔"], ["door", "door", "门"]],
        buildings: [["building", "building", "建筑"]], layers: [], issues: [], variables: []
    } as const;
    let tools = $derived([["select", "cursor", "选择"] as const, ...groups[editor.tab]]);
</script>
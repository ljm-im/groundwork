<div class="map-tools" aria-label="路网工具">
    {#each tools as [tool, icon, label] (tool)}
        <button data-tool={tool} class:active={editor.tool === tool} aria-pressed={editor.tool === tool}
            onclick={() => {
                if (editor.island) editor.setTool(tool);
            }}><Icon name={icon} />{label}</button>
    {/each}
</div>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import * as session from "./session.svelte";
    let { editor }: { editor: session.Editor } = $props();
    const tools = [
        ["select", "cursor", "选择"], ["node", "node", "新建节点"], ["gate", "gate", "院门"], ["edge", "edge", "连线"],
        ["via", "via", "途经点"], ["fork", "fork", "分岔"], ["door", "door", "门"], ["building", "building", "建筑"]
    ] as const;
</script>
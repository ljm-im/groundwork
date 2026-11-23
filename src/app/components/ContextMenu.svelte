<svelte:window onpointerdown={e => {
    if (!menu?.contains(e.target as Node)) editor.menu = null;
}} onkeydown={e => {
    if (e.key === "Escape") editor.menu = null;
}} />
{#if editor.menu && editor.selection}
    {@const h = editor.selection}
    <div class="context-menu" role="group" aria-label="对象菜单" bind:this={menu} style:left={Math.min(editor.menu.x, innerWidth - 148) + "px"}
        style:top={Math.min(editor.menu.y, innerHeight - (editor.menu.segment ? 255 : h.kind === "geoNode" ? 117 : 50)) + "px"}>
        {#if h.kind === "geoNode"}
            {#if editor.menu.segment}
                {#each modes as [type, name] (type)}<button onclick={() => run(() => editor.segment(type))}>{name}</button>{/each}<hr />
            {/if}
            <button onclick={() => run(() => editor.duplicate(h.id))}>复制</button>
            <button onclick={() => run(() => editor.toggle(h.id))}>{editor.island.design.geoNodes.find(n => n.id === h.id)?.disabled ? "启用" : "关闭"}</button>
        {/if}
        <button class="danger" onclick={() => run(() => {
            if (h.kind === "geoNode") editor.removeGeo(h.id); else if (h.kind === "building" && h.role?.startsWith("door:")) {
                const b = editor.island.design.buildings.find(b => b.id === h.id)!; editor.removePart(b, b.doors.find(v => v.id === h.role!.slice(5)));
            }
            else editor.removeSelected();
        })}>删除</button>
    </div>
{/if}

<style>
    .context-menu { position: fixed; z-index: 5; display: grid; min-width: 132px; padding: 5px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); box-shadow: 0 4px 18px #264f522b; }
    .context-menu button { border: 0; justify-content: flex-start; }
    hr { width: 100%; border: 0; border-top: 1px solid var(--line); margin: 2px 0; }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    let menu = $state<HTMLElement>();
    const modes = [["line", "直线"], ["curve", "曲线"], ["arc", "圆弧"], ["tangent", "相切圆弧"]] as const;
    function run(fn: () => void) {
        fn(); editor.menu = null;
    }
</script>
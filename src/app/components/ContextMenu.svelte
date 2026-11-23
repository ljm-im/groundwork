<svelte:window onpointerdown={e => {
    if (!menu?.contains(e.target as Node)) editor.menu = null;
}} onkeydown={e => {
    if (e.key === "Escape") editor.menu = null;
}} />
{#if editor.menu && editor.selection}
    {#key editor.menu}
        {@const h = editor.selection}
        <div class="context-menu popup menu" role="group" aria-label="对象菜单" bind:this={menu} use:place={editor.menu}>
            {#if h.kind === "geoNode"}
                {@const node = editor.island.design.geoNodes.find(n => n.id === h.id)!}
                {#if editor.menu.map && node.construction.type === "free"}
                    <div class="menu-group">
                        <button onclick={() => run(() => editor.setTool("addPath", h.id))}><Icon name="plus" />添加路径</button>
                        {#if editor.menu.segment && editor.menu.segment.path >= 0 && node.construction.paths.length >= 2}
                            <button class="danger" onclick={() => run(() => editor.removePath(h.id, editor.menu!.segment!.path))}><Icon name="delete" />删除路径</button>
                        {/if}
                    </div>
                {/if}
                {#if editor.menu.segment}
                    <div class="menu-group">
                        {#each modes as [type, name] (type)}
                            <button onclick={() => run(() => editor.segment(type))}><Icon name="polyline" />{name}</button>
                        {/each}
                    </div>
                {/if}
            {/if}
            <div class="menu-group">
                {#if h.kind === "geoNode"}
                    {@const node = editor.island.design.geoNodes.find(n => n.id === h.id)!}
                    <button onclick={() => run(() => editor.duplicate(h.id))}><Icon name="copy" />复制</button>
                    <button aria-pressed={!!node.disabled} onclick={() => run(() => editor.toggle(h.id))}><Icon name="exclude" />{node.disabled ? "启用" : "禁用"}</button>
                {:else if h.kind === "mark"}
                    <button onclick={() => run(() => editor.copyMark(h.id))}><Icon name="copy" />复制</button>
                {/if}
                <button class="danger" onclick={() => run(() => remove(h))}><Icon name="delete" />删除</button>
            </div>
        </div>
    {/key}
{/if}

<style>
    .context-menu { min-width: calc(var(--name-w) + 2 * var(--space-3)); max-height: calc(100dvh - var(--space-2)); }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import * as session from "../state/session.svelte.ts";
    import { type Selection } from "../types.ts";
    let { editor }: { editor: session.Editor } = $props();
    let menu = $state<HTMLElement>();
    const modes = [["line", "直线"], ["curve", "曲线"], ["arc", "圆弧"], ["tangent", "相切圆弧"]] as const;
    function run(fn: () => void) {
        fn(); editor.menu = null;
    }
    function remove(selection: Selection) {
        if (selection.kind === "geoNode") editor.removeGeo(selection.id);
        else if (selection.kind === "building" && selection.role?.startsWith("door:")) {
            const b = editor.island.design.buildings.find(item => item.id === selection.id)!;
            editor.removePart(b, b.doors.find(door => door.id === selection.role!.slice(5)));
        }
        else editor.removeSelected();
    }
    function place(element: HTMLElement, at: { x: number; y: number }) {
        function position() {
            const { width, height } = element.getBoundingClientRect();
            element.style.left = Math.max(4, Math.min(at.x, innerWidth - width - 4)) + "px";
            element.style.top = Math.max(4, Math.min(at.y, innerHeight - height - 4)) + "px";
        }
        position();
        window.addEventListener("resize", position);
        return { destroy() {
            window.removeEventListener("resize", position);
        } };
    }
</script>
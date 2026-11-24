<svelte:window onpointerdown={e => {
    if (!menu?.contains(e.target as Node)) editor.menu = null;
}} onkeydown={e => {
    if (e.key === "Escape") editor.menu = null;
}} />
{#if editor.menu && editor.selection}
    {#key editor.menu}
        {@const h = editor.selection}
        {@const control = editor.menu.control}
        <div class="context-menu popup menu" role="group" aria-label="编辑菜单" bind:this={menu} use:place={editor.menu}>
            {#if h.kind === "geoNode"}
                {@const node = geoAt(editor.project.design, h.id)}
                {#if editor.menu.map && node.construction.type === "free"}
                    <div class="menu-group">
                        <button onclick={() => run(() => editor.setTool("addPath", h.id))}><Icon name="plus" />添加路径</button>
                        {#if control && control.role !== "body" && control.role !== "parameter" && control.path >= 0 && node.construction.paths.length >= 2}
                            <button class="danger" onclick={() => run(() => editor.removePath(h.id, control.path))}><Icon name="delete" />删除路径</button>
                        {/if}
                    </div>
                {/if}
                {#if control && (control.role === "vertex" || control.role === "segment")}
                    {@const point = geometryPath(node, control.path)?.nodes[control.index]}
                    {#if point}
                        <div class="menu-group">
                            <div class="group-name">节点类型</div>
                            {#each nodeModes as [mode, name, icon] (mode)}
                                <button aria-pressed={point.mode === mode} onclick={() => run(() => editor.pathNodeMode(control, mode))}><Icon name={icon} />{name}</button>
                            {/each}
                        </div>
                        <div class="menu-group">
                            <div class="group-name">后一段</div>
                            {#each segmentTypes as [type, name, icon] (type)}
                                <button aria-pressed={(point.next ?? "curve") === type} onclick={() => run(() => editor.segment(control, type))}><Icon name={icon} />{name}</button>
                            {/each}
                            {#if point.next === "arc"}<button onclick={() => run(() => editor.segment(control, "tangent"))}><Icon name="tangent" />相切</button>{/if}
                        </div>
                        {#if control.role === "vertex"}
                            <div class="menu-group"><button class="danger" onclick={() => run(() => editor.removeGeo(h.id, control))}><Icon name="delete" />删除节点</button></div>
                        {/if}
                    {/if}
                {/if}
            {/if}
            <div class="menu-group">
                {#if h.kind === "geoNode"}
                    {@const node = geoAt(editor.project.design, h.id)}
                    <button onclick={() => run(() => editor.duplicate(h.id))}><Icon name="copy" />复制</button>
                    <button aria-pressed={!!node.disabled} onclick={() => run(() => editor.toggle(h.id))}><Icon name="exclude" />{node.disabled ? "启用" : "禁用"}</button>
                {:else if h.kind === "mark"}
                    <button onclick={() => run(() => editor.copyMark(h.id))}><Icon name="copy" />复制</button>
                {/if}
                {#if editor.canRemove(h)}<button class="danger" onclick={() => run(() => editor.removeElement(h))}><Icon name="delete" />删除</button>{/if}
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
    import { geoAt } from "../state/geoTools.ts";
    import { geometryPath } from "../../core/edit/geoControls.ts";
    import { nodeModes, segmentTypes } from "../state/inspector.ts";

    let { editor }: { editor: session.Editor } = $props();
    let menu = $state<HTMLElement>();
    function run(fn: () => void) {
        fn(); editor.menu = null;
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
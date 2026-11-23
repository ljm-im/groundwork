<section class="map-wrap" aria-label="全图平面图" class:create={editor.tool !== "select"} class:empty={!editor.island}>
    <canvas bind:this={canvas} id="map" tabindex={editor.island ? 0 : -1} aria-label="可编辑的地形与路网平面图"></canvas>
    <Toolbar {editor} />
    {#if !editor.island}
        <div class="empty-state">
            <div>{editor.files.supported ? "新建可从示例开始，也可以打开已有的设计文件。" : "需要 Chrome 或 Edge"}</div>
            <div class="empty-actions">
                <button disabled={!editor.files.supported || !!editor.busy || !!editor.draft} onclick={() => editor.files.choose("new")}><Icon name="new" />新建</button>
                <button disabled={!editor.files.supported || !!editor.busy || !!editor.draft} onclick={() => editor.files.choose("open")}><Icon name="open" />打开</button>
            </div>
        </div>
    {/if}
    <div class="legend">
        <span><Icon name="door" />建筑门</span><span><Icon name="node" />路口</span>
        <span><Icon name="via" />途经点</span><span class="issue-error"><Icon name="issues" />校验</span>
        {#each treeLegend as [species, label] (species)}
            <span class={"tree-key " + species}><i></i>{label}</span>
        {/each}
    </div>
    <div class="zoom-tools">
        <button class="icon-button" id="minus" aria-label="缩小" data-tip="缩小" onclick={() => editor.island && editor.map.zoomAt(1 / 1.4)}><Icon name="minus" /></button>
        <output id="zoom-value">100%</output>
        <button class="icon-button" id="plus" aria-label="放大" data-tip="放大" onclick={() => editor.island && editor.map.zoomAt(1.4)}><Icon name="plus" /></button>
        <button class="icon-button" id="fit" aria-label="全图视图" data-tip="全图视图" onclick={() => editor.island && editor.map.fit()}><Icon name="fit" /></button>
    </div>
    <div class="coords"><span id="busy" role="status" hidden={!editor.busy}>{busyText}</span><span id="mode-hint">{editor.hint}</span><span id="position">{editor.position}</span></div>
    {#if editor.hint === "先选中一个或两个地件"}<div class="tool-help">{editor.hint}</div>{/if}
    <Messages {editor} />
</section>

<style>
    :global {
        .tool-help {
            position: absolute;
            top: var(--space-3);
            left: calc(var(--icon-button) + var(--space-6));
            padding: var(--space-1) var(--space-2);
            border-radius: var(--radius);
            background: var(--bg-panel);
            font-size: var(--text-sm);
        }
        .map-wrap { position: relative; background: var(--bg-app); overflow: hidden; isolation: isolate; }
        .map-wrap.empty :is(.legend, .zoom-tools), .map-wrap.empty .coords:has(#busy[hidden]) { display: none; }
        .empty-state {
            position: absolute;
            inset: 0;
            display: grid;
            align-content: center;
            justify-items: center;
            gap: var(--space-4);
            padding: var(--space-6);
            text-align: center;
            color: var(--text-secondary);
        }
        .empty-state > :first-child { font-size: var(--text-lg); line-height: var(--leading-lg); color: var(--text); }
        .empty-actions { display: flex; gap: var(--space-2); color: var(--text); }
        #map { width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
        .map-wrap.pan #map { cursor: grab; }
        .map-wrap.drag #map { cursor: grabbing; }
        .map-wrap.create #map { cursor: crosshair; }
        .map-tools, .zoom-tools, .legend, .coords { position: absolute; }
        .map-tools, .zoom-tools, .legend {
            display: flex;
            gap: var(--space-1);
            padding: var(--space-1);
            border-radius: var(--radius);
            background: var(--bg-panel);
        }
        .map-tools { left: var(--space-3); top: var(--space-3); flex-direction: column; }
        .map-tools .icon, .zoom-tools .icon { width: var(--icon-toolbar); height: var(--icon-toolbar); }
        .zoom-tools { right: var(--space-3); bottom: calc(var(--status-h) + var(--space-3)); align-items: center; }
        .zoom-tools output { min-width: var(--row-h); font-size: var(--text-xs); text-align: center; }
        .coords {
            inset: auto 0 0;
            height: var(--status-h);
            padding: 0 var(--space-3);
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            align-items: center;
            gap: var(--space-2);
            font-size: var(--text-xs);
            line-height: var(--leading-xs);
            background: var(--bg-panel);
            color: var(--text-secondary);
        }
        .coords > span { overflow: hidden; text-overflow: ellipsis; white-space: pre; }
        #busy { grid-column: 2; grid-row: 1; }
        #mode-hint { grid-column: 1; grid-row: 1; }
        #position { grid-column: 3; grid-row: 1; font-family: var(--font-coords); text-align: right; }
        .legend {
            left: calc(var(--space-6) + var(--icon-button) + 2 * var(--space-1));
            top: var(--space-3);
            align-items: center;
            gap: var(--space-2);
            padding-inline: var(--space-2);
            font-size: var(--text-xs);
            color: var(--text-secondary);
            pointer-events: none;
        }
        .legend span { display: inline-flex; align-items: center; gap: var(--space-1); }
        .legend .icon { color: var(--text); }
        .tree-key i { width: var(--space-2); height: var(--space-2); border-radius: var(--radius-round); }
        .tree-key.forest i { background: var(--map-tree-forest); }
        .tree-key.avenue i { background: var(--map-tree-avenue); }
        .tree-key.small i { background: var(--map-tree-small); }
        .tree-key.shrub i { background: var(--map-tree-shrub); }
        .legend .issue-error .icon { color: var(--danger); }
        .legend:not(.show-trees) .tree-key, .legend.show-trees > span:not(.tree-key) { display: none; }
        @media (max-width: 680px) {
            .coords { gap: var(--space-1); padding-inline: var(--space-1); }
        }
    }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { attachController } from "../state/controller.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";
    import Toolbar from "./Toolbar.svelte";
    import Messages from "./Messages.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let busyText = $derived(editor.busy === "正在生成地形…" || editor.busy === "正在更新地件…" ? "计算中" : editor.busy ?? "");
    const treeLegend = [["forest", "林木"], ["avenue", "行道树"], ["small", "小乔木"], ["shrub", "灌木"]] as const;
    let canvas: HTMLCanvasElement;
    onMount(() => {
        editor.attach(canvas);
        const detach = attachController(editor, canvas);
        const observer = new ResizeObserver(() => {
            editor.map.resize();
            if (editor.island) editor.sections();
        });
        observer.observe(canvas.parentElement!);
        void editor.files.start();
        return () => {
            detach();
            observer.disconnect();
            editor.dispose();
        };
    });
</script>
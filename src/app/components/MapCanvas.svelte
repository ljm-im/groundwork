<section class="map-wrap" aria-label="全图平面图" class:create={editor.tool !== "select"} class:empty={!editor.project}>
    <canvas bind:this={canvas} id="map" tabindex={editor.project ? 0 : -1} aria-label="可编辑的地形平面图"></canvas>
    {#if !editor.project}
        <div class="empty-state">
            {#if !editor.files.supported}<div class="browser-required">需要 Chrome 或 Edge</div>{/if}
            <div class="empty-actions">
                <button disabled={!editor.files.supported || !!editor.busy || !!editor.draft} onclick={() => editor.files.choose("new")}><Icon name="new" />新建</button>
                <button disabled={!editor.files.supported || !!editor.busy || !!editor.draft} onclick={() => editor.files.choose("open")}><Icon name="open" />打开</button>
            </div>
        </div>
    {/if}
    {#if editor.drawing}
        <div class="drawing-status" aria-label="绘制状态" role="group">
            <strong>{editor.drawing.title}</strong>
            <span>{editor.drawing.end}</span>
            <div class="drawing-actions">
                {#if editor.drawing.finish}
                    <button disabled={!editor.drawingReady || !!editor.busy} onclick={() => editor.completeDrawing()}>完成</button>
                {/if}
                <button disabled={!!editor.busy} onclick={() => editor.cancelDrawing()}>取消</button>
            </div>
        </div>
    {/if}
    <div class="zoom-tools">
        <button class="icon-button" id="minus" aria-label="缩小" data-tip="缩小" onclick={() => editor.project && editor.map.zoomAt(1 / 1.4)}><Icon name="minus" /></button>
        <output id="zoom-value">100%</output>
        <button class="icon-button" id="plus" aria-label="放大" data-tip="放大" onclick={() => editor.project && editor.map.zoomAt(1.4)}><Icon name="plus" /></button>
        <button class="icon-button" id="fit" aria-label="适应" data-tip="适应" onclick={() => editor.project && editor.map.fit()}><Icon name="fit" /></button>
    </div>
    <div class="coords"><span id="busy" role="status" hidden={!editor.busy}>{busyText}</span><span id="mode-hint">{editor.hint}</span><span id="position">{editor.position}</span></div>
    <Messages {editor} />
</section>

<style>
    :global {
        .map-wrap { display: grid; grid-template-rows: minmax(0, 1fr) var(--status-h); position: relative; background: var(--bg-app); overflow: hidden; isolation: isolate; }
        .map-wrap.empty .zoom-tools, .map-wrap.empty .coords:has(#busy[hidden]) { display: none; }
        .empty-state {
            position: absolute;
            inset: 0 0 var(--status-h);
            display: grid;
            align-content: center;
            justify-items: center;
            gap: var(--space-4);
            padding: var(--space-6);
            text-align: center;
            color: var(--text-secondary);
        }
        .empty-state .browser-required { font-size: var(--text-lg); line-height: var(--leading-lg); color: var(--text); }
        .empty-actions { display: flex; gap: var(--space-2); color: var(--text); }
        #map { min-height: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
        .map-wrap.pan #map { cursor: grab; }
        .map-wrap.drag #map { cursor: grabbing; }
        .map-wrap.create #map { cursor: crosshair; }
        .zoom-tools {
            position: absolute;
            display: flex;
            right: var(--space-3);
            bottom: calc(var(--status-h) + var(--space-3));
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-1);
            border: 1px solid var(--border-region);
            border-radius: var(--radius-lg);
            background: var(--bg-panel);
            box-shadow: var(--shadow-pop);
        }
        .zoom-tools output { min-width: var(--row-h); font-size: var(--text-xs); text-align: center; }
        .drawing-status {
            position: absolute;
            top: var(--space-3);
            left: 50%;
            transform: translateX(-50%);
            width: max-content;
            max-width: calc(100% - 2 * var(--space-3));
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--space-1) var(--space-3);
            padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            background: var(--bg-panel);
            box-shadow: var(--shadow-pop);
        }
        .drawing-status strong { font-weight: 600; }
        .drawing-status span { font-size: var(--text-sm); line-height: var(--leading-sm); color: var(--text-secondary); }
        .drawing-actions { display: flex; gap: var(--space-1); margin-inline-start: auto; }
        .coords {
            grid-row: 2;
            border-top: 1px solid var(--border-region);
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
        #position { grid-column: 3; grid-row: 1; font-family: var(--font-coords); text-align: right; white-space: pre; }
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
    import Messages from "./Messages.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let busyText = $derived(editor.busy === "正在生成地形…" || editor.busy === "正在更新地件…" ? "计算中" : editor.busy ?? "");
    let canvas: HTMLCanvasElement;
    onMount(() => {
        editor.attach(canvas);
        const detach = attachController(editor, canvas);
        const observer = new ResizeObserver(() => {
            editor.map.resize();
            if (editor.project) editor.sections();
        });
        observer.observe(canvas);
        void editor.files.start();
        return () => {
            detach();
            observer.disconnect();
            editor.dispose();
        };
    });
</script>
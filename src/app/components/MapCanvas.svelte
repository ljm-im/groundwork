<section class="map-wrap" aria-label="全图平面图" class:create={editor.tool !== "select"} class:empty={!editor.project}>
    <canvas bind:this={canvas} id="map" tabindex={editor.project ? 0 : -1} aria-label="可编辑的地形平面图"></canvas>
    {#if !editor.project}
        <div class="empty-state">
            {#if !editor.files.supported}<div class="browser-required">需要 Chrome 或 Edge</div>{/if}
            <div class="empty-actions">
                <button disabled={!editor.files.supported || !!editor.busy} onclick={() => editor.files.choose("new")}><Icon name="new" />新建</button>
                <button disabled={!editor.files.supported || !!editor.busy} onclick={() => editor.files.choose("open")}><Icon name="open" />打开</button>
            </div>
        </div>
    {/if}
    {#if editor.drawing}
        <div class="drawing-status" aria-label="绘制状态" role="group">
            <strong>{editor.drawing.title}</strong>
            <span>{editor.drawing.end}</span>
            {#if editor.penNodeMode}
                <div class="pen-modes" role="group" aria-label="单击放置的节点">
                    {#each penModes as [mode, label, icon] (mode)}
                        <button aria-pressed={editor.penNodeMode === mode} data-tip="按 S 切换"
                            disabled={!!editor.busy} onclick={() => editor.choosePenNode(mode)}><Icon name={icon} />{label}</button>
                    {/each}
                </div>
            {/if}
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
        <output id="zoom-value">{displayReading(zoom * 100, 1, "%")}</output>
        <button class="icon-button" id="plus" aria-label="放大" data-tip="放大" onclick={() => editor.project && editor.map.zoomAt(1.4)}><Icon name="plus" /></button>
        <button class="icon-button" id="fit" aria-label="适应" data-tip="适应" onclick={() => editor.project && editor.map.fit(editor.project.terrain)}><Icon name="fit" /></button>
    </div>
    <div class="coords"><span id="busy" role="status" hidden={!editor.busy}>{busyText}</span><span id="mode-hint">{hint}</span><span id="position">{position}</span></div>
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
        #map { min-height: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; cursor: default; }
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
        .pen-modes { display: flex; align-items: center; }
        .pen-modes button { flex: none; border-color: transparent; background: transparent; }
        .pen-modes button[aria-pressed="true"] { background: var(--bg-selected); color: var(--accent); }
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
    import { displayReading } from "../../core/design/display.ts";
    import { type Theme } from "../../render/palette.ts";
    import { drawingHint, positionText } from "../state/mapText.ts";
    import { attachController } from "../state/controller.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";
    import Messages from "./Messages.svelte";

    let { editor, theme }: { editor: session.Editor; theme: Theme } = $props();
    let drawView = $derived(editor.mapView && { view: editor.mapView, theme });
    let busyText = $derived(editor.busy === "正在生成地形…" || editor.busy === "正在更新地件…" ? "计算中" : editor.busy ?? "");
    let hint = $derived(drawingHint(editor.tool, editor.geoDraft, editor.drawing?.end));
    let position = $derived(positionText(editor.cursor, editor.project?.design.fields[editor.displayField]));
    let canvas: HTMLCanvasElement;
    let zoom = $state(1);
    let frame = 0;
    function draw() {
        frame = 0;
        if (!drawView) return;
        const { view, theme } = drawView;
        editor.map.draw(view, theme);
        if (view.issueStart !== undefined && performance.now() - view.issueStart < 1500) requestDraw();
    import { nodeModes } from "../state/inspector.ts";
    }
    function requestDraw() {
        frame ||= requestAnimationFrame(draw);
    }
    $effect(() => {
    const penModes = [nodeModes[0], nodeModes[1]];
        if (drawView) requestDraw();
    });
    onMount(() => {
        editor.attach(canvas, () => {
            zoom = editor.map.zoomFactor();
            requestDraw();
        });
        const detach = attachController(editor, canvas);
        function resize() {
            const { width, height } = canvas.getBoundingClientRect();
            if (!editor.map.resize(width, height, window.devicePixelRatio || 1)) return;
            cancelAnimationFrame(frame);
            draw();
        }
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        void editor.files.start();
        return () => {
            cancelAnimationFrame(frame);
            detach();
            observer.disconnect();
            editor.dispose();
        };
    });
</script>
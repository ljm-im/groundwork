<section class="map-wrap" aria-label="全图平面图" data-busy={!!editor.busy} class:create={editor.tool !== "select"} class:empty={!editor.project}>
    <canvas bind:this={canvas} id="map" data-tip-proxy="mode-hint" tabindex={editor.project ? 0 : -1} aria-label="可编辑的地形平面图"></canvas>
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
    {#if editor.project}
        <div class="map-reading">
            <div class="zoom-tools map-chip" bind:this={zoomChip}>
                <button class="icon-button" id="minus" aria-label="缩小" data-tip="缩小" onclick={() => editor.map.zoomAt(1 / 1.4)}><Icon name="minus" /></button>
                <output id="zoom-value">{displayReading(zoom * 100, 1, "%")}</output>
                <button class="icon-button" id="plus" aria-label="放大" data-tip="放大" onclick={() => editor.map.zoomAt(1.4)}><Icon name="plus" /></button>
                <button class="icon-button" id="fit" aria-label="适应" data-tip="适应" onclick={() => editor.map.fit(editor.project.terrain)}><Icon name="fit" /></button>
            </div>
            <output id="position" class="map-chip" bind:this={positionChip} hidden={!editor.cursor || !field}>
                {#each readings as reading, i (i)}{i ? "  " : ""}{reading.label + " "}<span class="reading"
                    data-min={reading.min} data-max={reading.max}>{reading.value}</span>{/each}
            </output>
        </div>
        <div id="mode-hint" class="map-chip" bind:this={hintChip} data-tip={hint}>{hint}</div>
    {/if}
    <Messages {editor} />
</section>

<style>
    :global {
        .map-wrap {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, max-content) minmax(0, 1fr);
            grid-template-rows: minmax(0, 1fr) auto minmax(24px, auto);
            gap: var(--space-2);
            align-items: end;
            padding: 0 var(--space-3) var(--space-3);
            position: relative;
            background: var(--bg-app);
            overflow: hidden;
            isolation: isolate;
        }
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
        .empty-state .browser-required { font-size: var(--text-lg); line-height: var(--leading-lg); color: var(--text); }
        .empty-actions { display: flex; gap: var(--space-2); color: var(--text); }
        #map { position: absolute; inset: 0; min-height: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; cursor: default; }
        .map-wrap.pan #map { cursor: grab; }
        .map-wrap.drag #map { cursor: grabbing; }
        .map-wrap.create #map { cursor: crosshair; }
        .map-chip {
            z-index: 1;
            border: 1px solid var(--border-region);
            border-radius: var(--radius-lg);
            background: var(--bg-map-chip);
            box-shadow: var(--shadow-pop);
            pointer-events: none;
        }
        .map-reading { grid-area: 2 / 3 / 4 / 4; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-2); pointer-events: none; }
        .zoom-tools {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            padding: var(--space-1);
        }
        .zoom-tools button { pointer-events: auto; }
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
        .pen-modes { display: flex; align-items: center; }
        .pen-modes button { flex: none; border-color: transparent; background: transparent; }
        .pen-modes button[aria-pressed="true"] { background: var(--bg-selected); color: var(--accent); }
        .drawing-actions { display: flex; gap: var(--space-1); margin-inline-start: auto; }
        #mode-hint, #position {
            max-width: 100%;
            height: 24px;
            padding-inline: var(--space-2);
            font-size: var(--text-xs);
            line-height: 22px;
            color: var(--text-secondary);
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #mode-hint { grid-area: 3 / 1; justify-self: start; white-space: nowrap; }
        #position { width: max-content; font-variant-numeric: tabular-nums; white-space: pre; }
        #position .reading { display: inline-block; text-align: right; vertical-align: top; }
        #position .reading::before, #position .reading::after { display: block; height: 0; overflow: hidden; visibility: hidden; }
        #position .reading::before { content: attr(data-min); }
        #position .reading::after { content: attr(data-max); }
        #position[hidden] { display: block; visibility: hidden; }
        @container map-column (max-width: 680px) {
            .map-wrap {
                grid-template-columns: minmax(0, 1fr) max-content;
                grid-template-rows: minmax(0, 1fr) auto auto minmax(24px, auto);
            }
            .map-reading { display: contents; }
            .zoom-tools { grid-area: 3 / 2; justify-self: end; }
            #mode-hint { grid-area: 3 / 1; }
            #position { grid-area: 4 / 1 / 5 / 3; justify-self: end; }
        }
    }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { displayReading } from "../../core/design/display.ts";
    import { type Box } from "../../core/math/geometry.ts";
    import { type Theme } from "../../render/palette.ts";
    import { drawingHint, numberPreviewHint, positionReadings, readingRange } from "../state/mapText.ts";
    import { attachController } from "../state/controller.ts";
    import { nodeModes } from "../state/inspector.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon from "./Icon.svelte";
    import Messages from "./Messages.svelte";

    let { editor, theme }: { editor: session.Editor; theme: Theme } = $props();
    const penModes = [nodeModes[0], nodeModes[1]];
    let drawView = $derived(editor.mapView && { view: editor.mapView, theme });
    let hint = $derived(editor.numberPreviewStep === undefined ? drawingHint(editor.tool, editor.geoDraft, editor.drawing?.end)
        : numberPreviewHint(editor.numberPreviewStep));
    let field = $derived(editor.project?.design.fields[editor.displayField]);
    let range = $derived(readingRange(editor.mapProject?.terrain.fields[editor.displayField]));
    let readingBounds = $state.raw<Box>();
    let readings = $derived(positionReadings(editor.cursor, field, readingBounds, range));
    let canvas: HTMLCanvasElement;
    let hintChip = $state<HTMLDivElement>(), positionChip = $state<HTMLOutputElement>(), zoomChip = $state<HTMLDivElement>();
    let chips = $derived([hintChip, positionChip, zoomChip].filter(el => el !== undefined));
    let zoom = $state(1);
    let frame = 0;
    function draw() {
        frame = 0;
        if (!drawView) return;
        const { view, theme } = drawView;
        const { left: x, top: y } = canvas.getBoundingClientRect();
        editor.map.markObstacles = chips.map(chip => {
            const { left, top, right, bottom } = chip.getBoundingClientRect();
            return [left - x, top - y, right - x, bottom - y] satisfies Box;
        });
        editor.map.draw(view, theme);
        if (view.issueStart !== undefined && performance.now() - view.issueStart < 1500) requestDraw();
    }
    function requestDraw() {
        frame ||= requestAnimationFrame(draw);
    }
    $effect(() => {
        if (drawView) requestDraw();
    });
    $effect(() => {
        if (!chips.length) return;
        const observer = new ResizeObserver(requestDraw);
        for (const chip of chips) observer.observe(chip);
        return () => observer.disconnect();
    });
    function updateReadingBounds() {
        const { map } = editor;
        if (!map.center) return;
        const [left, bottom] = map.world(0, map.height), [right, top] = map.world(map.width, 0);
        readingBounds = [left, bottom, right, top];
    }
    onMount(() => {
        editor.attach(canvas, () => {
            zoom = editor.map.zoomFactor();
            updateReadingBounds();
            requestDraw();
        });
        const detach = attachController(editor, canvas);
        function resize() {
            const { width, height } = canvas.getBoundingClientRect();
            if (!editor.map.resize(width, height, window.devicePixelRatio || 1)) return;
            updateReadingBounds();
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
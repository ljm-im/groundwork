<section class="map-wrap" aria-label="全岛平面图" class:create={editor.tool !== "select"}>
    <canvas bind:this={canvas} id="map" tabindex="0" aria-label="可编辑的海岛地形与路网平面图"></canvas>
    <Toolbar {editor} />
    <div class="legend"><span><i class="key"></i>建筑门</span><span><i class="key gate"></i>院门</span><span><i class="key junction"></i>路口</span><span><i
        class="key via"></i>途经点</span><span><i class="key issue"></i>校验</span><span class="tree-key"><i class="forest"></i>林木</span><span class="tree-key"><i class="avenue"></i>行道树</span><span class="tree-key"><i class="small"></i>小乔木</span><span class="tree-key"><i class="shrub"></i>灌木</span></div>
    <div class="north" aria-label="正北">
        N<svg viewBox="0 0 16 28"><path d="m8 1 7 24-7-6-7 6z" fill="#365d5b"/><path d="m8 3 5.4 19-5.4-4z" fill="#e6f0e5"/></svg></div>
    <div class="scale mono"><span id="scale-bar"></span><span id="scale-text"></span></div>
    <div class="zoom-tools">
        <button id="minus" aria-label="缩小" title="缩小" onclick={() => editor.island && editor.map.zoomAt(1 / 1.4)}><Icon name="minus" /></button>
        <output id="zoom-value">100%</output>
        <button id="plus" aria-label="放大" title="放大" onclick={() => editor.island && editor.map.zoomAt(1.4)}><Icon name="plus" /></button>
        <i class="divider"></i>
        <button id="fit" aria-label="全岛视图" title="全岛视图" onclick={() => editor.island && editor.map.fit()}><Icon name="fit" /></button>
    </div>
    <div class="coords"><span id="mode-hint">{editor.hint}</span><span id="position" class="mono">{editor.position}</span></div>
    <Messages {editor} />
</section>

<style>
    :global {
        .map-wrap {
            position: relative;
            background: #96c3d4;
            overflow: hidden;
            isolation: isolate;
        }
        #map {
            width: 100%;
            height: 100%;
            display: block;
            touch-action: none;
            outline: none;
        }
        .map-wrap.pan #map {
            cursor: grab;
        }
        .map-wrap.drag #map {
            cursor: grabbing;
        }
        .map-wrap.create #map {
            cursor: crosshair;
        }
        .map-tools, .zoom-tools, .scale, .north, .legend, .coords {
            position: absolute;
            z-index: 1;
        }
        .map-tools, .zoom-tools {
            display: flex;
            gap: 2px;
            padding: 4px;
            border: 1px solid #b2c4b9;
            border-radius: 7px;
            background: rgba(253, 254, 247, .97);
            box-shadow: 0 2px 7px #264f5220;
        }
        .map-tools {
            left: 17px;
            top: 15px;
        }
        .map-tools button, .zoom-tools button {
            border: 0;
            background: transparent;
            min-height: 29px;
            padding: 3px 9px;
            font-size: 12px;
        }
        .map-tools button.active {
            background: #244f46;
            color: #fff;
        }
        .map-tools button:hover, .zoom-tools button:hover {
            background: #e0eae1;
        }
        .map-tools button.active:hover {
            background: #244f46;
        }
        .zoom-tools {
            right: 15px;
            bottom: 36px;
            align-items: center;
        }
        .zoom-tools button {
            padding: 3px 5px;
        }
        .zoom-tools output {
            min-width: 32px;
            font-size: 11px;
            text-align: center;
        }
        .zoom-tools .divider {
            margin: 0 2px;
        }
        .north {
            right: 25px;
            top: 18px;
            text-align: center;
            color: #234b4a;
            font: bold 11px/1.2 Consolas, monospace;
            pointer-events: none;
        }
        .north svg {
            display: block;
            margin: 3px auto;
            width: 15px;
            height: 26px;
        }
        .scale {
            left: 18px;
            bottom: 39px;
            display: flex;
            align-items: flex-end;
            gap: 7px;
            color: #244c4e;
            font-size: 11px;
            pointer-events: none;
        }
        #scale-bar {
            border: solid #315759;
            border-width: 0 1.5px 2px;
            height: 6px;
            margin-bottom: 4px;
        }
        .coords {
            bottom: 0;
            left: 0;
            right: 0;
            min-height: 23px;
            padding: 2px 16px;
            display: flex;
            align-items: center;
            gap: 14px;
            font-size: 10px;
            border-top: 1px solid #73988c55;
            background: #f8faf0eb;
            color: #4d6962;
        }
        .coords .mono {
            margin-left: auto;
        }
        .legend {
            left: 17px;
            top: 58px;
            display: flex;
            align-items: center;
            gap: 10px;
            background: #fbfcf0e8;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 10px;
            color: #36574d;
            pointer-events: none;
        }
        .key {
            display: inline-block;
            margin-right: 4px;
            vertical-align: 0;
            width: 7px;
            height: 7px;
            border: 1.5px solid #27524c;
            background: #fffced;
        }
        .key.junction {
            border-radius: 50%;
            background: #27524c;
        }
        .key.gate {
            background: linear-gradient(to bottom, #fffced 39%, #27524c 40% 60%, #fffced 61%);
        }
        .key.via {
            transform: rotate(45deg);
            width: 6px;
            height: 6px;
        }
        .key.issue {
            background: #b7493f;
            border: 0;
            transform: rotate(45deg);
            width: 6px;
            height: 6px;
        }
        @media (max-width:900px) {
            .map-tools {
                left: 9px;
            }
            .legend {
                left: 9px;
            }
        }
        @media (max-width:680px) {
            .map-tools {
                top: 8px;
            }
            .map-tools button {
                min-width: 0;
                padding: 3px 4px;
                gap: 3px;
            }
            .map-tools .icon {
                display: none;
            }
            .legend {
                top: 49px;
            }
            .coords {
                gap: 5px;
                padding: 2px 6px;
            }
        }
        .legend .tree-key {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .tree-key i {
            display: inline-block;
            border-radius: 50%;
            border: 1px solid #506d46;
        }
        .legend:not(.show-trees) .tree-key, .legend.show-trees > span:not(.tree-key) {
            display: none;
        }
        .tree-key .forest {
            width: 10px;
            height: 10px;
            background: #537848;
        }
        .tree-key .avenue {
            width: 9px;
            height: 9px;
            background: #467c67;
        }
        .tree-key .small {
            width: 7px;
            height: 7px;
            background: #81a56d;
        }
        .tree-key .shrub {
            width: 5px;
            height: 5px;
            background: #9eaf74;
        }
    }
</style>

<script lang="ts">
    import { onMount } from "svelte";
    import { attachController } from "../state/controller";
    import * as session from "../state/session.svelte";
    import Icon from "./Icon.svelte";
    import Toolbar from "./Toolbar.svelte";
    import Messages from "./Messages.svelte";
    import { drawSections } from "../../render/sections.js";

    let { editor }: { editor: session.Editor } = $props();
    let canvas: HTMLCanvasElement;
    onMount(() => {
        editor.attach(canvas);
        const detach = attachController(editor, canvas);
        const observer = new ResizeObserver(() => {
            editor.map.resize();
            if (editor.island) drawSections(editor.plots, editor.island);
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
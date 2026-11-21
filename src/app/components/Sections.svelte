<section class="sections" aria-label="地形剖面">
    <div class="section-heading"><strong>地形剖面</strong><small>海拔 / m</small></div>
    <div bind:this={editor.plots} id="plots" class="plots"></div>
</section>

<style>
    :global {
        .sections {
            border-top: 1px solid #c5d1c4;
            background: var(--paper);
            display: grid;
            grid-template-rows: 36px 1fr;
        }
        .section-heading {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 3px 17px 0;
        }
        .section-heading strong {
            font-size: 13px;
        }
        .section-heading small {
            margin-left: auto;
            color: var(--muted);
            font-size: 11px;
        }
        .plots {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 0;
            padding: 0 8px 8px;
        }
        .plot {
            min-width: 0;
            display: flex;
            flex-direction: column;
            padding: 0 10px;
            border-left: 1px solid var(--line);
        }
        .plot:first-child {
            border: 0;
        }
        .plot-title {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 11px;
            color: #586960;
        }
        .plot-title b {
            color: #31594e;
            font: 600 11px Consolas, monospace;
        }
        .plot canvas {
            display: block;
            width: 100%;
            flex: 1;
            min-height: 0;
        }
        @media (max-width:900px) {
            .plot {
                padding: 0 5px;
            }
        }
        @media (max-width:680px) {
            .plots {
                padding: 0 2px 4px;
            }
            .plot-title {
                font-size: 9px;
                gap: 3px;
            }
            .section-heading small {
                font-size: 10px;
            }
        }
        .plots {
            min-height: 0;
            grid-template-rows: minmax(0, 1fr);
        }
        .plot {
            min-height: 0;
            display: grid;
            grid-template-rows: 18px minmax(0, 1fr);
        }
        .plot canvas {
            height: 100%;
            min-width: 0;
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte";
    let { editor }: { editor: session.Editor } = $props();
</script>
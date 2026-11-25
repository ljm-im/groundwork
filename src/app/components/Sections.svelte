<section class="sections" aria-label="地形剖面">
    <div id="plots" class="plots">
        {#each sections as section (section.id)}
            <div class="plot">
                <div class="plot-title"><b>{section.id}—{section.id}′</b><span>{section.label}</span></div>
                <canvas use:plot={{ section, terrain: editor.mapProject.terrain, theme }}></canvas>
            </div>
        {/each}
    </div>
</section>

<style>
    :global {
        .sections { height: 100%; background: var(--bg-panel); display: grid; grid-template-rows: minmax(0, 1fr); }
        .plots { min-height: 0; display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; padding: 0 var(--space-2) var(--space-2); }
        .plot { min-height: 0; min-width: 0; display: grid; grid-template-rows: var(--leading-sm) minmax(0, 1fr); padding: 0 var(--space-2); }
        .plot-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); line-height: var(--leading-sm); color: var(--text-secondary); }
        .plot-title b { margin-inline-end: var(--space-1); color: var(--text); }
        .plot canvas { display: block; width: 100%; height: 100%; min-height: 0; min-width: 0; }
    }
</style>

<script lang="ts">
    import { type Section } from "../../core/design/v5.ts";
    import { type Terrain } from "../../core/design/results.ts";
    import { drawSection } from "../../render/sections.ts";
    import { type Theme } from "../../render/palette.ts";
    import * as session from "../state/session.svelte.ts";
    let { editor, theme }: { editor: session.Editor; theme: Theme } = $props();
    let sections = $derived(editor.mapDesign?.sections.filter(section => editor.selection?.kind !== "section" || section.id === editor.selection.id) ?? []);

    function plot(canvas: HTMLCanvasElement, data: { section: Section; terrain: Terrain; theme: Theme }) {
        const ctx = canvas.getContext("2d")!;
        let frame = 0;
        function draw() {
            frame = 0;
            const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
            if (w < 20 || h < 20) return;
            if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
            if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            drawSection(ctx, w, h, data.section, data.terrain, data.theme);
        }
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            draw();
        });
        observer.observe(canvas);
        frame = requestAnimationFrame(draw);
        return {
            update(next: typeof data) {
                if (next.section === data.section && next.terrain === data.terrain && next.theme === data.theme) return;
                data = next;
                frame ||= requestAnimationFrame(draw);
            },
            destroy() {
                cancelAnimationFrame(frame); observer.disconnect();
            }
        };
    }
</script>
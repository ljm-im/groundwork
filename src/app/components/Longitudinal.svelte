{#if !route || !data}
    <div class="profile-empty">在地图或路网列表里选中一条路</div>
{:else}
    <div class="profile">
        <div class="profile-summary">
            <strong>{route.edge.label}</strong><span>长度 {fmt(route.length)}</span><span>落差 {fmt(route.drop)}</span>
            <span>最陡 {pct(route.maxGrade)} / 上限 {pct(route.edge.maxGrade)}</span>
            <span>台阶 {data.flights.length} 段，{data.flights.reduce((n, f) => n + f.steps, 0)} 级</span><span>纵向放大 {displayNumber(sy / sx, 1, "倍")}</span>
            <span class="profile-legend">━ 路面　┄ 地面</span>
        </div>
        <div class="profile-chart" bind:clientWidth={w} bind:clientHeight={h} role="img" aria-label="道路纵断面图" onpointermove={hover} onpointerleave={leave}>
            <svg width="100%" height="100%">
                {#each data.flights as f (f.from)}
                    <rect x={x(f.from)} y={top} width={Math.max(0, (f.to - f.from) * sx)} height={plotH} class="flight" />
                    <text x={x((f.from + f.to) / 2)} y={top + 10} text-anchor="middle">台阶 {f.steps} 级</text>
                {/each}
                {#each yTicks as t (t)}<line x1={left} x2={w - right} y1={y(t)} y2={y(t)} class="grid" /><text x={left - 6} y={y(t) + 3} text-anchor="end">{displayNumber(t, yStep)}</text>{/each}
                {#each xTicks as t (t)}<line x1={x(t)} x2={x(t)} y1={top} y2={h - bottom} class="grid" /><text x={x(t)} y={h - 5} text-anchor="middle">{displayNumber(t, xStep, "m")}</text>{/each}
                <path d={line(data.ground)} class="ground" /><path d={line(route.h)} class="road" />
                {#each data.excess as span (span.start)}<path d={line(route.h, span.start, span.end)} class="excess" />
                    <text class="warning" x={Math.min(w - right - 74, x(route.s[span.start]) + 3)} y={Math.max(top + 22, y(route.h[span.start]) - 5)}>{pct(span.max)} &gt; {pct(route.edge.maxGrade)}</text>{/each}
                {#each [route.edge.from, route.edge.to] as id, i (i)}
                    {@const px = i ? w - right : left}
                    <line x1={px} x2={px} y1={top} y2={h - bottom} class="end" />
                    <text x={px + (i ? -4 : 4)} y={12} text-anchor={i ? "end" : "start"}>{editor.island.design.nodes.find(n => n.id === id)?.label ?? id}</text>
                {/each}
                {#if reading}<line x1={x(reading.s)} x2={x(reading.s)} y1={top} y2={h - bottom} class="cursor-line" />{/if}
            </svg>
            {#if reading}<output class="profile-reading" style:left={Math.max(3, Math.min(w - 166, x(reading.s) + 10)) + "px"}>
                里程 {fmt(reading.s)}，坡度 {pct(reading.grade)}<br />
                路面 {fmt(reading.road)}，地面 {fmt(reading.ground)}<br />差值 {fmt(reading.gap)}
            </output>{/if}
        </div>
    </div>
{/if}

<style>
    .profile-empty { display: grid; place-items: center; color: var(--text-secondary); }
    .profile { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--bg-panel); }
    .profile-summary { display: flex; gap: var(--space-1) var(--space-3); flex-wrap: wrap; align-items: center; font-size: var(--text-xs); padding: var(--space-1) var(--space-3); color: var(--text-secondary); }
    .profile-summary strong { color: var(--text); }
    .profile-legend { margin-left: auto; }
    .profile-chart { position: relative; min-height: 0; overflow: hidden; }
    svg { display: block; }
    text { fill: var(--text-secondary); font-size: var(--text-xs); }
    path { fill: none; }
    .road, .cursor-line { stroke: var(--accent); stroke-width: 2; }
    .ground { stroke: var(--text-secondary); stroke-dasharray: 6 4; stroke-width: 1.6; }
    .excess { stroke: var(--danger); stroke-width: 2; }
    .warning { fill: var(--warning); }
    .flight { fill: var(--bg-sunken); }
    .grid { stroke: var(--border); stroke-width: .7; }
    .end { stroke: var(--text-secondary); stroke-dasharray: 6 4; }
    .cursor-line { stroke-width: 1; }
    .profile-reading {
        position: absolute;
        top: var(--space-3);
        z-index: var(--z-tip);
        background: var(--bg-panel);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-pop);
        color: var(--text);
        padding: var(--space-1) var(--space-2);
        font-size: var(--text-sm);
        line-height: var(--leading-sm);
        pointer-events: none;
    }
</style>

<script lang="ts">
    import { onDestroy } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { longitudinal, profileReading } from "../../core/roads/longitudinal.ts";
    import { displayNumber } from "../state/numbers.ts";
    import { niceStep } from "../../core/math/interval.ts";
    let { editor }: { editor: session.Editor } = $props();
    let route = $derived.by(() => {
        editor.revision; return ["edge", "via"].includes(editor.selection?.kind ?? "") ? editor.island?.routes.find(r => r.id === editor.selection?.id && r.s.length >= 2) : undefined;
    });
    let data = $derived(route && longitudinal(route, editor.island.terrain, editor.island.graded.heights));
    let w = $state(800), h = $state(180), station = $state<number>();
    const left = 40, right = 20, top = 19, bottom = 20;
    let plotH = $derived(Math.max(1, h - top - bottom));
    let heights = $derived([...(route?.h ?? [0]), ...(data?.ground.filter(v => v !== undefined) ?? [])]);
    let lo = $derived(heights.reduce((a, b) => Math.min(a, b), Infinity)), hi = $derived(heights.reduce((a, b) => Math.max(a, b), -Infinity));
    let yStep = $derived(niceStep((hi - lo || 1) / Math.max(2, Math.floor(plotH / 36))));
    let min = $derived(Math.floor(lo / yStep) * yStep), max = $derived(Math.max(min + yStep, Math.ceil(hi / yStep) * yStep));
    let sx = $derived((w - left - right) / (route?.length || 1)), sy = $derived(plotH / (max - min));
    const x = (s: number) => left + s * sx, y = (v: number) => top + (max - v) * sy;
    function ticks(a: number, b: number, step: number) {
        return Array.from({ length: Math.floor((b - a) / step + .0001) + 1 }, (_, i) => a + i * step);
    }

    let xStep = $derived(niceStep((route?.length || 1) / Math.max(2, w / 95)));
    let xTicks = $derived(ticks(0, route?.length ?? 1, xStep)), yTicks = $derived(ticks(min, max, yStep));
    const fmt = (value?: number) => displayNumber(value ?? NaN, .01, "m"), pct = (value: number) => displayNumber(value * 100, .1, "%");
    function line(values: (number | undefined)[], start = 0, end = values.length - 1) {
        let path = "", move = true;
        for (let i = start; i <= end; i++) {
            const v = values[i]; if (v === undefined) {
                move = true; continue;
            }
            path += (move ? "M" : "L") + x(route!.s[i]) + " " + y(v); move = false;
        }
        return path;
    }
    let reading = $derived(station !== undefined && route ? profileReading(route, station, editor.island.terrain, editor.island.graded.heights, editor.island.resolved.routing.gradeWindow) : undefined);
    function hover(e: PointerEvent) {
        station = (e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left - left) / sx;
        editor.map.profilePoint = reading?.point; editor.map.draw();
    }
    function leave() {
        station = undefined; if (editor.map) {
            editor.map.profilePoint = undefined; editor.map.draw();
        }
    }
    onDestroy(leave);
</script>
{#if !route || !data}
    <div class="profile-empty">在地图或路网列表里选中一条路</div>
{:else}
    <div class="profile">
        <div class="profile-summary">
            <strong>{route.edge.label}</strong><span>长度 {fmt(route.length)} m</span><span>落差 {fmt(route.drop)} m</span>
            <span>最陡 {pct(route.maxGrade)} / 上限 {pct(route.edge.maxGrade)}</span>
            <span>台阶 {data.flights.length} 段，{data.flights.reduce((n, f) => n + f.steps, 0)} 级</span><span>纵向放大 {Math.round(sy / sx)} 倍</span>
            <span class="profile-legend">━ 路面　┄ 地面</span>
        </div>
        <div class="profile-chart" bind:clientWidth={w} bind:clientHeight={h} role="img" aria-label="道路纵断面图" onpointermove={hover} onpointerleave={leave}>
            <svg width="100%" height="100%">
                {#each data.flights as f (f.from)}
                    <rect x={x(f.from)} y={top} width={Math.max(0, (f.to - f.from) * sx)} height={plotH} class="flight" />
                    <text x={x((f.from + f.to) / 2)} y={top + 10} text-anchor="middle">台阶 {f.steps} 级</text>
                {/each}
                {#each yTicks as t (t)}<line x1={left} x2={w - right} y1={y(t)} y2={y(t)} class="grid" /><text x={left - 6} y={y(t) + 3} text-anchor="end">{+t.toPrecision(5)}</text>{/each}
                {#each xTicks as t (t)}<line x1={x(t)} x2={x(t)} y1={top} y2={h - bottom} class="grid" /><text x={x(t)} y={h - 5} text-anchor="middle">{+t.toPrecision(5)} m</text>{/each}
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
                里程 {fmt(reading.s)} m，坡度 {pct(reading.grade)}<br />
                路面 {fmt(reading.road)} m，地面 {fmt(reading.ground)} m<br />差值 {fmt(reading.gap)} m
            </output>{/if}
        </div>
    </div>
{/if}

<style>
    .profile-empty { display: grid; place-items: center; color: light-dark(var(--muted), #adc4ba); font-size: 13px; }
    .profile { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); color: light-dark(var(--ink), #deebe2); background: light-dark(var(--panel), #253b34); }
    .profile-summary { display: flex; gap: 4px 13px; flex-wrap: wrap; align-items: center; font-size: 11px; padding: 5px 13px; color: light-dark(var(--muted), #adc4ba); }
    .profile-summary strong { color: light-dark(var(--ink), #deebe2); }
    .profile-legend { margin-left: auto; }
    .profile-chart { position: relative; min-height: 0; overflow: hidden; }
    svg { display: block; }
    text { fill: light-dark(var(--muted), #adc4ba); font-size: 10px; }
    path { fill: none; }
    .road, .cursor-line { stroke: light-dark(var(--teal), #9bd5c6); stroke-width: 2; }
    .ground { stroke: light-dark(var(--muted), #adc4ba); stroke-dasharray: 5 3; stroke-width: 1.6; }
    .excess { stroke: light-dark(var(--red), #ffa291); stroke-width: 2.4; }
    .warning { fill: light-dark(var(--red), #ffa291); }
    .flight { fill: light-dark(var(--line), #587366); opacity: .45; }
    .grid { stroke: light-dark(var(--line), #587366); stroke-width: .7; }
    .end { stroke: light-dark(var(--muted), #adc4ba); stroke-dasharray: 3 3; }
    .cursor-line { stroke-width: 1; }
    .profile-reading { position: absolute; top: 14px; background: light-dark(var(--panel), #253b34); border: 1px solid light-dark(var(--line), #587366); border-radius: 4px; color: light-dark(var(--ink), #deebe2); padding: 5px 7px; font-size: 10px; pointer-events: none; }
</style>

<script lang="ts">
    import { onDestroy } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { longitudinal, profileReading } from "../../core/roads/longitudinal.ts";
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
    let xTicks = $derived(ticks(0, route?.length ?? 1, niceStep((route?.length || 1) / Math.max(2, w / 95)))), yTicks = $derived(ticks(min, max, yStep));
    const fmt = (v?: number) => v === undefined ? "—" : v.toFixed(2), pct = (v: number) => (100 * v).toFixed(1) + "%";
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
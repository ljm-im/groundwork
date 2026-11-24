import { type Grid } from "../core/math/geometry.ts";
import { type Terrain } from "../core/design/results.ts";
import { clamp, gradient, smooth } from "../core/math/geometry.ts";

import { baseMap } from "./palette.ts";

const colors = baseMap.elevation;
const palette = Array.from({ length: 641 }, (_, i) => {
    const h = i / 20,
        j = colors.findIndex(row => row[0] >= h);
    const a = colors[Math.max(0, j - 1)],
        b = colors[j],
        t = (h - a[0]) / (b[0] - a[0] || 1);
    return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * t);
});

function contours(h: Float32Array, grid: Grid, defined: Uint8Array) {
    const paths = Array.from({ length: 4 }, () => new Path2D()),
        { width, height, step } = grid;
    for (let y = 0; y < height - 1; y++)
        for (let x = 0; x < width - 1; x++) {
            const k = y * width + x,
                a = h[k],
                b = h[k + 1],
                c = h[k + width + 1],
                d = h[k + width];
            if (!defined[k] || !defined[k + 1] || !defined[k + width] || !defined[k + width + 1]) continue;
            const lo = Math.min(a, b, c, d),
                hi = Math.max(a, b, c, d);
            const min = Math.max(0, Math.ceil(lo)),
                max = lo < 0 ? 0 : Math.floor(hi);
            for (let level = min; level <= max && level <= hi; level++) {
                const path = paths[level === 0 ? 0 : level % 10 === 0 ? 3 : level % 2 === 0 ? 2 : 1];
                const px = grid.x(x),
                    py = grid.y(y);
                let paired = false;
                const cross = (u: number, v: number) => {
                    if (paired) path.lineTo(px + step * u, py - step * v);
                    else path.moveTo(px + step * u, py - step * v);
                    paired = !paired;
                };
                if ((a >= level) !== (b >= level)) cross((level - a) / (b - a), 0);
                if ((b >= level) !== (c >= level)) cross(1, (level - b) / (c - b));
                if ((d >= level) !== (c >= level)) cross((level - d) / (c - d), 1);
                if ((a >= level) !== (d >= level)) cross(0, (level - a) / (d - a));
            }
        }
    return paths;
}

type Chart = { raster: HTMLCanvasElement; lines: Path2D[] };
const charts = new WeakMap<Terrain, Chart>();

export function relief(t: Terrain) {
    const cached = charts.get(t);
    if (cached) return cached;
    const { grid, heights: h } = t, { width, height } = grid;
    const raster = document.createElement("canvas");
    raster.width = width;
    raster.height = height;
    const ctx = raster.getContext("2d")!, pixels = ctx.createImageData(width, height), data = pixels.data;
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            const k = j * width + i,
                v = h[k],
                at = k * 4;
            if (!t.defined[k]) {
                data[at + 3] = 0; continue;
            }
            if (v < 0) {
                const depth = clamp(-t.shore[k] * .09 / 5);
                for (let channel = 0; channel < 3; channel++)
                    data[at + channel] = baseMap.waterShallow[channel] - baseMap.waterDepthDelta[channel] * depth;
            }
            else {
                const [dx, dy] = gradient(grid, h, t.defined, k), slope = Math.hypot(dx, dy);
                const rockMix = smooth((slope - .5) / .45) * .5;
                const sand = v < 1.6 && slope < .3 && Math.abs(t.shore[k]) <= 5 ? smooth(1.6 - v) : 0;
                const nx = -dx * 1.7,
                    ny = -dy * 1.7;
                const light = clamp(.45 + .6 * (-nx * .5 + ny * .5 + .7) / Math.sqrt((nx * nx + ny * ny + 1) * .99), .6, 1.13);
                const base = palette[clamp(Math.round(v * 20), 0, 640)];
                for (let channel = 0; channel < 3; channel++)
                    data[at + channel] = ((base[channel] * (1 - rockMix) + baseMap.rock[channel] * rockMix) * (1 - sand) + baseMap.sand[channel] * sand) * light;
            }
            data[at + 3] = 255;
        }
    ctx.putImageData(pixels, 0, 0);
    const chart = { raster, lines: contours(h, grid, t.defined) };
    charts.set(t, chart);
    return chart;
}
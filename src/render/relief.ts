import { heightId } from "../core/design/defaults.ts";
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

const charts = new WeakMap<Terrain, HTMLCanvasElement>();

export function relief(t: Terrain) {
    const cached = charts.get(t);
    if (cached) return cached;
    const { grid } = t, { values: h, defined } = t.fields[heightId], { width, height } = grid;
    const raster = document.createElement("canvas");
    raster.width = width;
    raster.height = height;
    const ctx = raster.getContext("2d")!, pixels = ctx.createImageData(width, height), data = pixels.data;
    for (let j = 0; j < height; j++)
        for (let i = 0; i < width; i++) {
            const k = j * width + i,
                v = h[k],
                at = k * 4;
            if (!defined[k]) {
                data[at + 3] = 0; continue;
            }
            if (v < 0) {
                const depth = clamp(-t.shore[k] * .09 / 5);
                for (let channel = 0; channel < 3; channel++)
                    data[at + channel] = baseMap.waterShallow[channel] - baseMap.waterDepthDelta[channel] * depth;
            }
            else {
                const [dx, dy] = gradient(grid, h, defined, k), slope = Math.hypot(dx, dy);
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
    charts.set(t, raster);
    return raster;
}
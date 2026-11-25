import { heightId } from "../core/design/defaults.ts";
import { type Terrain } from "../core/design/results.ts";
import { clamp, gradient, smooth } from "../core/math/geometry.ts";

import { baseMap, type Theme } from "./palette.ts";

export const maxReliefLight = 1.13;

function slopeLight(nx: number, ny: number) {
    return clamp(.45 + .6 * (-nx * .5 + ny * .5 + .7) / Math.sqrt((nx * nx + ny * ny + 1) * .99), .6, maxReliefLight);
}

const flatLight = slopeLight(0, 0);

export function reliefLight(nx: number, ny: number, shadowGain: number) {
    const light = slopeLight(nx, ny);
    return shadowGain !== 1 && light < flatLight ? Math.max(0, flatLight - (flatLight - light) * shadowGain) : light;
}

const colors = baseMap.elevation;
const palette = Array.from({ length: 641 }, (_, i) => {
    const h = i / 20,
        j = colors.findIndex(row => row[0] >= h);
    const a = colors[Math.max(0, j - 1)],
        b = colors[j],
        t = (h - a[0]) / (b[0] - a[0] || 1);
    return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * t);
});

const charts = { light: new WeakMap<Terrain, OffscreenCanvas>(), dark: new WeakMap<Terrain, OffscreenCanvas>() };

export function relief(t: Terrain, theme: Theme) {
    const cache = charts[theme], cached = cache.get(t);
    if (cached) return cached;
    const { grid } = t, { values: h, defined } = t.fields[heightId], { width, height } = grid;
    const { rasterDim, shadowGain } = baseMap[theme];
    const raster = new OffscreenCanvas(width, height);
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
                    data[at + channel] = (baseMap.waterShallow[channel] - baseMap.waterDepthDelta[channel] * depth) * rasterDim;
            }
            else {
                const [dx, dy] = gradient(grid, h, defined, k), slope = Math.hypot(dx, dy);
                const rockMix = smooth((slope - .5) / .45) * .5;
                const sand = v < 1.6 && slope < .3 && Math.abs(t.shore[k]) <= 5 ? smooth(1.6 - v) : 0;
                const nx = -dx * 1.7,
                    ny = -dy * 1.7;
                const light = reliefLight(nx, ny, shadowGain);
                const base = palette[clamp(Math.round(v * 20), 0, 640)];
                for (let channel = 0; channel < 3; channel++) {
                    const color = (base[channel] * (1 - rockMix) + baseMap.rock[channel] * rockMix) * (1 - sand) + baseMap.sand[channel] * sand;
                    data[at + channel] = Math.min(255, color * light) * rasterDim;
                }
            }
            data[at + 3] = 255;
        }
    ctx.putImageData(pixels, 0, 0);
    cache.set(t, raster);
    return raster;
}
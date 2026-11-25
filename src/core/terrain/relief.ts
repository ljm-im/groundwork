import { heightId } from "../design/defaults.ts";
import { type Terrain } from "../design/results.ts";
import { clamp, gradient, smooth } from "../math/geometry.ts";

export const reliefThemes = {
    light: { rasterDim: 1, shadowGain: 1 },
    dark: { rasterDim: .31, shadowGain: 2 }
} as const;

export const reliefColors = {
    elevation: [
        [0, 226, 231, 200],
        [4, 204, 221, 168],
        [8, 182, 209, 146],
        [13, 160, 192, 124],
        [18, 190, 183, 138],
        [24, 176, 158, 122],
        [32, 154, 134, 104]
    ],
    waterShallow: [186, 221, 230],
    waterDepthDelta: [36, 26, 18],
    rock: [163, 157, 143],
    sand: [232, 222, 190]
} as const;

export const maxReliefLight = 1.13;

function slopeLight(nx: number, ny: number) {
    return clamp(.45 + .6 * (-nx * .5 + ny * .5 + .7) / Math.sqrt((nx * nx + ny * ny + 1) * .99), .6, maxReliefLight);
}

const flatLight = slopeLight(0, 0);

export function reliefLight(nx: number, ny: number, shadowGain: number) {
    const light = slopeLight(nx, ny);
    return shadowGain !== 1 && light < flatLight ? Math.max(0, flatLight - (flatLight - light) * shadowGain) : light;
}

const colors = reliefColors.elevation;
const palette = Array.from({ length: 641 }, (_, i) => {
    const h = i / 20,
        j = colors.findIndex(row => row[0] >= h);
    const a = colors[Math.max(0, j - 1)],
        b = colors[j],
        t = (h - a[0]) / (b[0] - a[0] || 1);
    return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * t);
});

export function writeReliefPixels(t: Terrain, theme: keyof typeof reliefThemes, data: Uint8ClampedArray, cellsPerPixel = 1) {
    const { grid } = t, { values: h, defined } = t.fields[heightId], { width, height } = grid;
    const { rasterDim, shadowGain } = reliefThemes[theme];
    const { waterShallow, waterDepthDelta, rock, sand: sandColor } = reliefColors;
    let at = 0;
    for (let j = 0; j < height; j += cellsPerPixel)
        for (let i = 0; i < width; i += cellsPerPixel, at += 4) {
            const k = j * width + i, v = h[k];
            if (!defined[k]) {
                data.fill(0, at, at + 4);
                continue;
            }
            if (v < 0) {
                const depth = clamp(-t.shore[k] * .09 / 5);
                for (let channel = 0; channel < 3; channel++)
                    data[at + channel] = (waterShallow[channel] - waterDepthDelta[channel] * depth) * rasterDim;
            }
            else {
                const [dx, dy] = gradient(grid, h, defined, k), slope = Math.hypot(dx, dy);
                const rockMix = smooth((slope - .5) / .45) * .5;
                const sand = v < 1.6 && slope < .3 && Math.abs(t.shore[k]) <= 5 ? smooth(1.6 - v) : 0;
                const nx = -dx * 1.7, ny = -dy * 1.7;
                const light = reliefLight(nx, ny, shadowGain);
                const base = palette[clamp(Math.round(v * 20), 0, 640)];
                for (let channel = 0; channel < 3; channel++) {
                    const color = (base[channel] * (1 - rockMix) + rock[channel] * rockMix) * (1 - sand) + sandColor[channel] * sand;
                    data[at + channel] = Math.min(255, color * light) * rasterDim;
                }
            }
            data[at + 3] = 255;
        }
}
import { type FieldSamples } from "../core/design/results.ts";
import { type Grid } from "../core/math/geometry.ts";
import { baseMap, type Theme } from "./palette.ts";

type FieldFill = { defined: Uint8Array; raster: OffscreenCanvas };
const fills = { light: new WeakMap<Float32Array, FieldFill>(), dark: new WeakMap<Float32Array, FieldFill>() };

export function fieldFill({ width, height }: Grid, { values, defined }: FieldSamples, theme: Theme) {
    const cache = fills[theme], cached = cache.get(values);
    if (cached?.defined === defined && cached.raster.width === width && cached.raster.height === height) return cached.raster;
    let low = Infinity, high = -Infinity;
    for (let k = 0; k < values.length; k++) if (defined[k] && Number.isFinite(values[k])) {
        low = Math.min(low, values[k]); high = Math.max(high, values[k]);
    }
    const { rasterDim, fieldRamp: { low: lowColor, high: highColor } } = baseMap[theme];
    const raster = new OffscreenCanvas(width, height);
    const ctx = raster.getContext("2d")!, pixels = ctx.createImageData(width, height);
    for (let k = 0; k < values.length; k++) if (defined[k] && Number.isFinite(values[k])) {
        const t = high > low ? (values[k] - low) / (high - low) : 0, at = k * 4;
        for (let channel = 0; channel < 3; channel++)
            pixels.data[at + channel] = (lowColor[channel] + (highColor[channel] - lowColor[channel]) * t) * rasterDim;
        pixels.data[at + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    cache.set(values, { defined, raster });
    return raster;
}
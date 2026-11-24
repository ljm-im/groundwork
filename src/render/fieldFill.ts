import { type FieldSamples } from "../core/design/results.ts";
import { type Grid } from "../core/math/geometry.ts";
import { baseMap } from "./palette.ts";

const fills = new WeakMap<Float32Array, { defined: Uint8Array; raster: HTMLCanvasElement }>();

export function fieldFill({ width, height }: Grid, { values, defined }: FieldSamples) {
    const cached = fills.get(values);
    if (cached?.defined === defined && cached.raster.width === width && cached.raster.height === height) return cached.raster;
    let low = Infinity, high = -Infinity;
    for (let k = 0; k < values.length; k++) if (defined[k] && Number.isFinite(values[k])) {
        low = Math.min(low, values[k]); high = Math.max(high, values[k]);
    }
    const { light, dark } = baseMap.fieldRamp;
    const raster = document.createElement("canvas");
    raster.width = width; raster.height = height;
    const ctx = raster.getContext("2d")!, pixels = ctx.createImageData(width, height);
    for (let k = 0; k < values.length; k++) if (defined[k] && Number.isFinite(values[k])) {
        const t = high > low ? (values[k] - low) / (high - low) : 0, at = k * 4;
        for (let channel = 0; channel < 3; channel++)
            pixels.data[at + channel] = light[channel] + (dark[channel] - light[channel]) * t;
        pixels.data[at + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    fills.set(values, { defined, raster });
    return raster;
}
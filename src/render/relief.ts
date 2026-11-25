import { type Terrain } from "../core/design/results.ts";
import { writeReliefPixels } from "../core/terrain/relief.ts";
import { type Theme } from "./palette.ts";

export { maxReliefLight, reliefLight } from "../core/terrain/relief.ts";

const charts = { light: new WeakMap<Terrain, OffscreenCanvas>(), dark: new WeakMap<Terrain, OffscreenCanvas>() };

export function relief(t: Terrain, theme: Theme) {
    const cache = charts[theme], cached = cache.get(t);
    if (cached) return cached;
    const { width, height } = t.grid;
    const raster = new OffscreenCanvas(width, height);
    const ctx = raster.getContext("2d")!, pixels = ctx.createImageData(width, height);
    writeReliefPixels(t, theme, pixels.data);
    ctx.putImageData(pixels, 0, 0);
    cache.set(t, raster);
    return raster;
}
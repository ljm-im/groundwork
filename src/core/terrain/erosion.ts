import { type Erosion } from "../design/v5.ts";
import { createGrid, sample, gridSpec, type Grid, type GridSpec } from "../math/geometry.ts";
import { random } from "../math/noise.ts";
import { workBuffer } from "../math/work.ts";

export function erode(grid: Grid, eligible: Uint8Array, surface: Float32Array, config: Erosion, seed: number, shared = false) {
    const { width, height, size, step } = grid;
    const scaled = new Float32Array(size);
    for (let k = 0; k < size; k++) scaled[k] = surface[k] / 30;
    const delta = new Float32Array(workBuffer(size * 4, shared));
    const radius = config.radius / step,
        rim = Math.ceil(radius) + 1,
        offsets = [],
        weights = [];
    let sum = 0;
    for (let y = -Math.floor(radius); y <= radius; y++)
        for (let x = -Math.floor(radius); x <= radius; x++) {
            const d = Math.hypot(x, y);
            if (d <= radius) {
                offsets.push(y * width + x);
                weights.push(1 - d / (radius + .01));
                sum += weights.at(-1)!;
            }
        }
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
    if (width <= 2 * rim || height <= 2 * rim) return delta;
    const supported = (k: number) => eligible[k] && eligible[k + 1] && eligible[k + width] && eligible[k + width + 1];
    const next = random(seed + 7),
        lifetime = Math.ceil(config.lifetime / step);
    const { inertia, capacity, minCapacity, deposition, erosion, evaporation, gravity } = config;
    for (let drop = 0; drop < config.droplets; drop++) {
        let x = next() * (width - 2 * rim) + rim,
            y = next() * (height - 2 * rim) + rim;
        let dx = 0,
            dy = 0,
            speed = 1,
            water = 1,
            sediment = 0;
        for (let age = 0; age < lifetime; age++) {
            const col = Math.floor(x),
                row = Math.floor(y),
                fx = x - col,
                fy = y - row,
                k = row * width + col;
            const a = scaled[k],
                b = scaled[k + 1],
                c = scaled[k + width],
                d = scaled[k + width + 1];
            if (!supported(k)) break;
            const gx = (b - a) * (1 - fy) + (d - c) * fy,
                gy = (c - a) * (1 - fx) + (d - b) * fx;
            const old = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
            dx = dx * inertia - gx * (1 - inertia);
            dy = dy * inertia - gy * (1 - inertia);
            const len = Math.hypot(dx, dy);
            if (len < 1e-7) break;
            dx /= len;
            dy /= len;
            x += dx;
            y += dy;
            if (x < rim || y < rim || x >= width - rim || y >= height - rim) break;
            const j = Math.floor(y) * width + Math.floor(x),
                ax = x % 1,
                ay = y % 1;
            if (!supported(j)) break;
            const dh = scaled[j] * (1 - ax) * (1 - ay) + scaled[j + 1] * ax * (1 - ay) +
        scaled[j + width] * (1 - ax) * ay + scaled[j + width + 1] * ax * ay - old;
            const cap = Math.max(-dh * speed * water * capacity, minCapacity);
            if (sediment > cap || dh > 0) {
                const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposition;
                sediment -= amount;
                scaled[k] += amount * (1 - fx) * (1 - fy);
                scaled[k + 1] += amount * fx * (1 - fy);
                scaled[k + width] += amount * (1 - fx) * fy;
                scaled[k + width + 1] += amount * fx * fy;
            }
            else {
                const amount = Math.min((cap - sediment) * erosion, -dh);
                for (let i = 0; i < offsets.length; i++) {
                    const cell = k + offsets[i];
                    if (!eligible[cell]) continue;
                    const taken = amount * weights[i];
                    scaled[cell] -= taken;
                    sediment += taken;
                }
            }
            speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
            water *= 1 - evaporation;
        }
    }
    for (let k = 0; k < size; k++)
        if (eligible[k]) delta[k] = Math.max(-7, Math.min(3, scaled[k] * 30 - surface[k]));
    return delta;
}

export interface ErosionData { delta?: Float32Array; coarse?: GridSpec; eligible: Uint8Array }

export function prepareErosion(grid: Grid, eligible: Uint8Array, surface: Float32Array, config: Erosion & { spacing: number },
    seed: number, cells: Int32Array, shared: boolean): ErosionData {
    const m = Math.max(1, Math.round(config.spacing / grid.step));
    if (m === 1) return { delta: erode(grid, eligible, surface, config, seed, shared), eligible };
    if (!Number.isFinite(m * grid.step)) return { eligible };

    const width = Math.ceil(grid.width / m), height = Math.ceil(grid.height / m), step = m * grid.step;
    const coarse = createGrid({
        xMin: grid.xMin, yMax: grid.yMax, xMax: grid.xMin + width * step, yMin: grid.yMax - height * step, step
    });
    const sums = new Float64Array(coarse.size), counts = new Uint32Array(coarse.size);
    // Region cells arrive in canvas order, which also preserves the order within each block.
    for (const k of cells) {
        if (!eligible[k]) continue;
        const i = Math.floor((k % grid.width) / m), j = Math.floor(Math.floor(k / grid.width) / m);
        const at = j * coarse.width + i;
        sums[at] += surface[k];
        counts[at]++;
    }
    const heights = new Float32Array(coarse.size), mask = new Uint8Array(coarse.size);
    for (let k = 0; k < coarse.size; k++) if (counts[k]) {
        mask[k] = 1;
        heights[k] = sums[k] / counts[k];
    }
    return { delta: erode(coarse, mask, heights, config, seed, shared), coarse: gridSpec(coarse), eligible };
}

export function erosionSampler({ delta, coarse, eligible }: ErosionData) {
    if (!delta) return () => 0;
    if (!coarse) return (k: number) => delta[k];
    const grid = createGrid(coarse);
    return (k: number, x: number, y: number) => eligible[k] ? sample(grid, delta, x, y) : 0;
}

export function erodeAtSpacing(grid: Grid, eligible: Uint8Array, surface: Float32Array, config: Erosion & { spacing: number },
    seed: number, cells: Int32Array) {
    return erosionSampler(prepareErosion(grid, eligible, surface, config, seed, cells, false));
}
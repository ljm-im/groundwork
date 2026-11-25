import { canvasFrame, type Grid, type GridFrame } from "../math/geometry.ts";

import { measureWork, runBlocks, workBuffer, type WorkPool } from "../math/work.ts";

const farDistance = 1e6;

export function shoreFrame(grid: Grid, region: GridFrame, distance: number): GridFrame {
    const canvas = canvasFrame(grid);
    if (!(distance < farDistance)) return canvas;
    const padding = Math.ceil(distance / grid.step) + 2;
    const left = Math.max(0, region.left - padding), top = Math.max(0, region.top - padding);
    const width = Math.min(grid.width, region.left + region.width + padding) - left;
    const height = Math.min(grid.height, region.top + region.height + padding) - top;
    if (width === grid.width && height === grid.height) return canvas;

    // Bound what a path from outside the frame can contribute, including Float32 rounding at each step.
    let traveled = 0;
    for (let i = 0; i < padding; i++) {
        const next = Math.fround(traveled + grid.step);
        if (next > distance) return { left, top, width, height };
        if (next === traveled) break;
        traveled = next;
    }
    return canvas;
}

export function distanceToOther(frame: GridFrame, step: number, mask: Uint8Array, defined: Uint8Array, side: number, d: Float32Array) {
    const { width, height } = frame, size = width * height;
    const diagonal = 1.4142 * step;
    for (let k = 0; k < size; k++) if (!defined[k] || mask[k] === side) d[k] = farDistance;
    for (const direction of [1, -1]) {
        let k = direction === 1 ? 0 : size - 1;
        for (let row = 0; row < height; row++) {
            let back = k - direction * width;
            for (let col = 0; col < width; col++, k += direction, back += direction) {
                let v = d[k];
                if (!defined[k] || !v) continue;
                if (col) v = Math.min(v, d[k - direction] + step);
                if (row) {
                    v = Math.min(v, d[back] + step);
                    if (col) v = Math.min(v, d[back - direction] + diagonal);
                    if (col + 1 < width) v = Math.min(v, d[back + direction] + diagonal);
                }
                d[k] = v;
            }
        }
    }
}

export type ShoreTask = {
    kind: "shore"; frame: GridFrame; step: number; land: Uint8Array; defined: Uint8Array; distances: [Float32Array, Float32Array];
};

export function shoreDistance(frame: GridFrame, step: number, land: Uint8Array, defined: Uint8Array, pool?: WorkPool) {
    return measureWork(pool, "shoreDistance", () => {
        const size = frame.width * frame.height, shared = !!pool?.size;
        const inside = new Float32Array(workBuffer(size * 4, shared)), outside = new Float32Array(workBuffer(size * 4, shared));
        runBlocks(pool, size, 2, block => distanceToOther(frame, step, land, defined, 1 - block, block ? outside : inside),
            (): ShoreTask => ({ kind: "shore", frame, step, land, defined, distances: [inside, outside] }));
        for (let k = 0; k < size; k++) inside[k] = defined[k] ? (land[k] ? inside[k] : -outside[k]) : 0;
        return inside;
    });
}
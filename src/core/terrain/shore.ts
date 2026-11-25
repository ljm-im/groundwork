import { canvasFrame, type Grid, type GridFrame } from "../math/geometry.ts";

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

function distanceToOther(frame: GridFrame, step: number, mask: Uint8Array, defined: Uint8Array, side: number) {
    const { width, height } = frame, size = width * height;
    const d = new Float32Array(size), diagonal = 1.4142 * step;
    for (let k = 0; k < size; k++) if (!defined[k] || mask[k] === side) d[k] = farDistance;
    for (const direction of [1, -1]) {
        for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++) {
                const k = direction === 1 ? row * width + col : size - 1 - row * width - col;
                let v = d[k];
                if (!defined[k] || !v) continue;
                if (col) v = Math.min(v, d[k - direction] + step);
                if (row) {
                    const back = k - direction * width;
                    v = Math.min(v, d[back] + step);
                    if (col) v = Math.min(v, d[back - direction] + diagonal);
                    if (col + 1 < width) v = Math.min(v, d[back + direction] + diagonal);
                }
                d[k] = v;
            }
    }
    return d;
}

export function shoreDistance(frame: GridFrame, step: number, land: Uint8Array, defined: Uint8Array) {
    const inside = distanceToOther(frame, step, land, defined, 1), outside = distanceToOther(frame, step, land, defined, 0);
    for (let k = 0; k < inside.length; k++) inside[k] = defined[k] ? (land[k] ? inside[k] : -outside[k]) : 0;
    return inside;
}
import { type Grid } from "../math/geometry.ts";

function distanceToOther(grid: Grid, mask: Uint8Array, defined: Uint8Array, side: number) {
    const { size, width, height, step } = grid;
    const d = Float32Array.from(mask, (v, i) => !defined[i] || v === side ? 1e6 : 0),
        diagonal = 1.4142 * step;
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

export function shoreDistance(grid: Grid, land: Uint8Array, defined: Uint8Array) {
    const inside = distanceToOther(grid, land, defined, 1), outside = distanceToOther(grid, land, defined, 0);
    for (let k = 0; k < grid.size; k++) inside[k] = defined[k] ? (land[k] ? inside[k] : -outside[k]) : 0;
    return inside;
}
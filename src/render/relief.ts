import { type Grid } from "../core/math/geometry.ts";
import { type Terrain, type Tree } from "../core/design/results.ts";
import { type Island } from "../core/island.ts";
import { clamp, gradient, smooth } from "../core/math/geometry.ts";

const colors = [
    [0, 226, 231, 200],
    [4, 204, 221, 168],
    [8, 182, 209, 146],
    [13, 160, 192, 124],
    [18, 190, 183, 138],
    [24, 176, 158, 122],
    [32, 154, 134, 104]
];
const palette = Array.from({ length: 641 }, (_, i) => {
    const h = i / 20,
        j = colors.findIndex(row => row[0] >= h);
    const a = colors[Math.max(0, j - 1)],
        b = colors[j],
        t = (h - a[0]) / (b[0] - a[0] || 1);
    return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * t);
});

function contours(h: Float32Array, grid: Grid, defined: Uint8Array, first: number, end: number) {
    const paths = Array.from({ length: 4 }, () => new Path2D()),
        { width, height, step } = grid;
    for (let y = first; y < Math.min(end, height - 1); y++)
        for (let x = 0; x < width - 1; x++) {
            const k = y * width + x,
                a = h[k],
                b = h[k + 1],
                c = h[k + width + 1],
                d = h[k + width];
            if (!defined[k] || !defined[k + 1] || !defined[k + width] || !defined[k + width + 1]) continue;
            const lo = Math.min(a, b, c, d),
                hi = Math.max(a, b, c, d);
            const min = Math.max(0, Math.ceil(lo)),
                max = lo < 0 ? 0 : Math.floor(hi);
            for (let level = min; level <= max && level <= hi; level++) {
                const path = paths[level === 0 ? 0 : level % 10 === 0 ? 3 : level % 2 === 0 ? 2 : 1];
                const px = grid.x(x),
                    py = grid.y(y);
                let paired = false;
                const cross = (u: number, v: number) => {
                    if (paired) path.lineTo(px + step * u, py - step * v);
                    else path.moveTo(px + step * u, py - step * v);
                    paired = !paired;
                };
                if ((a >= level) !== (b >= level)) cross((level - a) / (b - a), 0);
                if ((b >= level) !== (c >= level)) cross(1, (level - b) / (c - b));
                if ((d >= level) !== (c >= level)) cross((level - d) / (c - d), 1);
                if ((a >= level) !== (d >= level)) cross(0, (level - a) / (d - a));
            }
        }
    return paths;
}

interface Chart {
    raster: HTMLCanvasElement; ctx: CanvasRenderingContext2D; pad: number; pixels: ImageData;
    bands: Path2D[][]; heights?: Float32Array; lines?: Path2D[]; trees?: Tree[]; woods?: Record<string, Path2D>;
}
const oceanBorder = new WeakMap<Terrain, Chart>();

function chartPaper(t: Terrain) {
    if (oceanBorder.has(t)) return oceanBorder.get(t)!;
    const { grid: g } = t, pad = 0;
    const raster = document.createElement("canvas");
    raster.width = g.width + 2 * pad;
    raster.height = g.height + 2 * pad;
    const ctx = raster.getContext("2d")!;
    const chart: Chart = { raster, ctx, pad, pixels: ctx.createImageData(g.width, g.height), bands: [] };
    oceanBorder.set(t, chart);
    return chart;
}

export function relief(island: Island) {
    const { terrain: t, graded } = island, { grid } = t, { width, height, step } = grid, h = graded.heights;
    const chart = chartPaper(t), { raster, ctx, pad, pixels } = chart, data = pixels.data;
    const previous = chart.heights, bandHeight = 16;
    let firstDirty = height, lastDirty = 0;
    for (let first = 0; first < height; first += bandHeight) {
        const end = Math.min(first + bandHeight, height);
        // Shading uses adjacent rows and contours use the next row. Include both in the comparison.
        if (previous && (h === previous || !changedRows(h, previous, width, height, first, end))) continue;
        firstDirty = Math.min(firstDirty, first);
        lastDirty = end;
        chart.bands[first / bandHeight] = contours(h, grid, t.defined, first, end);
        for (let j = first; j < end; j++)
            for (let i = 0; i < width; i++) {
                const k = j * width + i,
                    v = h[k],
                    at = k * 4;
                if (!t.defined[k]) { data[at + 3] = 0; continue; }
                if (v < 0) {
                    const depth = clamp(-t.shore[k] * .09 / 5);
                    data[at] = 186 - 36 * depth;
                    data[at + 1] = 221 - 26 * depth;
                    data[at + 2] = 230 - 18 * depth;
                }
                else {
                    const [dx, dy] = gradient(grid, h, t.defined, k), slope = Math.hypot(dx, dy);
                    const rockMix = smooth((slope - .5) / .45) * .5;
                    const sand = v < 1.6 && slope < .3 && Math.abs(t.shore[k]) <= 5 ? smooth(1.6 - v) : 0;
                    const nx = -dx * 1.7,
                        ny = -dy * 1.7;
                    const light = clamp(.45 + .6 * (-nx * .5 + ny * .5 + .7) / Math.sqrt((nx * nx + ny * ny + 1) * .99), .6, 1.13);
                    const base = palette[clamp(Math.round(v * 20), 0, 640)];
                    data[at] = ((base[0] * (1 - rockMix) + 163 * rockMix) * (1 - sand) + 232 * sand) * light;
                    data[at + 1] = ((base[1] * (1 - rockMix) + 157 * rockMix) * (1 - sand) + 222 * sand) * light;
                    data[at + 2] = ((base[2] * (1 - rockMix) + 143 * rockMix) * (1 - sand) + 190 * sand) * light;
                }
                data[at + 3] = 255;
            }
    }
    if (lastDirty > firstDirty) {
        ctx.putImageData(pixels, pad, pad, 0, firstDirty, width, lastDirty - firstDirty);
        chart.lines = Array.from({ length: 4 }, (_, i) => {
            const path = new Path2D();
            for (const band of chart.bands) path.addPath(band[i]);
            return path;
        });
        chart.heights = h;
    }
    if (!chart.trees || chart.trees.length !== island.trees.length || island.trees.some((tree, i) => tree !== chart.trees![i])) {
        chart.woods = treePaths(island.trees);
        chart.trees = island.trees;
    }
    return { raster, margin: pad * step, lines: chart.lines!, woods: chart.woods! };
}

function changedRows(current: Float32Array, previous: Float32Array, width: number, height: number, first: number, end: number) {
    const stop = Math.min(height, end + 1) * width;
    for (let k = Math.max(0, first - 1) * width; k < stop; k++)
        if (current[k] !== previous[k]) return true;
    return false;
}

function treePaths(trees: Tree[]) {
    const woods = Object.fromEntries(["forest", "small", "shrub", "avenue"].map(k => [k, new Path2D()]));
    for (const tree of trees) {
        const [x, y] = tree.point, path = woods[tree.species];
        path.moveTo(x + tree.radius, y);
        path.arc(x, y, tree.radius, 0, 2 * Math.PI);
    }
    return woods;
}
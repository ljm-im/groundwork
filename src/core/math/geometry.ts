/** Cartesian world coordinates in metres, east and north respectively. */
export type Point = [number, number];
export type Box = [number, number, number, number];
export interface GridSpec {
    /** Western grid edge in metres. */
    xMin: number;
    /** Eastern grid edge in metres. */
    xMax: number;
    /** Southern grid edge in metres. */
    yMin: number;
    /** Northern grid edge in metres. */
    yMax: number;
    /** Square cell width in metres. */
    step: number;
}
export type Grid = ReturnType<typeof createGrid>;
export function gridSpec({ xMin, xMax, yMin, yMax, step }: Grid): GridSpec {
    return { xMin, xMax, yMin, yMax, step };
}

export interface GridFrame { left: number; top: number; width: number; height: number }

export function canvasFrame(grid: Grid): GridFrame {
    return { left: 0, top: 0, width: grid.width, height: grid.height };
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const smooth = (x: number) => {
    const t = clamp(x); return t * t * (3 - 2 * t);
};
export const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const mixPoint = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const advance = (p: Point, angle: number, length: number): Point => [p[0] + Math.cos(angle) * length, p[1] + Math.sin(angle) * length];
export const bearing = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);

export function bounds(points: Point[]): Box {
    let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
    for (const [x, y] of points) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1];
}

export function projection(x: number, y: number, a: Point, b: Point) {
    const dx = b[0] - a[0],
        dy = b[1] - a[1];
    return clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1));
}

export function nearest(x: number, y: number, points: Point[], closed = false) {
    let squared = Infinity,
        segment = 0,
        t = 0;
    const end = closed ? points.length : points.length - 1;
    for (let i = 0; i < end; i++) {
        const a = points[i],
            b = points[(i + 1) % points.length];
        const u = projection(x, y, a, b);
        const dx = a[0] + u * (b[0] - a[0]) - x,
            dy = a[1] + u * (b[1] - a[1]) - y;
        const d = dx * dx + dy * dy;
        if (d < squared) {
            squared = d;
            segment = i;
            t = u;
        }
    }
    return { distance: Math.sqrt(squared), segment, t };
}

export function stations(points: Point[]) {
    const s = new Float64Array(points.length);
    for (let i = 1; i < s.length; i++) s[i] = s[i - 1] + distance(points[i - 1], points[i]);
    return s;
}

export function spline(points: Point[], closed: boolean, divisions: number): Point[] {
    const count = points.length,
        out = [];
    const get = (i: number) => points[closed ? (i + count) % count : clamp(i, 0, count - 1)];
    for (let i = 0; i < (closed ? count : count - 1); i++) {
        const a = get(i - 1),
            b = get(i),
            c = get(i + 1),
            d = get(i + 2);
        for (let j = 0; j < divisions; j++) {
            const t = j / divisions;
            out.push([0, 1].map(k => .5 * (2 * b[k] + (-a[k] + c[k]) * t +
        (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t +
        (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t)) as Point);
        }
    }
    if (!closed) out.push(points.at(-1)!.slice() as Point);
    return out;
}

export function createGrid(spec: GridSpec) {
    const { xMin, xMax, yMin, yMax, step } = spec;
    const width = Math.round((xMax - xMin) / step),
        height = Math.round((yMax - yMin) / step);
    const x = (i: number) => xMin + (i + .5) * step,
        y = (j: number) => yMax - (j + .5) * step;
    const col = (px: number) => clamp(Math.floor((px - xMin) / step), 0, width - 1);
    const row = (py: number) => clamp(Math.floor((yMax - py) / step), 0, height - 1);
    return {
        ...spec,
        width,
        height,
        size: width * height,
        x,
        y,
        col,
        row,
        index: (px: number, py: number) => row(py) * width + col(px),
        point: (k: number): Point => [x(k % width), y(Math.floor(k / width))]
    };
}

export function sample(grid: Grid, field: ArrayLike<number>, px: number, py: number) {
    const fx = clamp((px - grid.xMin) / grid.step - .5, 0, grid.width - 1);
    const fy = clamp((grid.yMax - py) / grid.step - .5, 0, grid.height - 1);
    const i = Math.floor(fx), j = Math.floor(fy), k = j * grid.width + i;
    const right = i + 1 < grid.width ? 1 : 0, down = j + 1 < grid.height ? grid.width : 0;
    const ax = fx - i, ay = fy - j;
    return (field[k] * (1 - ax) + field[k + right] * ax) * (1 - ay) +
        (field[k + down] * (1 - ax) + field[k + down + right] * ax) * ay;
}

export function onCanvas(grid: Grid, mask: Uint8Array, x: number, y: number) {
    return x >= grid.xMin && x < grid.xMax && y > grid.yMin && y <= grid.yMax && !!mask[grid.index(x, y)];
}

export function gradient(g: Grid, h: Float32Array, defined: Uint8Array, k: number): Point {
    const i = k % g.width, j = Math.floor(k / g.width);
    const west = i && defined[k - 1] ? k - 1 : k, east = i + 1 < g.width && defined[k + 1] ? k + 1 : k;
    const north = j && defined[k - g.width] ? k - g.width : k, south = j + 1 < g.height && defined[k + g.width] ? k + g.width : k;
    return [(h[east] - h[west]) / ((east - west || 1) * g.step),
        (h[north] - h[south]) / (((south - north) / g.width || 1) * g.step)];
}

// Visit every cell traversed by the segment, including short crossings through a corner.
export function sampleDefined(grid: Grid, field: ArrayLike<number>, mask: Uint8Array, x: number, y: number,
    side?: (x: number, y: number) => boolean): number | undefined {
    if (!onCanvas(grid, mask, x, y)) return undefined;
    const fx = clamp((x - grid.xMin) / grid.step - .5, 0, grid.width - 1);
    const fy = clamp((grid.yMax - y) / grid.step - .5, 0, grid.height - 1);
    const i = Math.floor(fx), j = Math.floor(fy);
    const k = j * grid.width + i, right = i + 1 < grid.width ? 1 : 0, down = j + 1 < grid.height ? grid.width : 0;
    if (!side && mask[k] && mask[k + right] && mask[k + down] && mask[k + right + down]) return sample(grid, field, x, y);
    let sum = 0, weight = 0;
    for (let row = j; row <= Math.min(j + 1, grid.height - 1); row++) {
        for (let col = i; col <= Math.min(i + 1, grid.width - 1); col++) {
            const k = row * grid.width + col, w = (1 - Math.abs(fx - col)) * (1 - Math.abs(fy - row));
            if (w > 0 && mask[k] && (!side || side(grid.x(col), grid.y(row)))) {
                sum += w * field[k]; weight += w;
            }
        }
    }
    return weight ? sum / weight : undefined;
}

// The visitor receives row-major indices relative to the frame.
export function eachCell(grid: Grid, box: Box, margin: number, visit: (index: number, x: number, y: number) => void, frame = canvasFrame(grid)) {
    const left = Math.max(frame.left, grid.col(box[0] - margin)),
        right = Math.min(frame.left + frame.width - 1, grid.col(box[2] + margin));
    const top = Math.max(frame.top, grid.row(box[3] + margin)),
        bottom = Math.min(frame.top + frame.height - 1, grid.row(box[1] - margin));
    for (let j = top; j <= bottom; j++) {
        const y = grid.y(j), offset = (j - frame.top) * frame.width - frame.left;
        for (let i = left; i <= right; i++) visit(offset + i, grid.x(i), y);
    }
}

// Restrict exact segment-distance work to the band where the caller uses it.
export function polygonField(grid: Grid, polygon: Point[], reach: number, frame = canvasFrame(grid),
    dist: Float32Array = new Float32Array(frame.width * frame.height)) {
    const { left, top, width, height } = frame;
    dist.fill(reach);
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
            b = polygon[(i + 1) % polygon.length];
        const dx = b[0] - a[0],
            dy = b[1] - a[1],
            squared = dx * dx + dy * dy || 1;
        eachCell(grid, bounds([a, b]), reach, (k, x, y) => {
            const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / squared);
            const ex = a[0] + t * dx - x,
                ey = a[1] + t * dy - y,
                d = ex * ex + ey * ey;
            if (d < dist[k] * dist[k]) dist[k] = Math.sqrt(d);
        }, frame);
    }
    const box = bounds(polygon), crossings: number[] = [];
    const firstRow = Math.max(top, grid.row(box[3])), lastRow = Math.min(top + height - 1, grid.row(box[1]));
    for (let j = firstRow; j <= lastRow; j++) {
        const y = grid.y(j), offset = (j - top) * width - left;
        crossings.length = 0;
        for (let i = 0, last = polygon.length - 1; i < polygon.length; last = i++) {
            const a = polygon[i],
                b = polygon[last];
            if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        crossings.sort((a, b) => a - b);
        for (let n = 0; n < crossings.length; n += 2) {
            const start = Math.max(left, grid.col(crossings[n])), end = Math.min(left + width - 1, grid.col(crossings[n + 1]));
            for (let i = start; i <= end; i++) {
                if (grid.x(i) >= crossings[n] && grid.x(i) < crossings[n + 1]) dist[offset + i] *= -1;
            }
        }
    }
    return dist;
}
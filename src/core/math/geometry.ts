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

export const radians = Math.PI / 180;
export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const smooth = (x: number) => {
    const t = clamp(x); return t * t * (3 - 2 * t);
};
export const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const mixPoint = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const advance = (p: Point, angle: number, length: number): Point => [p[0] + Math.cos(angle) * length, p[1] + Math.sin(angle) * length];
export const bearing = (a: Point, b: Point) => Math.atan2(b[1] - a[1], b[0] - a[0]);
export const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

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

export function pointAt(points: Point[], s: Float64Array, station: number): Point {
    if (station <= 0) return points[0];
    if (station >= s.at(-1)!) return points.at(-1)!;
    let i = 1;
    while (s[i] < station) i++;
    return mixPoint(points[i - 1], points[i], (station - s[i - 1]) / (s[i] - s[i - 1]));
}

export function resample(points: Point[], step = 1): Point[] {
    if (points.length < 2) return points.map(p => p.slice() as Point);
    const s = stations(points),
        length = s.at(-1)!,
        out = [points[0].slice() as Point];
    let i = 1;
    for (let d = step; d < length - .3 * step; d += step) {
        while (s[i] < d) i++;
        out.push(mixPoint(points[i - 1], points[i], (d - s[i - 1]) / (s[i] - s[i - 1])));
    }
    out.push(points.at(-1)!.slice() as Point);
    return out;
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
export function canvasSegment(g: Grid, mask: Uint8Array, a: Point, b: Point) {
    if (!onCanvas(g, mask, ...a) || !onCanvas(g, mask, ...b)) return false;
    let i = g.col(a[0]), j = g.row(a[1]);
    const endI = g.col(b[0]), endJ = g.row(b[1]), dx = b[0] - a[0], dy = b[1] - a[1];
    const sx = Math.sign(dx), sy = -Math.sign(dy);
    const strideX = g.step / Math.abs(dx), strideY = g.step / Math.abs(dy);
    let tx = sx ? (g.xMin + (i + (sx > 0 ? 1 : 0)) * g.step - a[0]) / dx : Infinity;
    let ty = sy ? (g.yMax - (j + (sy > 0 ? 1 : 0)) * g.step - a[1]) / dy : Infinity;
    while (i !== endI || j !== endJ) {
        const t = Math.min(i === endI ? Infinity : tx, j === endJ ? Infinity : ty);
        if (i !== endI && tx <= t) { i += sx; tx += strideX; }
        if (j !== endJ && ty <= t) { j += sy; ty += strideY; }
        if (!mask[j * g.width + i]) return false;
    }
    return true;
}

// Exclude missing neighbours from interpolation. At a zero-width strip edge only
// centres on the requested side contribute, so a hard step retains its authored value.
export function sampleDefined(grid: Grid, field: ArrayLike<number>, mask: Uint8Array, x: number, y: number,
    side?: (p: Point) => boolean): number | undefined {
    if (!onCanvas(grid, mask, x, y)) return undefined;
    const fx = clamp((x - grid.xMin) / grid.step - .5, 0, grid.width - 1);
    const fy = clamp((grid.yMax - y) / grid.step - .5, 0, grid.height - 1);
    const i = Math.floor(fx), j = Math.floor(fy);
    let sum = 0, weight = 0;
    for (let row = j; row <= Math.min(j + 1, grid.height - 1); row++) {
        for (let col = i; col <= Math.min(i + 1, grid.width - 1); col++) {
            const k = row * grid.width + col, w = (1 - Math.abs(fx - col)) * (1 - Math.abs(fy - row));
            if (w > 0 && mask[k] && (!side || side([grid.x(col), grid.y(row)]))) {
                sum += w * field[k]; weight += w;
            }
        }
    }
    return weight ? sum / weight : undefined;
}

export function eachCell(grid: Grid, box: Box, margin: number, visit: (index: number, x: number, y: number) => void) {
    const left = grid.col(box[0] - margin),
        right = grid.col(box[2] + margin);
    const top = grid.row(box[3] + margin),
        bottom = grid.row(box[1] - margin);
    for (let j = top; j <= bottom; j++) {
        const y = grid.y(j);
        for (let i = left; i <= right; i++) visit(j * grid.width + i, grid.x(i), y);
    }
}

// Restrict exact segment-distance work to the band where the caller uses it.
export function polygonField(grid: Grid, polygon: Point[], reach: number) {
    const dist = new Float32Array(grid.size).fill(reach);
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
        });
    }
    const box = bounds(polygon);
    for (let j = grid.row(box[3]); j <= grid.row(box[1]); j++) {
        const y = grid.y(j),
            crossings = [];
        for (let i = 0, last = polygon.length - 1; i < polygon.length; last = i++) {
            const a = polygon[i],
                b = polygon[last];
            if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        crossings.sort((a, b) => a - b);
        for (let n = 0; n < crossings.length; n += 2) {
            const end = grid.col(crossings[n + 1]);
            for (let i = grid.col(crossings[n]); i <= end; i++) {
                if (grid.x(i) >= crossings[n] && grid.x(i) < crossings[n + 1]) dist[j * grid.width + i] *= -1;
            }
        }
    }
    return dist;
}
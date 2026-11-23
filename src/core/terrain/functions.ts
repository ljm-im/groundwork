import { elevation, type Design, type FieldInput, type GeoNode, type Height, type Point, type Polyline } from "../design/v5.ts";
import { type Region } from "../design/regions.ts";
import { distance, nearest, polygonField, sampleDefined, smooth, spline, stations, type Grid } from "../math/geometry.ts";
import { fbm, noise } from "../math/noise.ts";
import { erode } from "./erosion.ts";
import { flattenPath } from "./path.ts";
import { boundaryDistance } from "./regions.ts";
import { shoreDistance } from "./shore.ts";

export interface FieldState {
    grid: Grid;
    fields: Record<string, Float32Array>;
    defined: Uint8Array;
    heightDefined: Uint8Array;
}
export interface LayerOutput {
    cells: number[];
    values: Float32Array;
    residual?: { height: number; point: Point };
}

function profileLine(line: Polyline, vars: Design["variables"]) {
    const divisions = line.smooth ? 8 : 1, vertices = line.points.map(v => v.p);
    const points = line.smooth ? spline(vertices, false, divisions) : vertices, lengths = stations(points);
    const anchors = line.points.flatMap((v, i) => v.h === undefined ? [] : [{ s: lengths[i * divisions], h: elevation(v.h, vars) }]);
    function value(segment: number, t: number, ease = false) {
        const s = lengths[segment] + t * (lengths[segment + 1] - lengths[segment]);
        const end = anchors.findIndex(a => a.s >= s);
        if (end < 0) return anchors.at(-1)!.h;
        if (!end) return anchors[0].h;
        const a = anchors[end - 1], b = anchors[end], u = (s - a.s) / (b.s - a.s || 1);
        return a.h + (b.h - a.h) * (ease ? smooth(u) : u);
    }
    return { points, divisions, value };
}

export function evaluateLayer(d: Design, n: GeoNode, region: Region, state: FieldState): LayerOutput {
    const { grid, fields, defined, heightDefined } = state, f = n.function, field = n.field ?? "height";
    const source = fields[field], mask = field === "height" ? heightDefined : defined;
    const seed = d.seed + (f.seed ?? 0), n1 = noise(seed), n2 = noise(seed + 101), n3 = noise(seed + 202), n4 = noise(seed + 303);
    const height = (h: Height) => elevation(h, d.variables);
    const input = (v: FieldInput, k: number): number | undefined => {
        if (typeof v === "number") return v;
        if (!(v.field === "height" ? heightDefined : defined)[k]) return;
        return fields[v.field][k] * (v.scale ?? 1) + (v.offset ?? 0);
    };
    const micro = (x: number, y: number) => {
        if (!("noise" in f) || !f.noise) return 0;
        const scale = (f.noise.scale ?? 1) / 9;
        return f.noise.amplitude * n1(x * scale + 50, y * scale - 20);
    };
    const atSea = (level: number) => shoreDistance(grid, Uint8Array.from(fields.height, h => +(h > level)), heightDefined);
    let residual: LayerOutput["residual"];
    type Cell = (k: number, x: number, y: number) => number | undefined;
    function prepare(): Cell {
        switch (f.type) {
            case "ground": case "flat": {
                const value = height(f.value);
                return (_, x, y) => value + micro(x, y);
            }
            case "slope": {
                if (f.kind === "radial") {
                    const base = height(f.value);
                    return (_, x, y) => base + f.rate * (Math.hypot(x - f.center[0], y - f.center[1]) - f.radius) + micro(x, y);
                }
                const line = profileLine(f.line, d.variables);
                return (_, x, y) => {
                    const hit = nearest(x, y, line.points);
                    return line.value(hit.segment, hit.t, f.ease) + micro(x, y);
                };
            }
            case "add": {
                const edges = region.shape.boundary().flat(), amount = height(f.amount);
                return (k, x, y) => source[k] + amount * (f.feather ? smooth(boundaryDistance(edges, x, y) / f.feather) : 1);
            }
            case "coast": {
                const shoreline = flattenPath(f.shore, grid.step / 8).map(s => s.a);
                let reach = 1;
                for (let k = 0; k < grid.size; k++) reach = Math.max(reach, Math.abs(input(f.roughness, k) ?? 0) * 1.7 + 1);
                const edge = polygonField(grid, shoreline, reach), land = new Uint8Array(grid.size);
                for (let k = 0; k < grid.size; k++) {
                    if (!heightDefined[k]) continue;
                    const [x, y] = grid.point(k), dc = -edge[k], harbor = f.harbor;
                    let perturbation = 0;
                    if (Math.abs(dc) < reach) {
                        const attenuation = harbor ? smooth((distance([x, y], harbor.center) - harbor.radius) / harbor.span) : 1;
                        const wx = x + 14 * fbm(n2, x / 70, y / 70, 3), wy = y + 14 * fbm(n2, x / 70 + 5.2, y / 70 + 1.3, 3);
                        perturbation = (input(f.roughness, k) ?? 0) * attenuation * fbm(n1, wx / 38, wy / 38, 5) * 1.7;
                    }
                    land[k] = +(dc + perturbation > 0);
                }
                const shore = shoreDistance(grid, land, heightDefined);
                return k => land[k] ? Math.min(shore[k] * .28, 3.5) : -1 - Math.min(-shore[k] * .09, 5);
            }
            case "mountain": {
                const floor = f.floor === undefined ? -Infinity : height(f.floor);
                const ridges = f.ridges.map(r => ({ ...r, profile: profileLine(r.line, d.variables) }));
                const peaks = f.peaks.map(p => ({ ...p, h: height(p.at.h) }));
                return (k, x, y) => {
                    let h = source[k];
                    if (h <= floor) return h;
                    for (const { profile, widths, widthNoise: w, heightNoise: gain } of ridges) {
                        const hit = nearest(x, y, profile.points), a = profile.points[hit.segment], b = profile.points[hit.segment + 1];
                        const side = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) > 0 ? 0 : 1;
                        const at = (hit.segment + hit.t) / profile.divisions;
                        const breadth = widths[side] * (1 + w[0] * n4(at * w[1], w[2]));
                        const crest = profile.value(hit.segment, hit.t) * (1 + gain[0] * n4(at * gain[1], gain[2]));
                        h = Math.max(h, crest * Math.exp(-((hit.distance / (breadth || 1e-9)) ** 2)));
                    }
                    for (const p of peaks) {
                        const radius = p.radius + p.noise * n3(x / p.scale, y / p.scale);
                        h = Math.max(h, p.h * Math.exp(-((distance([x, y], p.at.p) / (radius || 1e-9)) ** 2)));
                    }
                    const wx = x + 10 * fbm(n2, x / 40 + 3, y / 40, 3), wy = y + 10 * fbm(n2, x / 40, y / 40 + 7, 3);
                    const detail = 1.6 * fbm(n1, wx / 22, wy / 22, 5) + 2.4 * (fbm(n3, wx / 30, wy / 30, 4, true) - .45);
                    return h + detail * (.35 + .65 * smooth(h / 10));
                };
            }
            case "cliff": {
                const sea = height(f.seaLevel ?? 0), shore = atSea(sea);
                return (k, x, y) => source[k] <= sea ? source[k] :
                    Math.min(source[k], Math.max(.4, shore[k] * input(f.factor, k)! * (1 + .3 * n1(x / 12, y / 12))));
            }
            case "erosion": {
                const floor = f.floor === undefined ? -Infinity : height(f.floor);
                const eligible = Uint8Array.from(region.mask, (v, k) => +(!!v && !!mask[k] && source[k] > floor));
                const delta = erode(grid, eligible, source, f, seed);
                return k => source[k] + delta[k] * input(f.strength ?? 1, k)!;
            }
            case "islets": {
                const sea = height(f.seaLevel ?? 0), shore = atSea(sea);
                return (k, x, y) => {
                    const density = input(f.density, k)!;
                    return source[k] <= sea && -shore[k] <= f.reach && density > (f.threshold ?? .45) &&
                        fbm(n3, x / 7, y / 7, 3) > .56 ? 1 + 1.5 * density : source[k];
                };
            }
            case "blend": case "split": case "batter": {
                if (n.construction.type !== "strip") throw new Error(n.id + " 需要条带");
                const [w1, w2] = n.construction.widths;
                return (k, x, y) => {
                    const { s, first, normal: [nx, ny], at: [ax, ay] } = region.shape.cross!([x, y])!;
                    const edge = (w: number, sign: number) => sampleDefined(grid, source, mask, ax + sign * nx * w, ay + sign * ny * w,
                        w ? undefined : ([px, py]) => sign * ((px - ax) * nx + (py - ay) * ny) >= 0);
                    if (f.type === "split") return first ? edge(w1, -1) : edge(w2, 1);
                    const a = edge(w1, -1), b = edge(w2, 1);
                    if (a === undefined || b === undefined) return;
                    if (f.type === "blend") return a + (b - a) * smooth(s);
                    if (f.type !== "batter") return;
                    const highFirst = a >= b, width = w1 + w2, side = highFirst ? 1 : -1, lowWidth = highFirst ? w2 : w1;
                    const drop = Math.abs(a - b) - width * f.grade;
                    if (drop > 1e-6 && (!residual || drop > residual.height))
                        residual = { height: drop, point: [ax + side * nx * lowWidth, ay + side * ny * lowWidth] };
                    const plane = Math.max(a, b) - (highFirst ? s : 1 - s) * width * f.grade;
                    return first === highFirst ? plane : Math.max(source[k], plane);
                };
            }
        }
    }
    const calculate = prepare(), values: number[] = [], cells: number[] = [];
    for (const k of region.cells) {
        if (f.type !== "ground" && !mask[k]) continue;
        const v = calculate(k, grid.x(k % grid.width), grid.y(Math.floor(k / grid.width)));
        if (v !== undefined) {
            cells.push(k);
            values.push(v);
        }
    }
    return { cells, values: Float32Array.from(values), residual };
}

export function applyLayer(output: LayerOutput, n: GeoNode, state: FieldState) {
    const target = state.fields[n.field ?? "height"], ground = n.function.type === "ground";
    output.cells.forEach((k, i) => {
        target[k] = output.values[i];
        if (ground) state.heightDefined[k] = 1;
    });
}
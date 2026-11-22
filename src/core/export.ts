import { type Design, type Building, type Point, type Shape } from "./design/types.ts";
import { type Issue, type Route, type Terrain } from "./design/results.ts";
import { areaBoundary, corners, nodePose, padCell, zonePolygon } from "./design/shapes.ts";
import { type Grid, advance, bounds, clamp, distance, eachCell, mixPoint, pointAt, radians, sample } from "./math/geometry.ts";
import { insidePolygon, perimeter, signedArea } from "./math/polygon.ts";
import { stairSpans } from "./roads/profiles.ts";
import { nearCapsule } from "./roads/proximity.ts";
import { hedgeLines } from "./edit/yards.ts";
import { type Island } from "./island.ts";

export interface ExportSource { sha256: string; commit: string }
type XYZ = [number, number, number];
interface Element { id: string; name: string; type: string; prompt?: string }
interface Door extends Element { position: XYZ; normal: Point; wall?: number }
interface ExportBuilding extends Element {
    shape: Building["shape"]; center: Point; size?: Point; radius?: number; innerRadius?: number;
    longAxis: Point; height: number; color: string; padElevation: number; outline: Point[]; innerOutline?: Point[]; doors: Door[];
}
interface Flight { from: number; to: number; rise: number; steps: number; riser: number; tread: number | null }
interface Road extends Element { width: number; color?: string; centerline: XYZ[]; stairs: boolean[]; flights: Flight[] }
interface Wall extends Element { zone: string; polyline: Point[]; top: number[]; bottom: number[] }
interface Hedge extends Element { yard: string; polyline: XYZ[] }
interface Area extends Element { polygon: Point[]; fill?: string; zone?: string }
interface ExportNode extends Element { position: XYZ; normal?: Point; building?: string; door?: string; yard?: string }
interface ExportTree extends Element { index: number; position: XYZ; radius: number; wooded: boolean }
interface ExportLabel extends Element { position: XYZ }
interface ExportIssue extends Element, Omit<Issue, "point"> { position: XYZ }
interface ExportTerrain {
    origin: Point; step: number; width: number; height: number; rowOrder: "north-to-south";
    heights: number[][]; surface: number[][]; surfaceTypes: Record<number, string>; surfaceRules: typeof surfaceRules;
}
export interface GroundworkExport {
    format: "groundwork-export"; version: 2; source: ExportSource; instructions: string; prompt: string;
    terrain: ExportTerrain; buildings: ExportBuilding[]; roads: Road[]; walls: Wall[]; hedges: Hedge[];
    areas: Area[]; nodes: ExportNode[]; trees: ExportTree[]; labels: ExportLabel[]; issues: ExportIssue[];
}

const maxRiser = .17, minTread = .28;
const instructions = [
    "这是一份户外场地设计。Groundwork 已算好几何，描述由作者撰写。",
    "保持给定的位置、标高、尺寸、朝向和门位。描述决定外观。如与几何冲突，采用几何，并在交付时逐条列出冲突。",
    "先读全岛描述，再读各元素的描述，具体对象的描述优先。只制作设计中列出的内容，不添加描述以外的道具、装饰或额外建筑。",
    "按原样呈现 issues 中的校验问题。遇到描述不足、无法确定做法的地方，采用最简单的实现，并在交付时逐条列明。",
    "交付前实测并报告结果。建筑外墙轮廓与设计的偏差须小于 0.05 m，建筑底面与台基标高相差须小于 0.05 m，树干底部与地形相差须小于 0.05 m。",
    `沿每条非栈桥道路每 1 m 采样，路面顶面应高出其下地形 0.03–0.15 m。台阶按 flights 等分制作，同一段每级等高、等宽，级高不超过 ${maxRiser} m。tread 小于 ${minTread} m 的段照样等分，交付时逐段列出。steps 为 0 的段做成水平面。`,
    "单位为米。X 向东，Y 向北，Z 向上，海平面为 Z = 0。栅格原点是西北角第一个格点的中心，列向东、行向南，行列下标从 0 开始。第 r 行第 c 列的平面坐标为 [origin[0] + c × step, origin[1] − r × step]。格点之间按双线性插值读取地形。"
].join("\n\n");

const surfaceRules = {
    priority: [0, 4, 2, 1, 3],
    seabed: "非陆地且非礁岛",
    paved: "带填色的地形区域、广场院落或建筑台基",
    rock: { islet: true, slopeAbove: 0.75, coastalRockAtLeast: 0.45, coastDistanceAtMost: 8, coastalSlopeAbove: 0.3 },
    sand: { coastDistanceAtMost: 5, rockBelow: 0.35, slopeBelow: 0.3, heightBelow: 2 },
    grass: "其他陆地"
};
function precision(n: number) {
    if (!Number.isFinite(n)) throw new Error("几何包含非有限数值");
    return Number(n.toFixed(3)) || 0;
}
const xy = ([x, y]: Point): Point => [precision(x), precision(y)];
const direction = (angle: number): Point => xy([Math.cos(angle), Math.sin(angle)]);
const description = (o: { prompt?: string }) => o.prompt ? { prompt: o.prompt } : {};
type Ground = (point: Point) => number;
function position(point: Point, ground: Ground): XYZ {
    const [x, y] = xy(point);
    return [x, y, ground([x, y])];
}

function exportTerrain(terrain: Terrain, heights: Float32Array): ExportTerrain {
    const { grid } = terrain, { width, height, step } = grid;
    const paved = new Uint8Array(grid.size);
    for (const zone of terrain.zones) if (zone.fill) for (const k of zone.cells) paved[k] = 1;
    for (const cells of terrain.pads) for (const k of cells) paved[k] = 1;
    for (const { yard, box } of terrain.yards) if (yard.kind === "plaza") {
        eachCell(grid, box, 0, (k, x, y) => {
            if (insidePolygon(yard, [x, y])) paved[k] = 1;
        });
    }
    const heightsOut: number[][] = [], surface: number[][] = [];
    const { rock, sand } = surfaceRules;
    for (let j = 0; j < height; j++) {
        const row: number[] = [], cover: number[] = [];
        const north = Math.max(0, j - 1), south = Math.min(height - 1, j + 1);
        for (let i = 0; i < width; i++) {
            const k = j * width + i, h = heights[k];
            row.push(precision(h));
            if (!terrain.land[k] && !terrain.islet[k]) cover.push(0);
            else if (paved[k]) cover.push(4);
            else {
                const west = Math.max(0, i - 1), east = Math.min(width - 1, i + 1);
                const dx = (heights[j * width + east] - heights[j * width + west]) / ((east - west) * step);
                const dy = (heights[north * width + i] - heights[south * width + i]) / ((south - north) * step);
                const slope = Math.hypot(dx, dy), shore = Math.abs(terrain.dc[k]), stone = terrain.rock[k];
                if (terrain.islet[k] || slope > rock.slopeAbove || stone >= rock.coastalRockAtLeast && shore <= rock.coastDistanceAtMost && slope > rock.coastalSlopeAbove) cover.push(2);
                else if (shore <= sand.coastDistanceAtMost && stone < sand.rockBelow && slope < sand.slopeBelow && h < sand.heightBelow) cover.push(1);
                else cover.push(3);
            }
        }
        heightsOut.push(row);
        surface.push(cover);
    }
    return { origin: xy([grid.x(0), grid.y(0)]), step: precision(step), width, height, rowOrder: "north-to-south",
        surfaceTypes: { 0: "海底", 1: "沙", 2: "岩石", 3: "草", 4: "铺装" }, surfaceRules, heights: heightsOut, surface };
}

function exportFlights(route: Route): Flight[] {
    return stairSpans(route.stairs, route.s).map(({ start, end }) => {
        const from = precision(route.s[start]), to = precision(route.s[end]);
        // Count from the published endpoint elevations in whole millimetres.
        const riseMm = Math.round(precision(route.h[end]) * 1000) - Math.round(precision(route.h[start]) * 1000);
        const rise = riseMm / 1000, steps = Math.ceil(Math.abs(riseMm) / Math.round(maxRiser * 1000));
        return { from, to, rise, steps, riser: steps ? precision(Math.abs(rise) / steps) : 0,
            tread: steps ? precision((to - from) / steps) : null };
    });
}

function circle(center: Point, radius: number): Point[] {
    return Array.from({ length: 48 }, (_, i) => xy(advance(center, i * 2 * Math.PI / 48, radius)));
}

function areaPolygon(shape: Shape): Point[] {
    return zonePolygon(shape.type === "circle" || shape.type === "ellipse" ? { ...shape, samples: 48 } : shape).map(xy);
}

function buildingRing(b: Building, radius: number, includeDoors: boolean) {
    const count = Math.max(48, Math.ceil(Math.PI / Math.acos(clamp(1 - .005 / radius, -1, 1))));
    const angles = Array.from({ length: count }, (_, i) => 2 * Math.PI * i / count);
    if (includeDoors) for (const door of b.doors) angles.push(((door.angle! * radians) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
    const points = angles.sort((a, b) => a - b).map(a => xy(advance(b.center, a, radius)));
    return points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
}

function exportBuilding(design: Design, b: Building, cells: number[], grid: Grid, heights: Float32Array): ExportBuilding {
    const padElevation = precision(heights[padCell(grid, cells, b.center)]);
    const angle = (b.angle ?? 0) * radians + (b.shape === "rect" && b.size![1] > b.size![0] ? Math.PI / 2 : 0);
    const doors: Door[] = b.doors.map(d => {
        const pose = nodePose(design, { type: "door", building: b.id, door: d.id });
        const [x, y] = xy(pose.point);
        return { id: d.id, name: d.name ?? d.id, type: "door", position: [x, y, padElevation], normal: direction(pose.normal!),
            ...(b.shape === "rect" ? { wall: d.wall } : {}) };
    });
    return { id: b.id, name: b.name, type: "building", ...description(b), shape: b.shape, center: xy(b.center),
        ...(b.shape === "rect" ? { size: xy(b.size!) } : { radius: precision(b.radius!) }),
        ...(b.shape === "ring" ? { innerRadius: precision(b.inner!), innerOutline: buildingRing(b, b.inner!, false) } : {}),
        longAxis: direction(angle), height: precision(b.height), color: b.color, padElevation,
        outline: b.shape === "rect" ? corners(b).map(xy) : buildingRing(b, b.radius!, true), doors };
}

interface BoundarySample { at: number; point: Point; inside: number; outside: number }

function roadGaps(points: Point[], s: Float64Array, roads: Road[]) {
    const gaps: Point[] = [];
    for (const road of roads) {
        // A rounded endpoint can move by half a millimetre on each axis.
        const radius = road.width / 2 + .3 + .0015;
        for (let j = road.centerline.length === 1 ? 0 : 1; j < road.centerline.length; j++) {
            const previous = road.centerline[Math.max(0, j - 1)], next = road.centerline[j];
            const p: Point = [previous[0], previous[1]], q: Point = [next[0], next[1]];
            const length = distance(p, q);
            const box = bounds([p, q]);
            for (let i = 1; i < points.length; i++) {
                const a = points[i - 1], b = points[i];
                if (Math.max(a[0], b[0]) < box[0] - radius || Math.min(a[0], b[0]) > box[2] + radius ||
                    Math.max(a[1], b[1]) < box[1] - radius || Math.min(a[1], b[1]) > box[3] + radius || s[i] === s[i - 1]) continue;
                const gap = nearCapsule({ a, b, length: s[i] - s[i - 1], station: s[i - 1] }, { a: p, b: q, length, station: 0 }, radius);
                if (gap) gaps.push(gap);
            }
        }
    }
    const merged: Point[] = [];
    for (const gap of gaps.sort((a, b) => a[0] - b[0])) {
        const last = merged.at(-1);
        if (last && gap[0] <= last[1]) last[1] = Math.max(last[1], gap[1]);
        else merged.push(gap);
    }
    return merged;
}

function retainingWalls(island: Island, roads: Road[]): Wall[] {
    const walls: Wall[] = [], { grid } = island.terrain;
    for (const zone of island.terrain.zones.filter(z => z.retainingWall)) {
        const { points, s, length } = perimeter({ points: zone.polygon });
        if (!length) continue;
        const sign = Math.sign(signedArea(zone.polygon));
        const around = (at: number) => pointAt(points, s, (at % length + length) % length);
        const marks = new Set(s);
        for (let at = 0; at < length; at++) marks.add(at);
        const samples: BoundarySample[] = [...marks].sort((a, b) => a - b).map(at => {
            const point = pointAt(points, s, at), a = around(at - .01), b = around(at + .01);
            const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) + sign * Math.PI / 2;
            return { at, point, inside: sample(grid, island.graded.heights, ...advance(point, angle, .75)),
                outside: sample(grid, island.graded.heights, ...advance(point, angle, -1.5)) };
        });
        const gaps = roadGaps(points, s, roads), runs: BoundarySample[][] = [];
        for (let i = 1; i < samples.length; i++) {
            const a = samples[i - 1], b = samples[i];
            const interpolate = (at: number): BoundarySample => {
                const t = (at - a.at) / (b.at - a.at);
                return { at, point: mixPoint(a.point, b.point, t), inside: a.inside + t * (b.inside - a.inside), outside: a.outside + t * (b.outside - a.outside) };
            };
            const append = (from: number, to: number) => {
                if (to - from < 1e-7) return;
                const run = runs.at(-1);
                if (run && Math.abs(run.at(-1)!.at - from) < 1e-7) run.push(interpolate(to));
                else runs.push([interpolate(from), interpolate(to)]);
            };
            const deltaA = a.inside - a.outside, deltaB = b.inside - b.outside;
            const cuts = [a.at, b.at];
            for (const limit of [-.4, .4]) if ((deltaA - limit) * (deltaB - limit) < 0)
                cuts.push(a.at + (b.at - a.at) * (limit - deltaA) / (deltaB - deltaA));
            cuts.sort((x, y) => x - y);
            for (let k = 1; k < cuts.length; k++) {
                let from = cuts[k - 1];
                const to = cuts[k], middle = interpolate((from + to) / 2);
                if (Math.abs(middle.inside - middle.outside) <= .4) continue;
                for (const [lo, hi] of gaps) {
                    if (lo >= to) break;
                    if (hi <= from) continue;
                    append(from, Math.min(lo, to));
                    from = Math.max(from, hi);
                }
                append(from, to);
            }
        }
        if (runs.length > 1 && runs[0][0].at === 0 && runs.at(-1)!.at(-1)!.at === length)
            runs[0] = runs.pop()!.slice(0, -1).concat(runs[0]);
        for (const [i, run] of runs.entries()) {
            const polyline: Point[] = [], top: number[] = [], bottom: number[] = [];
            for (const item of run) {
                const point = xy(item.point), previous = polyline.at(-1);
                if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
                polyline.push(point);
                top.push(precision(Math.max(item.inside, item.outside)));
                bottom.push(precision(Math.min(item.inside, item.outside)));
            }
            if (polyline.length > 1) walls.push({ id: zone.id + "-wall-" + (i + 1), name: zone.name + "挡土墙 " + (i + 1), type: "wall.retaining", zone: zone.id, polyline, top, bottom });
        }
    }
    return walls;
}

export function exportIsland(island: Island, source: ExportSource): GroundworkExport {
    const { design } = island, { grid } = island.terrain, heights = island.graded.heights;
    const terrain = exportTerrain(island.terrain, heights);
    if (terrain.step === 0) throw new Error("格距小于导出文件可表示的精度");
    const samples = terrain.heights.flat();
    // Attach objects to the same millimetre-rounded lattice that a recipient reads.
    const publishedGrid = { ...grid, xMin: terrain.origin[0] - terrain.step / 2, yMax: terrain.origin[1] + terrain.step / 2, step: terrain.step };
    const ground: Ground = p => precision(sample(publishedGrid, samples, ...p));
    const buildings = design.buildings.map((b, i) => exportBuilding(design, b, island.terrain.pads[i], grid, heights));
    const roads: Road[] = island.routes.map(r => ({
        id: r.id, name: r.edge.name, type: r.edge.levelDeck ? "road.deck" : "road." + r.edge.grade, ...description(r.edge),
        width: precision(r.edge.width), color: r.edge.color, centerline: r.points.map((p, i) => [...xy(p), precision(r.h[i])]), stairs: r.stairs, flights: exportFlights(r)
    }));
    const areas: Area[] = design.zones.map(z => ({ id: z.id, name: z.name, type: "area.zone", ...description(z), fill: z.fill, polygon: areaPolygon(z.shape) }));
    const hedges: Hedge[] = [];
    for (const yard of design.yards ?? []) {
        const boundary = areaBoundary(design, yard), shape = design.zones.find(z => z.id === yard.zone)!.shape;
        areas.push({ id: yard.id, name: yard.name, type: "area." + (yard.kind ?? "yard"), zone: yard.zone,
            polygon: yard.points ? yard.points.map(xy) : areaPolygon(shape) });
        if (yard.kind === "plaza") continue;
        const gates = design.nodes.filter(n => n.type === "gate" && n.yard === yard.id);
        for (const [i, line] of hedgeLines(boundary, gates, design.edges).entries())
            hedges.push({ id: yard.id + "-hedge-" + (i + 1), name: yard.name + "绿篱 " + (i + 1), type: "hedge", yard: yard.id, polyline: line.map(p => position(p, ground)) });
    }
    for (const [i, room] of design.vegetation.rooms.entries()) areas.push({ id: "room-" + (i + 1), name: "林间空间 " + (i + 1), type: "area.room", polygon: circle(room.center, room.radius) });
    const endpointHeights = new Map(island.routes.flatMap(r => [[r.edge.from, r.h[0]], [r.edge.to, r.h.at(-1)!]] as const));
    const nodes: ExportNode[] = design.nodes.map(n => {
        const pose = nodePose(design, n);
        const door = n.type === "door" ? buildings.find(b => b.id === n.building)!.doors.find(d => d.id === n.door) : undefined;
        const [x, y, z] = door?.position ?? position(pose.point, ground);
        return { id: n.id, name: n.name ?? n.id, type: "node." + n.type, ...description(n), position: [x, y, precision(endpointHeights.get(n.id) ?? z)],
            ...(pose.normal != null ? { normal: direction(pose.normal) } : {}), building: n.building, door: n.door, yard: n.yard };
    });
    const trees = island.trees.map((t, i) => ({ id: "tree-" + (i + 1), name: "树 " + (i + 1), type: "tree." + t.species, index: i + 1,
        position: position(t.point, ground), radius: precision(t.radius), wooded: t.wooded }));
    const labels = design.labels.map((label, i) => {
        const b = design.buildings.find(b => b.id === label.building);
        const p: Point = b ? [b.center[0] + (label.offset?.[0] ?? 0), b.center[1] + (label.offset?.[1] ?? 0)] : label.point!;
        return { id: "label-" + (i + 1), name: label.name, type: "label", position: position(p, ground) };
    });
    const issues = island.issues.map(({ point, spans, ...details }, i) => ({ id: "issue-" + (i + 1), name: details.message, type: "issue." + details.kind,
        ...details, position: position(point, ground), spans: spans?.map(s => ({ road: s.road, from: precision(s.from), to: precision(s.to) })) }));
    return { format: "groundwork-export", version: 2, source: { sha256: source.sha256, commit: source.commit }, instructions, prompt: design.prompt ?? "",
        terrain, buildings, roads, walls: retainingWalls(island, roads), hedges, areas, nodes, trees, labels, issues };
}

export function serializeExport(data: GroundworkExport): string {
    // JSON strings escape their newlines. Only structural, numeric arrays can
    // match this multiline pattern, including when descriptions contain JSON.
    return JSON.stringify(data, null, 2).replace(/\[\n\s*([-\d.eE+]+(?:,\n\s*[-\d.eE+]+)*)\n\s*\]/g,
        (_, numbers: string) => "[" + numbers.replace(/,\n\s*/g, ", ") + "]");
}
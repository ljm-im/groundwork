import { type Design, type Building, type Point } from "./design/v5.ts";
import { type Issue, type Route, type Terrain } from "./design/results.ts";
import { corners, padCell } from "./design/shapes.ts";
import { type Grid, advance, clamp, createGrid, radians, sampleDefined } from "./math/geometry.ts";
import { nodePose } from "./design/model.ts";
import { surfaceRules, terrainSurface } from "./terrain/surface.ts";
import { stairSpans } from "./roads/profiles.ts";
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
interface ExportNode extends Element { position: XYZ; normal?: Point; building?: string; door?: string }
interface ExportTree extends Element { index: number; position: XYZ; radius: number; wooded: boolean }
interface ExportLabel extends Element { position: XYZ }
interface ExportIssue extends Element, Omit<Issue, "point"> { position: [number, number, number | null] }
interface ExportTerrain {
    origin: Point; step: number; width: number; height: number; rowOrder: "north-to-south";
    heights: number[][]; defined: number[][]; surface: number[][]; surfaceTypes: Record<number, string>; surfaceRules: typeof surfaceRules;
}
export interface GroundworkExport {
    format: "groundwork-export"; version: 3; source: ExportSource; instructions: string; prompt: string;
    terrain: ExportTerrain; buildings: ExportBuilding[]; roads: Road[]; walls: []; hedges: [];
    areas: []; nodes: ExportNode[]; trees: ExportTree[]; labels: ExportLabel[]; issues: ExportIssue[];
}

const maxRiser = .17, minTread = .28;
const instructions = [
    "这是一份户外场地设计。Groundwork 已算好几何，描述由作者撰写。",
    "保持给定的位置、标高、尺寸、朝向和门位。描述决定外观。如与几何冲突，采用几何，并在交付时逐条列出冲突。",
    "先读全岛描述，再读各元素的描述，具体对象的描述优先。只制作设计中列出的内容，不添加描述以外的道具、装饰或额外建筑。",
    "按原样呈现 issues 中的校验问题。遇到描述不足、无法确定做法的地方，采用最简单的实现，并在交付时逐条列明。",
    "交付前实测并报告结果。建筑外墙轮廓与设计的偏差须小于 0.05 m，建筑底面与台基标高相差须小于 0.05 m，树干底部与地形相差须小于 0.05 m。",
    `沿每条非栈桥道路每 1 m 采样，路面顶面应高出其下地形 0.03–0.15 m。台阶按 flights 等分制作，同一段每级等高、等宽，级高不超过 ${maxRiser} m。tread 小于 ${minTread} m 的段照样等分，交付时逐段列出。steps 为 0 的段做成水平面。`,
    "单位为米。X 向东，Y 向北，Z 向上，海平面为 Z = 0。栅格原点是西北角第一个格点的中心，列向东、行向南，行列下标从 0 开始。第 r 行第 c 列的平面坐标为 [origin[0] + c × step, origin[1] − r × step]。defined 为 1 的格子有地形，0 表示画布外。仅在有效格点间插值。画布外的校验问题以 null 表示没有地面标高。"
].join("\n\n");

function precision(n: number) {
    if (!Number.isFinite(n)) throw new Error("几何包含非有限数值");
    return Number(n.toFixed(3)) || 0;
}
const xy = ([x, y]: Point): Point => [precision(x), precision(y)];
const direction = (angle: number): Point => xy([Math.cos(angle), Math.sin(angle)]);
const description = (o: { prompt?: string }) => o.prompt ? { prompt: o.prompt } : {};
type Ground = (point: Point) => number | undefined;
function position(point: Point, ground: Ground): XYZ | undefined {
    const [x, y] = xy(point), z = ground([x, y]);
    return z === undefined ? undefined : [x, y, precision(z)];
}

function exportTerrain(terrain: Terrain, heights: Float32Array): ExportTerrain {
    const { grid } = terrain, { width, height, step } = grid;
    const cellAt = terrainSurface(terrain, heights);
    const heightsOut: number[][] = [], surface: number[][] = [], defined: number[][] = [];
    for (let j = 0; j < height; j++) {
        const start = j * width;
        defined.push(Array.from(terrain.defined.subarray(start, start + width)));
        heightsOut.push(Array.from(heights.subarray(start, start + width), precision));
        surface.push(Array.from({ length: width }, (_, i) => cellAt(start + i)?.type ?? 0));
    }
    return { origin: xy([grid.x(0), grid.y(0)]), step: precision(step), width, height, rowOrder: "north-to-south",
        surfaceTypes: { 0: "海底", 1: "沙", 2: "岩石", 3: "草", 4: "铺装" }, surfaceRules, heights: heightsOut, defined, surface };
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

export function exportIsland(island: Island, source: ExportSource): GroundworkExport {
    const { design } = island, { grid } = island.terrain, heights = island.graded.heights;
    const terrain = exportTerrain(island.terrain, heights);
    if (terrain.step === 0) throw new Error("格距小于导出文件可表示的精度");
    const samples = Float64Array.from(terrain.heights.flat());
    // Attach objects to the same millimetre-rounded lattice that a recipient reads.
    const xMin = terrain.origin[0] - terrain.step / 2, yMax = terrain.origin[1] + terrain.step / 2;
    const publishedGrid = createGrid({ xMin, xMax: xMin + terrain.width * terrain.step, yMax, yMin: yMax - terrain.height * terrain.step, step: terrain.step });
    const ground: Ground = p => sampleDefined(publishedGrid, samples, island.terrain.defined, ...p);
    const buildings = design.buildings.flatMap((b, i) => island.terrain.pads[i].length ? [exportBuilding(design, b, island.terrain.pads[i], grid, heights)] : []);
    const roads: Road[] = island.routes.filter(r => !r.offCanvas).map(r => ({
        id: r.id, name: r.edge.name, type: r.edge.levelDeck ? "road.deck" : "road." + r.edge.grade, ...description(r.edge),
        width: precision(r.edge.width), color: r.edge.color, centerline: r.points.map((p, i) => [...xy(p), precision(r.h[i])]), stairs: r.stairs, flights: exportFlights(r)
    }));
    const endpointHeights = new Map(island.routes.filter(r => !r.offCanvas).flatMap(r => [[r.edge.from, r.h[0]], [r.edge.to, r.h.at(-1)!]] as const));
    const nodes: ExportNode[] = design.nodes.flatMap((n): ExportNode[] => {
        const pose = nodePose(design, n);
        const door = n.type === "door" ? buildings.find(b => b.id === n.building)?.doors.find(d => d.id === n.door) : undefined;
        const at = door?.position ?? position(pose.point, ground);
        if (!at) return [];
        const [x, y, z] = at;
        return [{ id: n.id, name: n.name ?? n.id, type: "node." + n.type, ...description(n), position: [x, y, precision(endpointHeights.get(n.id) ?? z)],
            ...(pose.normal != null ? { normal: direction(pose.normal) } : {}), building: n.building, door: n.door }];
    });
    const trees: ExportTree[] = [];
    for (const t of island.trees) {
        const at = position(t.point, ground);
        if (!at) continue;
        const index = trees.length + 1;
        trees.push({ id: "tree-" + index, name: "树 " + index, type: "tree." + t.species, index,
            position: at, radius: precision(t.radius), wooded: t.wooded });
    }
    const labels = design.labels.flatMap((label, i) => {
        const b = design.buildings.find(b => b.id === label.building);
        const p: Point = b ? [b.center[0] + (label.offset?.[0] ?? 0), b.center[1] + (label.offset?.[1] ?? 0)] : label.point!;
        const at = position(p, ground);
        return at ? [{ id: "label-" + (i + 1), name: label.name, type: "label", position: at }] : [];
    });
    const issues = island.issues.map(({ point, spans, ...details }, i): ExportIssue => ({ id: "issue-" + (i + 1), name: details.message, type: "issue." + details.kind,
        ...details, position: position(point, ground) ?? [...xy(point), null], spans: spans?.map(s => ({ road: s.road, from: precision(s.from), to: precision(s.to) })) }));
    return { format: "groundwork-export", version: 3, source: { sha256: source.sha256, commit: source.commit }, instructions, prompt: design.prompt ?? "",
        terrain, buildings, roads, walls: [], hedges: [], areas: [], nodes, trees, labels, issues };
}

export function serializeExport(data: GroundworkExport): string {
    // JSON strings escape their newlines. Only structural, numeric arrays can
    // match this multiline pattern, including when descriptions contain JSON.
    return JSON.stringify(data, null, 2).replace(/\[\n\s*([-\d.eE+]+(?:,\n\s*[-\d.eE+]+)*)\n\s*\]/g,
        (_, numbers: string) => "[" + numbers.replace(/,\n\s*/g, ", ") + "]");
}
import { type Design, type GeoFunction, type GeoNode, type Path, type Point, type Strip, type FieldInput, type Height, type Polyline } from "../design/v5.ts";
import { type Terrain } from "../design/results.ts";
import { bounds, sampleDefined } from "../math/geometry.ts";
import { flattenPath } from "../design/path.ts";

export function nextId(used: Iterable<string>, prefix: string) {
    const ids = new Set(used);
    let i = 1;
    while (ids.has(prefix + i)) i++;
    return prefix + i;
}

export function pathsOf(n: GeoNode) {
    return [...(n.construction.type === "free" ? n.construction.paths : []), ...(n.function.type === "coast" ? [n.function.shore] : [])];
}

export function nodeIds(d: Design) {
    const used = new Set(d.geoNodes.flatMap(n => pathsOf(n).flatMap(path => path.nodes.map(v => v.id))));
    let i = 1;
    return () => {
        while (used.has("p" + i)) i++;
        return "p" + i++;
    };
}

export function sampleField(t: Terrain, field: string, p: Point) {
    const values = field === "height" ? t.stackHeights : t.fields[field];
    return values ? sampleDefined(t.grid, values, t.defined, ...p) : undefined;
}
export const tenth = (value: number | undefined) => Math.round((value ?? 0) * 10) / 10;

export function pathCenter(path: Path, tolerance: number): Point {
    const edges = flattenPath(path, tolerance);
    let area = 0, x = 0, y = 0;
    for (const { a, b } of edges) {
        const cross = a[0] * b[1] - b[0] * a[1];
        area += cross; x += (a[0] + b[0]) * cross; y += (a[1] + b[1]) * cross;
    }
    if (Math.abs(area) > 1e-8) return [x / (3 * area), y / (3 * area)];
    const box = bounds(path.nodes.map(v => v.p));
    return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

function insert(d: Design, node: GeoNode, above?: string) {
    const index = d.geoNodes.findIndex(n => n.id === above);
    d.geoNodes.splice(index < 0 ? d.geoNodes.length : index + 1, 0, node);
    return node;
}
function identity(d: Design) {
    const id = nextId(d.geoNodes.map(n => n.id), "geo-");
    return { id, name: "地件 " + id.slice(4) };
}
export function createFree(d: Design, path: Path, field: string, t: Terrain, above?: string) {
    const value = tenth(sampleField(t, field, pathCenter(path, d.grid.step / 8)));
    return insert(d, { ...identity(d), field, construction: { type: "free", paths: [path] }, function: { type: "flat", value } }, above);
}
export function stripConstruction(d: Design, ids: string[], range?: Strip["range"]): Strip {
    const refs = d.geoNodes.filter(n => ids.includes(n.id)).reverse();
    if (refs.length !== 1 && refs.length !== 2) throw Error("先选中一个或两个地件");
    const of: Strip["of"] = refs.length === 1 ? [refs[0].id] : [refs[0].id, refs[1].id];
    if (range) {
        const c = refs[0].construction;
        if (c.type !== "free" || !c.paths.some(p => [range.from, range.to].every(id => p.nodes.some(v => v.id === id))))
            throw Error("请选择同一条路径上的两个节点");
    }
    return { type: "strip", of, widths: of.length === 1 ? [0, 6] : [1, 1], ...(range && { range }) };
}
export function stripRange(points: string[], reverse = false): Strip["range"] {
    if (!points.length) return;
    if (points.length !== 2 || points[0] === points[1]) throw Error("请选择不同的起点和终点");
    return { from: points[+reverse], to: points[+!reverse] };
}
export function createStrip(d: Design, ids: string[], field: string, range?: Strip["range"]) {
    const construction = stripConstruction(d, ids, range);
    return insert(d, { ...identity(d), field, construction, function: { type: ids.length === 1 ? "blend" : "split" } }, construction.of[0]);
}
export function copyGeo(d: Design, original: GeoNode) {
    const copy = structuredClone(original), id = nodeIds(d);
    copy.id = identity(d).id;
    copy.name += " 副本";
    for (const path of pathsOf(copy)) for (const v of path.nodes) v.id = id();
    return insert(d, copy, original.id);
}
export function enableGeo(n: GeoNode, enabled: boolean) {
    if (enabled) delete n.disabled;
    else n.disabled = true;
}
export function reorderGeo(d: Design, id: string, index: number) {
    const stack = d.geoNodes.filter(n => n.id !== id);
    stack.splice(index, 0, d.geoNodes.find(n => n.id === id)!);
    const order = new Map(stack.map((n, i) => [n.id, i]));
    if (stack.some((n, i) => n.construction.type === "strip" && n.construction.of.some(ref => (order.get(ref) ?? -1) >= i)))
        throw Error("条带必须在它引用的地件之上");
    d.geoNodes = stack;
}
export function dependentStrips(d: Design, id: string) {
    const ids = new Set([id]);
    for (const n of d.geoNodes) if (n.construction.type === "strip" && n.construction.of.some(ref => ids.has(ref))) ids.add(n.id);
    return d.geoNodes.filter(n => n.id !== id && ids.has(n.id));
}
export function deleteGeo(d: Design, id: string, cascade: boolean) {
    const refs = dependentStrips(d, id);
    if (refs.length && !cascade) return false;
    d.geoNodes = d.geoNodes.filter(n => n.id !== id && !refs.includes(n));
    return true;
}
export function rangeUsers(d: Design, owner: string, nodes: string[]) {
    return d.geoNodes.filter(n => {
        const c = n.construction;
        if (c.type !== "strip" || !c.range || ![c.range.from, c.range.to].some(id => nodes.includes(id))) return false;
        return d.geoNodes.findLast(v => c.of.some(ref => v.id === ref))?.id === owner;
    });
}

export function declarationUses(d: Design, kind: "variable" | "field", id: string) {
    const uses: string[] = [], key = kind === "variable" ? "var" : "field";
    function visit(value: unknown, at: string) {
        if (!value || typeof value !== "object") return;
        if (Object.hasOwn(value, key) && Reflect.get(value, key) === id) uses.push(at);
        for (const [k, v] of Object.entries(value)) visit(v, at + (Array.isArray(value) ? "[" + k + "]" : "." + k));
    }
    for (const n of d.geoNodes) {
        if (kind === "field" && n.field === id) uses.push(n.name + " · 写入的场");
        visit(n.function, n.name + " · " + n.function.type);
    }
    if (kind === "variable") d.labels.forEach(l => {
        if (l.var === id) uses.push(l.name + " · 标注");
    });
    return uses;
}
export function removeDeclaration(d: Design, kind: "variable" | "field", id: string) {
    if (kind === "field" && id === "height") throw Error("高度是内置场");
    const uses = declarationUses(d, kind, id);
    if (uses.length) throw Error("仍被引用：\n" + uses.join("\n"));
    delete (kind === "variable" ? d.variables : d.fields)[id];
}
export function addVariable(d: Design, value = 0) {
    const id = nextId(Object.keys(d.variables), "v");
    d.variables[id] = { label: id, value, range: [Math.min(0, Math.floor(value)), Math.max(10, Math.ceil(value) + 5), .1] };
    return id;
}
export function addField(d: Design) {
    const id = nextId(Object.keys(d.fields), "field");
    d.fields[id] = { label: id, default: 0 };
    return id;
}
export const bindHeight = (id: string, offset = 0): Height => ({ var: id, offset });
export const bindField = (id: string, scale = 1, offset = 0): FieldInput => ({ field: id, scale, offset });
export function resolved(v: Height | FieldInput, d: Design, readField: (field: string) => number | undefined) {
    if (typeof v === "number") return v;
    return ("var" in v ? d.variables[v.var]?.value ?? 0 : (readField(v.field) ?? 0) * (v.scale ?? 1)) + (v.offset ?? 0);
}

const functions: GeoFunction["type"][] = ["ground", "coast", "mountain", "cliff", "erosion", "islets", "flat", "slope", "add", "noise", "blend", "split", "batter"];
export const fieldFunctions = ["flat", "slope", "add", "noise", "blend", "split"];
export function allowedFunctions(n: GeoNode) {
    return functions.filter(type => (n.construction.type === "strip" ? type !== "ground" : !["split", "blend", "batter"].includes(type)) &&
        ((n.field ?? "height") === "height" || fieldFunctions.includes(type)));
}
export function defaultFunction(type: GeoFunction["type"], value = 0, geometry?: { shore?: Path; line?: Polyline }): GeoFunction | undefined {
    switch (type) {
        case "ground": return { type, value: 0 };
        case "coast": return geometry?.shore && { type, shore: geometry.shore, roughness: 6 };
        case "mountain": return { type, ridges: [], peaks: [] };
        case "cliff": return { type, factor: .6 };
        case "erosion": return { type, droplets: 40000, inertia: .06, capacity: 5, minCapacity: .002, deposition: .25, erosion: .35, evaporation: .02,
            gravity: 6, lifetime: 50, radius: 2, strength: 1, floor: 0 };
        case "islets": return { type, density: .5, reach: 12 };
        case "flat": return { type, value };
        case "slope": return geometry?.line && { type, kind: "path", line: geometry.line };
        case "add": return { type, amount: 1, feather: 3 };
        case "noise": return { type, amplitude: 1, scale: 24, feather: 0 };
        case "blend": case "split": return { type };
        case "batter": return { type, grade: .5 };
    }
}
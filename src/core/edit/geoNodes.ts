import { type Design, type GeoFunction, type GeoNode, type Path, type Point, type Strip, type Polyline } from "../design/v5.ts";
import { defaultInputRange, heightId, isBuiltin } from "../design/defaults.ts";
import { canWrite, fillFunctionParameters, functionTable, stripWidths } from "../design/functionTable.ts";
import { referenceSlots, slotName, type Slot } from "../design/parameters.ts";

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

export const tenth = (value: number | undefined) => Math.round((value ?? 0) * 10) / 10;

function insert(d: Design, node: GeoNode, above?: string) {
    const index = d.geoNodes.findIndex(n => n.id === above);
    d.geoNodes.splice(index < 0 ? d.geoNodes.length : index + 1, 0, node);
    return node;
}
function identity(d: Design) {
    const id = nextId(d.geoNodes.map(n => n.id), "geo-");
    return { id, label: "地件 " + id.slice(4) };
}
export function createFree(d: Design, path: Path, above?: string) {
    return insert(d, { ...identity(d), field: heightId, construction: { type: "free", paths: [path] }, function: defaultFunction("flat") }, above);
}
export function stripConstruction(d: Design, ids: string[], range?: Strip["range"]): Strip<number> {
    const refs = d.geoNodes.filter(n => ids.includes(n.id)).reverse();
    if (refs.length !== 1 && refs.length !== 2) throw Error("先选中一个或两个地件");
    const of: Strip["of"] = refs.length === 1 ? [refs[0].id] : [refs[0].id, refs[1].id];
    if (range) {
        const c = refs[0].construction;
        if (c.type !== "free" || !c.paths.some(p => [range.from, range.to].every(id => p.nodes.some(v => v.id === id))))
            throw Error("请选择同一条路径上的两个节点");
    }
    return { type: "strip", of, widths: stripWidths(of.length === 2).map(p => Number(p.default)) as [number, number], ...(range && { range }) };
}
export function stripRange(points: string[], reverse = false): Strip["range"] {
    if (!points.length) return;
    if (points.length !== 2 || points[0] === points[1]) throw Error("请选择不同的起点和终点");
    return { from: points[+reverse], to: points[+!reverse] };
}
export function createStrip(d: Design, ids: string[], range?: Strip["range"]) {
    const construction = stripConstruction(d, ids, range);
    return insert(d, { ...identity(d), field: heightId, construction, function: { type: ids.length === 1 ? "blend" : "split" } }, construction.of[0]);
}
export function copyGeo(d: Design, original: GeoNode) {
    const copy = structuredClone(original), id = nodeIds(d);
    copy.id = identity(d).id;
    copy.label += " 副本";
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
export function stripUsers(d: Design, id: string) {
    return d.geoNodes.filter(n => n.construction.type === "strip" && n.construction.of.some(ref => ref === id));
}
export function isLastInitializer(d: Design, id: string) {
    const initializers = d.geoNodes.filter(n => functionTable[n.function.type].initial);
    return initializers.length === 1 && initializers[0].id === id;
}

export const requiredInitializer = "设计必须保留至少一个初始地件";

export function deleteGeo(d: Design, id: string) {
    if (!d.geoNodes.some(n => n.id === id)) return;
    if (isLastInitializer(d, id)) throw Error(requiredInitializer);
    requireUnused(removalUses(d, "geo", id));
    d.geoNodes = d.geoNodes.filter(n => n.id !== id);
    return true;
}
export function rangeUsers(d: Design, owner: string, nodes: string[]) {
    return d.geoNodes.filter(n => {
        const c = n.construction;
        if (c.type !== "strip" || !c.range || ![c.range.from, c.range.to].some(id => nodes.includes(id))) return false;
        return d.geoNodes.findLast(v => c.of.some(ref => v.id === ref))?.id === owner;
    });
}

export type RemovalUse = { kind: "parameter"; slot: Slot } | { kind: "strip" | "output"; node: GeoNode };

export function removalUses(d: Design, kind: "geo" | "input" | "field", id: string): RemovalUse[] {
    const uses: RemovalUse[] = referenceSlots(d, kind, id).map(slot => ({ kind: "parameter", slot }));
    if (kind === "geo") return [...uses, ...stripUsers(d, id).map(node => ({ kind: "strip" as const, node }))];
    if (kind === "field") return [...uses, ...d.geoNodes.filter(n => n.field === id).map(node => ({ kind: "output" as const, node }))];
    return uses;
}

export const removalUseName = (use: RemovalUse) => use.kind === "parameter" ? slotName(use.slot) :
    "“" + use.node.label + "”." + (use.kind === "strip" ? "边" : "输出到");

function requireUnused(uses: RemovalUse[]) {
    if (uses.length) throw Error("仍被引用：\n" + uses.map(removalUseName).join("\n"));
}

export function removeDeclaration(d: Design, kind: "input" | "field", id: string) {
    const table = kind === "input" ? d.inputs : d.fields;
    if (isBuiltin(kind, id)) throw Error("“" + table[id].label + "”是内置" + (kind === "field" ? "场" : "输入"));
    requireUnused(removalUses(d, kind, id));
    delete table[id];
}
export function addInput(d: Design, value = 0) {
    const id = nextId(Object.keys(d.inputs), "v");
    d.inputs[id] = { label: "自定义输入 " + id.slice(1), value, range: defaultInputRange(id) };
    return id;
}
export function addField(d: Design) {
    const id = nextId(Object.keys(d.fields), "field");
    d.fields[id] = { label: "场 " + id.slice(5) };
    return id;
}

export function allowedFunctions(n: GeoNode) {
    return (Object.keys(functionTable) as GeoFunction["type"][]).filter(type => {
        const spec = functionTable[type];
        return (!spec.construction || n.construction.type === spec.construction) && canWrite(type, n.field);
    });
}

export function defaultFunction(type: GeoFunction["type"], geometry: { shore?: Path; line?: Polyline; center?: Point; slope?: "path" | "radial" } = {}): GeoFunction {
    let f;
    if (type === "coast") {
        if (!geometry.shore || !geometry.center) throw Error("海岸线或港湾圆心缺失");
        f = { type, shore: geometry.shore, harbor: { center: geometry.center } };
    }
    else if (type === "slope") {
        if (geometry.slope === "radial" && geometry.center) f = { type, kind: "radial", center: geometry.center };
        else if (geometry.line) f = { type, kind: "path", line: geometry.line };
        else throw Error("坡面几何缺失");
    }
    else f = { type };
    return fillFunctionParameters(f as GeoFunction);
}
import { curveGraph, curveSlotName, geoHolderSlots, geoPointSlots, geometryAt, geometryReferenceCount, geometryUsers, isHolderRef, type GeometryHolderSlot, type HolderSlot } from "../design/curveReferences.ts";
import { quotedLocation, type Location } from "../design/problems.ts";
import { type Design, type GeoFunction, type GeoNode, type ClosedCurve, type Curve, type CurveHolder, type Point, type PointHolder, type Strip } from "../design/v5.ts";
import { defaultInputRange, heightId, isBuiltin } from "../design/defaults.ts";
import { canWrite, fillFunctionParameters, functionTable, stripWidths } from "../design/functionTable.ts";
import { parameters, parameterUsers, readAt, referenceSlots, slotName, writeAt, type Slot } from "../design/parameters.ts";

export function nextId(used: Iterable<string>, prefix: string) {
    const ids = new Set(used);
    let i = 1;
    while (ids.has(prefix + i)) i++;
    return prefix + i;
}

export function nodeIds(d: Design) {
    const used = new Set(Object.values(d.geometry).flatMap(item => "curve" in item ? item.curve.nodes.map(v => v.id) : []));
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
export function createOutline(d: Design, path: ClosedCurve, above?: string) {
    return insert(d, { ...identity(d), field: heightId, construction: { type: "outline", outlines: [{ curve: addGeometry(d, { curve: path }) }] }, function: defaultFunction(d, "flat") }, above);
}
export function stripConstruction(d: Design, ids: string[], range?: Strip["range"]): Strip<number> {
    const refs = d.geoNodes.filter(n => ids.includes(n.id)).reverse();
    if (refs.length !== 1 && refs.length !== 2) throw Error("先选中一个或两个地件");
    const of: Strip["of"] = refs.length === 1 ? [refs[0].id] : [refs[0].id, refs[1].id];
    if (range) {
        const c = refs[0].construction;
        const graph = curveGraph(d);
        if (c.type !== "outline" || !c.outlines.some((_, i) => {
            const slot = graph.slots.get("geo:" + refs[0].id + ".construction.outlines." + i + ".curve")!;
            return [range.from, range.to].every(id => graph.source(slot).curve.nodes.some(v => v.id === id));
        }))
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
export function retargetCopiedReferences(formula: string, from: string, to: string, remap: (key: string, next: string) => string) {
    return formula.replace(/\{([^{}]+)\}/g, (text, key: string) =>
        key === from || key.startsWith(from + ".") ? "{" + remap(key, to + key.slice(from.length)) + "}" : text);
}

export function copyGeo(d: Design, original: GeoNode) {
    const copy = structuredClone(original);
    copy.id = identity(d).id;
    copy.label += " 副本";

    const from = "geo:" + original.id, to = "geo:" + copy.id, graph = curveGraph(d);
    const slots = parameters(d, undefined, graph, true);
    const inside = (at: Location | undefined) => at?.kind === "geo" && at.id === original.id;
    const holders = geoHolderSlots(copy, d.geoNodes.length);
    for (const holder of holders) if (isHolderRef(holder.value))
        holder.value.ref = retargetCopiedReferences(holder.value.ref, from, to, (key, next) =>
            inside(graph.holders.get(key)?.location) ? next : key);
    copyHeldGeometry(d, [
        ...holders.flatMap(({ value }) => isHolderRef(value) ? [] : [value]),
        ...geoPointSlots(copy, d.geoNodes.length).map(slot => slot.value)
    ], inside);
    for (const slot of slots.values()) if (slot.owner === "geo" && slot.id === original.id) {
        const { path } = slot.location, value = readAt(copy, path);
        if (typeof value === "string") writeAt(copy, path, retargetCopiedReferences(value, from, to, (key, next) =>
            inside((slots.get(key) ?? graph.parameterHolder(key))?.location) ? next : key));
    }
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

export type RemovalUse = { kind: "parameter"; slot: Slot } | { kind: "curve"; slot: HolderSlot } |
    { kind: "geometry"; slot: GeometryHolderSlot } |
    { kind: "strip" | "output"; node: GeoNode };

export function curveRemovalUses(d: Design, matches: (slot: HolderSlot) => boolean): RemovalUse[] {
    return [...curveGraph(d).references()].flatMap(({ slot, target }) =>
        matches(target) && !matches(slot) ? [{ kind: "curve" as const, slot }] : []);
}

export function parameterRemovalUses(d: Design, match: (location: Location) => boolean): RemovalUse[] {
    return [...curveRemovalUses(d, slot => match(slot.location)), ...parameterUsers(d, match).map(slot => ({ kind: "parameter" as const, slot }))];
}

export function removalUses(d: Design, kind: "geo" | "input" | "field" | "geometry" | "mark", id: string): RemovalUse[] {
    if (kind === "geometry") return (geometryUsers(d).get(id) ?? []).map(slot => ({ kind, slot }));
    const uses: RemovalUse[] = referenceSlots(d, kind, id)
        .map(slot => ({ kind: "parameter", slot }));
    if (kind === "geo") uses.push(...curveRemovalUses(d, slot => slot.location.kind === "geo" && slot.location.id === id));
    if (kind === "geo") return [...uses, ...stripUsers(d, id).map(node => ({ kind: "strip" as const, node }))];
    if (kind === "field") return [...uses, ...d.geoNodes.filter(n => n.field === id).map(node => ({ kind: "output" as const, node }))];
    return uses;
}

export const removalUseName = (use: RemovalUse) => use.kind === "parameter" ? slotName(use.slot) :
    use.kind === "curve" || use.kind === "geometry" ? quotedLocation(curveSlotName(use.slot)) : quotedLocation(use.node.label, use.kind === "strip" ? "边" : "输出到");

export function requireUnused(uses: RemovalUse[]) {
    if (uses.length) throw Error("仍被引用：\n" + uses.map(removalUseName).join("\n"));
}

export function removeDeclaration(d: Design, kind: "input" | "field" | "geometry", id: string) {
    const table = kind === "input" ? d.inputs : kind === "field" ? d.fields : d.geometry;
    if (kind !== "geometry" && isBuiltin(kind, id)) throw Error("“" + table[id].label + "”是内置" + (kind === "field" ? "场" : "输入"));
    requireUnused(removalUses(d, kind, id));
    if (kind === "geometry") {
        if (!d.geometry[id].independent) throw Error("只能删除独立的几何对象");
        setGeometryIndependent(d, id, false);
    }
    else delete table[id];
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

export function addGeometry(d: Design, shape: { point: Point } | { curve: Curve }, independent = false) {
    const kind = "point" in shape ? "point" : "curve", prefix = kind === "point" ? "点 " : "曲线 ";
    const id = nextId(Object.keys(d.geometry), kind + "-");
    const label = nextId(Object.values(d.geometry).map(item => item.label), prefix);
    d.geometry[id] = { ...shape, label, ...(independent && { independent: true as const }) };
    return id;
}

export function copyGeometry(d: Design, id: string, independent = false) {
    const item = geometryAt(d, id)!;
    return addGeometry(d, "point" in item ? { point: structuredClone(item.point) } : { curve: structuredClone(item.curve) }, independent);
}

export function copyHeldGeometry(d: Design, holders: (PointHolder | CurveHolder)[], inside: (location: Location) => boolean) {
    const users = geometryUsers(d), copies = new Map<string, string>();
    for (const holder of holders) {
        const id = "point" in holder ? holder.point : holder.curve;
        if (geometryAt(d, id)?.independent || !users.get(id)?.every(user => inside(user.location))) continue;
        const copy = copies.get(id) ?? copyGeometry(d, id);
        copies.set(id, copy);
        if ("point" in holder) holder.point = copy;
        else holder.curve = copy;
    }
}

export function setGeometryIndependent(d: Design, id: string, independent: boolean) {
    const item = geometryAt(d, id)!;
    if (independent) item.independent = true;
    else delete item.independent;
}

export function removeUnusedGeometry(before: Design, after: Design) {
    const oldUsers = geometryUsers(before), remaining = geometryUsers(after);
    for (const id of Object.keys(before.geometry))
        if (geometryReferenceCount(before, id, oldUsers) > 0 && geometryReferenceCount(after, id, remaining) === 0)
            delete after.geometry[id];
}

export function holdPoint(d: Design, point: Point): PointHolder {
    return { point: addGeometry(d, { point }) };
}

export function allowedFunctions(n: GeoNode) {
    return (Object.keys(functionTable) as GeoFunction["type"][]).filter(type => {
        const spec = functionTable[type];
        return (!spec.construction || n.construction.type === spec.construction) && canWrite(type, n.field);
    });
}

export function defaultFunction(d: Design, type: GeoFunction["type"], geometry: { shore?: ClosedCurve; center?: Point; slope?: "path" | "radial"; id?: string } = {}): GeoFunction {
    let f;
    if (type === "coast") {
        if (!geometry.shore || !geometry.center) throw Error("海岸线或港湾圆心缺失");
        f = { type, shore: { curve: addGeometry(d, { curve: geometry.shore }) }, harbor: { center: holdPoint(d, geometry.center) } };
    }
    else if (type === "slope") {
        if (!geometry.center) throw Error("坡面圆心缺失");
        f = { type, kind: geometry.slope ?? "path", center: holdPoint(d, geometry.center), lines: [] };
    }
    else f = { type };
    if (type === "erosion" && !geometry.id) throw Error("侵蚀需要地件 ID");
    return fillFunctionParameters(f as GeoFunction, [], geometry.id);
}
import { type Address } from "./address.ts";
import { check, quotedLocation, type Location } from "./problems.ts";
import { type Curve, type CurveHolder, type Design, type GeoFunction, type GeoNode, type Held, type HolderRef, type NodeQuantity,
    type NodeRecords, type Point, type PointHolder, type ProfileCurve } from "./v5.ts";

const holderLabels = { outline: "轮廓", ridge: "山脊", valley: "山谷", shore: "海岸线", line: "坡线" } as const;
type HolderKind = keyof typeof holderLabels;
type HolderParameters = NodeRecords & { ease?: boolean };
type HolderValue = Held<HolderParameters>;
export const profileGroups = {
    ridges: { kind: "ridge", label: "山脊", tool: "ridge", curve: "山脊线" },
    valleys: { kind: "valley", label: "山谷", tool: "valley", curve: "山谷线" },
    lines: { kind: "line", label: "坡线", tool: "slopeLine", curve: "坡线" }
} as const;
export type ProfileGroup = keyof typeof profileGroups;
export function profileGroupForTool(tool: string) {
    return (Object.keys(profileGroups) as ProfileGroup[]).find(group => profileGroups[group].tool === tool);
}
export type FunctionMember = ProfileGroup | "peaks";
export const memberLabel = (group: FunctionMember) => group === "peaks" ? "山峰" : profileGroups[group].label;
export const profileGroupsFor = (f: Pick<GeoFunction, "type"> & { kind?: string }): ProfileGroup[] =>
    f.type === "mountain" ? ["ridges", "valleys"] : f.type === "slope" && f.kind === "path" ? ["lines"] : [];
export const profileIndex = (f: { type: GeoFunction["type"]; ridges?: readonly unknown[] }, group: ProfileGroup, index: number) =>
    -1 - index - (group === "valleys" ? f.ridges?.length ?? 0 : 0);
export const nodeQuantities = (kind: HolderKind): readonly NodeQuantity[] =>
    kind === "ridge" || kind === "valley" ? ["h", "slope"] as const : kind === "line" ? ["h"] as const : [];

interface GeometryUse {
    name: string;
    label?: string;
    path: Address;
    location: Location;
}
interface ReferenceSlot extends GeometryUse { key: string }
export interface HolderSlot extends ReferenceSlot {
    kind: HolderKind;
    index: number;
    active: boolean;
    location: { kind: "geo"; id: string; index: number; path: Address };
    value: HolderValue;
}
type OwnedSlot = HolderSlot & { value: CurveHolder<HolderParameters> };
interface PointSlot extends GeometryUse { value: PointHolder }
export type CurveSlot = ReferenceSlot & { closed: boolean } &
    ({ holder: HolderSlot } | { holder?: undefined; id: string; value: Curve });

export const isHolderRef = (value: HolderValue): value is HolderRef => "ref" in value;
export const curveKey = (id: string) => "curve:" + id;
export const refKey = (ref: string) => /^\{(geo:[^{}]+)\}$/.exec(ref)?.[1];
export const curveSlotName = (slot: GeometryUse) => slot.label ? slot.name + "." + slot.label : slot.name;
export const holderLabel = (slot: HolderSlot) => holderLabels[slot.kind];
const referenceAt = (slot: HolderSlot) => ({ ...slot.location, path: [...slot.location.path, "ref"] });

export function curveParameterName(path: Address) {
    const [group, name, index] = path;
    const curve = path.at(-1) === "curve";
    const length = path.length - +curve;
    let label: string | undefined;
    if (group === "construction" && name === "outlines" && typeof index === "number" && length === 3)
        label = "轮廓 " + (index + 1);
    if (group === "function") {
        if (name === "shore" && length === 2) label = holderLabels.shore;
        if (typeof name === "string" && Object.hasOwn(profileGroups, name) && typeof index === "number" && length === 3) {
            const spec = profileGroups[name as ProfileGroup];
            return spec.label + " " + (index + 1) + (curve ? "." + spec.curve : "");
        }
    }
    return label && (curve ? label + ".曲线" : label);
}

export function geoHolderSlots(n: GeoNode, index: number): HolderSlot[] {
    const slots: HolderSlot[] = [], c = n.construction, f = n.function;
    function add(kind: HolderKind, path: Address, value: HolderValue, controlIndex: number, active = true) {
        const property = path[0] === "function" ? path.slice(1) : path;
        slots.push({ kind, index: controlIndex, active, key: "geo:" + n.id + "." + property.join("."), name: n.label, label: curveParameterName(path),
            path: ["geoNodes", index, ...path], location: { kind: "geo", id: n.id, index, path }, value });
    }
    if (c?.type === "outline") c.outlines.forEach((value, i) => add("outline", ["construction", "outlines", i], value, i));
    if (f?.type === "coast") add("shore", ["function", "shore"], f.shore, -1);
    if (f?.type === "mountain") for (const group of ["ridges", "valleys"] as const)
        f[group]?.forEach((value, i) => add(profileGroups[group].kind, ["function", group, i], value, profileIndex(f, group, i)));
    if (f?.type === "slope") f.lines?.forEach((value, i) => add("line", ["function", "lines", i], value, -1 - i, f.kind === "path"));
    return slots;
}

export function geoPointSlots(n: GeoNode, index: number): PointSlot[] {
    const slots: PointSlot[] = [], f = n.function;
    function add(value: PointHolder, label: string, ...path: Address) {
        slots.push({ name: n.label, label, path: ["geoNodes", index, ...path],
            location: { kind: "geo", id: n.id, index, path }, value });
    }
    if (f.type === "coast") add(f.harbor.center, "港湾圆心", "function", "harbor", "center");
    if (f.type === "slope") add(f.center, "圆心", "function", "center");
    if (f.type === "mountain") f.peaks.forEach((peak, i) => add(peak.at, "山峰 " + (i + 1) + ".位置", "function", "peaks", i, "at"));
    return slots;
}

export function pointHolderSlots(d: Design): PointSlot[] {
    return [
        ...d.geoNodes.flatMap(geoPointSlots),
        ...d.sections.flatMap((s, index) => s.points.map((value, i): PointSlot => ({
            name: s.label, label: i === 0 ? "起点" : "终点", path: ["sections", index, "points", i],
            location: { kind: "section", id: s.id, index, path: ["points", i] }, value
        }))),
        ...d.marks.map((m, index): PointSlot => ({
            name: m.label, label: "位置", path: ["marks", index, "point"],
            location: { kind: "mark", id: m.id, index, path: ["point"] }, value: m.point
        }))
    ];
}

export type GeometryHolderSlot = PointSlot | OwnedSlot;

export function geometryUsers(d: Design) {
    const users = new Map<string, GeometryHolderSlot[]>();
    function add(id: string, slot: GeometryHolderSlot) {
        const list = users.get(id);
        if (list) list.push(slot);
        else users.set(id, [slot]);
    }
    for (const s of d.geoNodes.flatMap(geoHolderSlots)) if (!isHolderRef(s.value)) add(s.value.curve, { ...s, value: s.value });
    for (const s of pointHolderSlots(d)) add(s.value.point, s);
    return users;
}

export function geometryAt(d: Pick<Design, "geometry">, id: string) {
    return Object.hasOwn(d.geometry, id) ? d.geometry[id] : undefined;
}

export function geometryReferenceCount(d: Design, id: string, users: ReadonlyMap<string, readonly unknown[]>) {
    return (users.get(id)?.length ?? 0) + (geometryAt(d, id)?.independent ? 1 : 0);
}

export function placedPoint(d: Design, holder: PointHolder, at?: Location): Point {
    const { point, offset } = holder, item = geometryAt(d, point);
    check(item, "找不到点“" + point + "”", at);
    check("point" in item, "需要点", at);
    if (!offset) return [...item.point];
    const placed = offsetPoint(item.point, offset);
    check(placed.every(Number.isFinite), "只能填写数字坐标", at);
    return placed;
}

export function offsetPoint([x, y]: Point, [dx, dy]: Point): Point {
    return [dx ? x + dx : x, dy ? y + dy : y];
}

function heldCurveSlot(holder: HolderSlot): CurveSlot {
    const path = [...holder.location.path, "curve"], closed = holder.kind === "outline" || holder.kind === "shore";
    return { holder, key: holder.key + ".curve", name: holder.name, label: curveParameterName(path), path: [...holder.path, "curve"],
        location: { ...holder.location, path }, closed };
}

function geometryCurveSlot(d: Design, id: string): CurveSlot | undefined {
    const item = geometryAt(d, id);
    if (!item || !("curve" in item)) return;
    return { key: curveKey(id), id, name: item.label, path: ["geometry", id, "curve"],
        location: { kind: "geometry", id, path: ["curve"] }, value: item.curve, closed: false };
}

export function geometrySlot(d: Design, id: string, index: number, standalone = false): CurveSlot | undefined {
    if (standalone) return geometryCurveSlot(d, id);
    const at = d.geoNodes.findIndex(n => n.id === id);
    if (at < 0) return;
    const holder = geoHolderSlots(d.geoNodes[at], at).find(slot => slot.active && slot.index === index);
    return holder && heldCurveSlot(holder);
}

export function geometryIndex(slot: HolderSlot | CurveSlot) {
    return "kind" in slot ? slot.index : slot.holder?.index ?? -1;
}

export function resolvedCurvePath(slot: CurveSlot): Address {
    return slot.closed && slot.holder ? slot.holder.path : slot.path;
}

export const nodeQuantityPath = (id: string, quantity: NodeQuantity): Address => [quantity, id];

export function translateCurve<C extends Curve>(curve: C, offset: Point): C {
    return offset.some(Boolean) ? { ...curve, nodes: curve.nodes.map(n => ({ ...n, p: offsetPoint(n.p, offset) })) } : curve;
}

export function curveGraph(d: Design) {
    const slots = new Map<string, CurveSlot>(), holders = new Map<string, HolderSlot>();
    const users = new Map<string, HolderSlot[]>();
    for (const id of Object.keys(d.geometry)) {
        const slot = geometryCurveSlot(d, id);
        if (slot) slots.set(slot.key, slot);
    }
    for (const holder of d.geoNodes.flatMap(geoHolderSlots)) {
        const slot = heldCurveSlot(holder);
        holders.set(holder.key, holder);
        slots.set(slot.key, slot);
        if (isHolderRef(holder.value)) continue;
        const key = holder.value.curve;
        const list = users.get(key);
        if (list) list.push(holder);
        else users.set(key, [holder]);
    }
    const owned = new Map<string, OwnedSlot>(), stack: HolderSlot[] = [];
    const ofHolder = (slot: HolderSlot) => slots.get(slot.key + ".curve")!;
    function holderTarget(slot: HolderSlot) {
        if (!isHolderRef(slot.value)) return;
        const { ref } = slot.value, key = refKey(ref) ?? "", target = holders.get(key), at = referenceAt(slot);
        check(!slots.has(key), "无效", at);
        check(target, "找不到" + holderLabel(slot) + "“" + ref + "”", at);
        check(slot.kind === target.kind, "只能引用同类" + holderLabel(slot), at);
        check(!slot.active || target.active, "引用的" + holderLabel(slot) + "当前不可用", at);
        return target;
    }
    function holder(slot: HolderSlot): OwnedSlot {
        slot = holders.get(slot.key)!;
        const known = owned.get(slot.key);
        if (known) return known;
        const target = holderTarget(slot);
        if (!target) return slot as OwnedSlot;
        const cycle = stack.indexOf(slot);
        check(cycle < 0, "引用成环：" + [...stack.slice(cycle), slot].map(s => quotedLocation(s.name, s.label)).join(" → "), referenceAt(slot));
        stack.push(slot);
        try {
            const result = holder(target);
            owned.set(slot.key, result);
            return result;
        }
        finally {
            stack.pop();
        }
    }
    const offset = (slot: CurveSlot): Point => slot.holder ? holder(slot.holder).value.offset ?? [0, 0] : [0, 0];
    const sources = new Map<string, { slot: CurveSlot; curve: Curve; id: string }>();
    function source(slot: CurveSlot): { slot: CurveSlot; curve: Curve; id: string } {
        slot = slots.get(slot.key)!;
        if (!slot.holder) return { slot, curve: slot.value, id: slot.id };
        const owner = holder(slot.holder), known = sources.get(owner.key);
        if (known) return known;
        const id = owner.value.curve, at = ofHolder(owner).location;
        check(geometryAt(d, id), "找不到曲线“" + id + "”", at);
        const found = slots.get(curveKey(id));
        check(found && !found.holder, "需要曲线", at);
        check(!slot.closed || found.value.closed, "需要闭合曲线", at);
        const ids = new Set(found.value.nodes.map(n => n.id));
        for (const key of ["h", "slope", "interpolate"] as const)
            for (const node of Object.keys(owner.value[key] ?? {}))
                check(ids.has(node), "找不到节点“" + node + "”", { ...owner.location, path: [...owner.location.path, key, node] });
        const result = { slot: found, curve: found.value, id };
        sources.set(owner.key, result);
        return result;
    }
    function shape(slot: CurveSlot): ProfileCurve {
        const { curve } = source(slot), copy: ProfileCurve = structuredClone(curve);
        if (!slot.holder) return copy;
        const input = holder(slot.holder).value;
        for (const n of copy.nodes) for (const key of ["h", "slope", "interpolate"] as const) {
            const map = input[key];
            if (map && Object.hasOwn(map, n.id)) {
                const value = map[n.id];
                Object.assign(n, { [key]: Array.isArray(value) ? value.slice() : value });
            }
        }
        return copy;
    }
    const materialize = (slot: CurveSlot) => translateCurve(shape(slot), offset(slot));

    function needsClosed(slot: CurveSlot) {
        return !!users.get(source(slot).id)?.some(user => ofHolder(user).closed);
    }
    function canUse(from: CurveSlot, candidate: CurveSlot) {
        return !candidate.holder && (!from.closed || candidate.value.closed);
    }
    function canUnlinkShape(slot: CurveSlot) {
        return !!slot.holder && geometryReferenceCount(d, source(slot).id, users) > 1;
    }
    function canUnlink(slot: CurveSlot) {
        return !!slot.holder && (isHolderRef(slot.holder.value) || canUnlinkShape(slot));
    }
    function canUseHolder(from: CurveSlot, candidate: HolderSlot) {
        if (from.holder?.kind !== candidate.kind || !candidate.active) return false;
        for (let slot: HolderSlot | undefined = candidate; slot; slot = holderTarget(slot))
            if (slot.key === from.holder?.key) return false;
        return true;
    }
    let placements: Map<string, HolderSlot[]> | undefined;
    function holderPlacements(slot: HolderSlot) {
        if (!placements) {
            placements = new Map();
            for (const item of holders.values()) {
                const key = holder(item).key, items = placements.get(key);
                if (items) items.push(item);
                else placements.set(key, [item]);
            }
        }
        return placements.get(holder(slot).key)!;
    }
    function curvePlacements(id: string) {
        return (users.get(id) ?? []).flatMap(holderPlacements);
    }
    function parameterHolder(key: string) {
        if (!key.startsWith("geo:")) return;
        for (let i = key.lastIndexOf("."); i !== -1; i = key.lastIndexOf(".", i - 1)) {
            const slot = holders.get(key.slice(0, i));
            if (slot) return slot;
        }
    }
    function parameterKey(key: string, includeInactive = false) {
        const slot = parameterHolder(key);
        return slot && (slot.active || includeInactive) ? holder(slot).key + key.slice(slot.key.length) : key;
    }
    function* references() {
        for (const slot of holders.values()) {
            const target = holderTarget(slot);
            if (target) yield { slot, target };
        }
    }
    return { slots, holders, holder, ofHolder, offset, source, shape, materialize, canUse, canUseHolder, canUnlink, canUnlinkShape, needsClosed,
        holderPlacements, curvePlacements, parameterHolder, parameterKey, references };
}
import { type Design, type NodeRecords, type Point, type ProfileCurve, type ResolvedDesign } from "../../core/design/v5.ts";
import { heightId } from "../../core/design/defaults.ts";
import { fillFunctionParameters } from "../../core/design/functionTable.ts";
import { movePointGeometry } from "../../core/edit/controls.ts";
import { writeCurveProfile } from "../../core/design/polyline.ts";
import { resolveDesign } from "../../core/design/parameters.ts";
import { curveSlotName, geometrySlot, nodeQuantities, profileGroupForTool, profileGroups, profileIndex } from "../../core/design/curveReferences.ts";
import { editCurveSource, seedProfile } from "../../core/edit/curveEdits.ts";
import { writeAt } from "../../core/design/address.ts";
import { type DrawTool, type GeoDraft } from "../../core/edit/types.ts";
import { closedPen, extendCurve, penNode, penPath, shapePath } from "../../core/edit/paths.ts";
import { addGeometry, createOutline, createStrip, defaultFunction, holdPoint, nodeIds, stripConstruction, stripRange, tenth } from "../../core/edit/geoNodes.ts";
import { distance } from "../../core/math/geometry.ts";
import { constructionCenter, makeShape } from "../../core/design/regions.ts";
import { sampleField, type Terrain } from "../../core/design/results.ts";
import { mapSnapTargets, modifiedSnapPoint, parameterSnapGroup, type SnapModifiers } from "./mapSnaps.ts";
type Editor = import("./session.svelte.ts").Editor;

export const drawingTools: DrawTool[] = ["pen", "rect", "circle", "sector", "strip", "addOutline", "shore", "ridge", "valley", "peak", "slopeLine", "center", "harbor", "section", "geometryPoint", "geometryCurve", "geometryClosed", "redrawCurve", "continueCurve"];
const closedTools: DrawTool[] = ["pen", "addOutline", "shore", "geometryClosed"];
export const doubleClickTools: DrawTool[] = [...closedTools, "ridge", "valley", "slopeLine", "geometryCurve", "redrawCurve", "continueCurve"];
const pointTools: DrawTool[] = ["peak", "center", "harbor", "geometryPoint"];

export function startDrawing(e: Editor, tool: DrawTool, owner?: string, member?: number): GeoDraft {
    const d = e.project.design;
    const ids = tool !== "strip" && e.selection?.kind === "geoNode" ? [e.selection.id] : [];
    if (tool === "strip" && owner) {
        const c = d.geoNodes.find(n => n.id === owner)?.construction;
        if (c?.type === "strip") ids.push(...c.of);
    }
    return { tool, owner, member, ids, nodes: [], anchors: [], reverse: false };
}

export function startCurveDrawing(e: Editor, tool: "redrawCurve" | "continueCurve", key: string, endpoint?: number, geometryPage = false): GeoDraft {
    const graph = e.curves, slot = graph.slots.get(key)!;
    const owner = slot.location.kind === "geo" ? slot.location.id : undefined;
    const draft = startDrawing(e, tool, owner);
    const kind = slot.holder?.kind;
    const curveName = kind === "valley" ? "山谷线" : kind === "line" ? "坡线" : undefined;
    const source = graph.source(slot), ownPage = geometryPage || !slot.holder;
    const redrawTitle = ownPage ? "重画“" + source.slot.name + "”" : curveName ? "重画“" + slot.name + "”的" + curveName : undefined;
    draft.curve = { key, endpoint, name: ownPage ? source.slot.name : curveSlotName(slot), redrawTitle, original: graph.materialize(slot),
        pen: ownPage || slot.location.path[0] === "construction" ? "boundary" : "terrain",
        requiredClosed: ownPage ? source.curve.closed : graph.needsClosed(source.slot),
        ...(ownPage && tool === "redrawCurve" && !source.curve.closed && { openOnly: true as const }) };
    return draft;
}

export function drawingReady(draft: GeoDraft) {
    const { tool, nodes, ids, anchors } = draft;
    if (tool === "strip") return ids.length > 0 && anchors.length !== 1;
    if (tool === "continueCurve") return !!nodes.length || !!draft.closed;
    if (closedTools.includes(tool) || draft.curve?.requiredClosed) return nodes.length >= 3;
    if (profileGroupForTool(tool) || tool === "section" || tool === "geometryCurve" || tool === "redrawCurve") return nodes.length >= 2;
    if (pointTools.includes(tool)) return !!nodes.length;
    return true;
}
function stripSource(d: ResolvedDesign, draft: GeoDraft) {
    return d.geoNodes.findLast(n => draft.ids.includes(n.id));
}
function stripPreview(e: Editor, draft: GeoDraft) {
    const d = e.project.design, c = stripConstruction(d, draft.ids, draft.anchors.length === 2 ? stripRange(draft.anchors, draft.reverse) : undefined);
    const shapes = new Map([...e.project.terrain.regions].map(([id, r]) => [id, r.shape]));
    return makeShape({ id: "", label: "", field: heightId, construction: c, function: { type: "blend" } }, shapes, d.grid.step / 8).spine;
}
export function updatePreview(e: Editor, draft: GeoDraft) {
    const { tool, cursor, start, radius, nodes } = draft;
    draft.path = undefined;
    if (tool === "strip") {
        const range = JSON.stringify([draft.ids, draft.anchors, draft.reverse]);
        if (range !== draft.spineRange) {
            try {
                draft.spine = draft.ids.length ? stripPreview(e, draft) : undefined;
            }
            catch {
                draft.spine = undefined;
            }
            draft.spineRange = range;
        }
    }
    else if (start && cursor && (tool === "rect" || tool === "circle" || tool === "sector")) {
        try {
            draft.path = tool === "sector" && !radius ? undefined : shapePath(tool, start, radius ?? cursor, () => "", cursor);
        }
        catch { /* The drag has not defined an area yet. */ }
    }
    else if (doubleClickTools.includes(tool) && (nodes.length || draft.curve?.endpoint !== undefined)) {
        const preview = [...nodes];
        if (draft.down) preview.push(drawingNode(e, draft.down, draft.handle));
        else if (cursor) preview.push(drawingNode(e, cursor));
        const continued = draft.curve?.endpoint;
        draft.path = continued === undefined ? penPath(preview, closedTools.includes(tool) || !!draft.curve?.requiredClosed) :
            extendCurve(draft.curve!.original, preview, continued, !!draft.closed);
    }
}

function drawingNode(e: Editor, point: Point, drag?: Point) {
    if (drag && distance(point, drag)) return penNode("", point, drag);
    return { id: "", p: point, mode: e.penNodeMode ?? "corner" } as const;
}

function pickStripPoint(e: Editor, draft: GeoDraft, at: Point, alt: boolean) {
    const canPickSource = !draft.owner && !draft.anchors.length && draft.ids.length < 2;
    const pickSource = () => {
        const node = e.map.pickGeo(e.mapProject, at, alt ? draft.ids.at(-1) : undefined, draft.ids);
        if (!node) return false;
        draft.ids.push(node.id);
        return true;
    };
    if (alt && canPickSource && pickSource()) return;
    const source = stripSource(e.project.resolved, draft);
    const nodes = source?.construction.type === "outline" ? source.construction.outlines.flatMap(p => p.nodes) : [];
    const v = nodes.filter(v => distance(v.p, at) * e.map.scale <= 9).sort((a, b) => distance(a.p, at) - distance(b.p, at))[0];
    if (v) {
        const next = draft.anchors.length === 1 ? [...draft.anchors, v.id] : [v.id];
        if (next.length === 2) stripConstruction(e.project.design, draft.ids, stripRange(next));
        draft.anchors = next;
    }
    else if (canPickSource && !alt) pickSource();
}

function drawingSnap(e: Editor, draft: GeoDraft) {
    const { snap } = mapSnapTargets(e), { tool, owner, member, curve } = draft;
    const design = e.project.design;
    const f = owner ? design.geoNodes.find(n => n.id === owner)?.function : undefined, group = profileGroupForTool(tool);
    const path = tool === "shore" ? -1 : f && group && member !== undefined ? profileIndex(f, group, member) : undefined;
    const slot = curve ? e.curves.slots.get(curve.key) : owner && path !== undefined ? geometrySlot(design, owner, path) : undefined;
    const source = slot && e.curves.source(slot).slot;
    const index = tool === "harbor" && f?.type === "coast" || tool === "center" && f?.type === "slope" && f.kind === "radial" ? 0 :
        tool === "peak" && f?.type === "mountain" && member !== undefined ? f.ridges.length + member : undefined;
    const exclude = source ? { group: source.key, indices: curve?.endpoint === undefined ? undefined : [curve.endpoint] } :
        owner && index !== undefined ? { group: parameterSnapGroup(owner), indices: [index] } : undefined;
    return (point: Point, alignmentPoints: readonly Point[]) => snap(point, e.map.scale, { alignmentPoints, exclude });
}

const draftSnaps = new WeakMap<GeoDraft, ReturnType<typeof drawingSnap>>();
function snapDraft(e: Editor, draft: GeoDraft, raw: Point, draggingHandle: boolean, ev: SnapModifiers) {
    const { tool, down, nodes, curve, start } = draft;
    if (tool === "strip") return { point: raw };
    const pen = doubleClickTools.includes(tool);
    const extending = curve?.endpoint !== undefined;
    const previous = nodes.at(-1)?.p ?? (extending ? curve.original.nodes[curve.endpoint!].p : undefined);
    const origin = draggingHandle ? down : tool === "rect" || tool === "sector" ? start : tool === "section" || pen ? previous : undefined;
    const modified = modifiedSnapPoint(raw, ev, origin, tool === "rect");
    if (modified) return { point: modified };

    const first = extending ? curve.original.nodes.at(curve.endpoint === 0 ? -1 : 0)?.p : nodes[0]?.p;
    const alignmentPoints = (draggingHandle ? [down] : pen ? [previous, first] : []).filter(p => p !== undefined);
    let snap = draftSnaps.get(draft);
    if (!snap) draftSnaps.set(draft, snap = drawingSnap(e, draft));
    return snap(raw, alignmentPoints);
}

export function finishCurveDraft(d: Design, draft: GeoDraft, terrain?: Terrain) {
    const id = nodeIds(d);
    const nodes = draft.nodes.map(v => ({ ...v, id: id() }));
    if (draft.tool === "geometryPoint") return addGeometry(d, { point: nodes[0].p }, true);
    if (draft.tool === "geometryCurve" || draft.tool === "geometryClosed")
        return addGeometry(d, { curve: penPath(nodes, draft.tool === "geometryClosed") }, true);
    const { key, endpoint, requiredClosed } = draft.curve!;
    editCurveSource(d, key, (curve, local) => {
        for (const node of nodes) node.p = local(node.p);
        if (endpoint !== undefined) {
            Object.assign(curve, extendCurve(curve, nodes, endpoint, !!draft.closed));
            return;
        }
        Object.assign(curve, penPath(nodes, requiredClosed || !!draft.closed));
    }, endpoint !== undefined ? { extendFrom: endpoint } : { redraw: p => tenth(terrain && sampleField(terrain, heightId, p)) });
    return nodes.at(-1)?.id;
}

export function finishDraft(d: Design, terrain: Terrain, draft: GeoDraft) {
    const { tool, owner, member } = draft, n = d.geoNodes.find(n => n.id === owner);
    if (tool === "strip") {
        const range = stripRange(draft.anchors, draft.reverse);
        if (n?.construction.type === "strip") {
            stripConstruction(d, draft.ids, range);
            if (range) n.construction.range = range;
            else delete n.construction.range;
            return n;
        }
        return createStrip(d, draft.ids, range);
    }
    const group = profileGroupForTool(tool);
    if (group && n) {
        const f = n.function, closed = !!draft.closed;
        if (draft.nodes.length < (closed ? 3 : 2)) throw Error(closed ? "闭合曲线至少需要三个节点" : "曲线至少需要两个节点");
        const id = nodeIds(d), line = penPath(draft.nodes.map(v => ({ ...v, id: id() })), closed);
        const slot = member === undefined ? undefined : geometrySlot(d, n.id, profileIndex(f, group, member));
        const height = (p: Point) => tenth(sampleField(terrain, heightId, p));
        if (slot) editCurveSource(d, slot.key, (curve, local) => {
            for (const v of line.nodes) v.p = local(v.p);
            Object.assign(curve, line);
        }, { redraw: height });
        else {
            const members = f.type === "mountain" && group !== "lines" ? f[group] : f.type === "slope" && f.kind === "path" && group === "lines" ? f.lines : undefined;
            if (!members) throw Error("当前函数不能添加" + profileGroups[group].label);
            const quantities = nodeQuantities(profileGroups[group].kind);
            const profile: ProfileCurve = structuredClone(line), records: NodeRecords = {};
            writeCurveProfile(records, seedProfile(profile, quantities, d.grid.step / 8, group !== "lines", height), quantities);
            members.push({ curve: addGeometry(d, { curve: line }), ...records });
        }
        return n;
    }
    if (pointTools.includes(tool)) {
        const p = draft.nodes[0]?.p;
        if (!p) throw Error("请先在地图上选择一个点");
        const h = tenth(sampleField(terrain, heightId, p));
        if (tool === "peak" && n?.function.type === "mountain") {
            if (member !== undefined) movePointGeometry(d, n.function.peaks[member].at, p);
            else {
                const path = ["peaks", n.function.peaks.length];
                writeAt(n.function, path, { at: holdPoint(d, p), height: h }); fillFunctionParameters(n.function, path);
            }
        }
        if (tool === "harbor" && n?.function.type === "coast") movePointGeometry(d, n.function.harbor.center, p);
        if (tool === "center" && n) {
            if (n.function.type === "slope") movePointGeometry(d, n.function.center, p);
            else n.function = defaultFunction(d, "slope", { slope: "radial", center: p });
        }
        return n!;
    }
    const nextId = nodeIds(d);
    const path = (tool === "rect" || tool === "circle" || tool === "sector") ?
        shapePath(tool, draft.start!, draft.radius ?? draft.cursor!, nextId, draft.cursor) :
        closedPen(draft.nodes.map(v => ({ ...v, id: nextId() })));
    if (tool === "shore" && n) {
        if (n.function.type === "coast") editCurveSource(d, geometrySlot(d, n.id, -1)!.key, (curve, local) => {
            for (const v of path.nodes) v.p = local(v.p);
            Object.assign(curve, path);
        });
        else n.function = defaultFunction(d, "coast", { shore: path,
            center: constructionCenter(resolveDesign(d).geoNodes.find(v => v.id === n.id)!.construction, d.grid.step, terrain.grid, terrain.regions.get(n.id)) });
        return n;
    }
    if (tool === "addOutline" && n?.construction.type === "outline") {
        n.construction.outlines.push({ curve: addGeometry(d, { curve: path }) }); return n;
    }
    return createOutline(d, path, draft.ids[0]);
}
function closingPoint(draft: GeoDraft, at: Point, scale: number) {
    const { curve, nodes } = draft;
    if (draft.tool === "geometryCurve" || curve?.openOnly) return false;
    if (curve?.endpoint !== undefined) {
        const original = curve.original.nodes, other = original[curve.endpoint === 0 ? original.length - 1 : 0];
        return original.length + nodes.length >= 3 && distance(at, other.p) * scale < 7;
    }
    return nodes.length >= 3 && distance(at, nodes[0].p) * scale < 7;
}

export function draftPointer(e: Editor, phase: "down" | "move" | "up", raw: Point, ev: SnapModifiers & { altKey: boolean }) {
    const draft = e.geoDraft;
    if (!draft) return false;
    const { tool, downRaw } = draft;
    const pen = doubleClickTools.includes(tool);
    const dragged = phase !== "down" && !!downRaw && distance(downRaw, raw) * e.map.scale > 3;
    const result = snapDraft(e, draft, raw, pen && dragged, ev), at = result.point;
    e.snapGuides = phase === "up" ? undefined : result.guides;
    draft.handle = pen && dragged ? at : undefined;
    if (phase === "down") {
        draft.down = at;
        draft.downRaw = raw;
        if (["rect", "circle", "sector"].includes(tool)) draft.start ??= at;
    }
    draft.cursor = at;
    if (phase !== "up") {
        updatePreview(e, draft); return true;
    }
    const down = draft.down;
    draft.down = draft.downRaw = draft.handle = undefined;
    if (!down || !downRaw) return true;
    let complete = false;
    if (tool === "strip") pickStripPoint(e, draft, at, ev.altKey);
    else if (tool === "rect" || tool === "circle" || tool === "sector") {
        if (draft.radius) complete = true;
        else if (!dragged && !draft.sizing) {
            draft.sizing = true;

        }
        else if (tool === "sector") {
            if (distance(draft.start!, at) < 1e-6) throw Error("请选取不同的圆心和起始点");
            draft.radius = at;

        }
        else complete = true;
    }
    else if (pen && !dragged && closingPoint(draft, downRaw, e.map.scale)) {
        draft.closed = true;
        complete = true;
    }
    else {
        const node = pen ? drawingNode(e, down, dragged ? at : undefined) : penNode("", down);
        if (pointTools.includes(tool)) {
            draft.nodes = [node];
            complete = true;
        }
        else if (tool === "section") {
            const first = draft.nodes[0];
            if (first && distance(first.p, node.p) === 0) throw Error("请选择不同的起点和终点");
            draft.nodes = first ? [first, node] : [node];
            complete = !!first;
        }
        else draft.nodes.push(node);
    }
    updatePreview(e, draft);
    if (complete) void e.completeDrawing();
    return true;
}
export function geoAt<N extends { id: string }>(d: { geoNodes: N[] }, id: string): N {
    return d.geoNodes.find(n => n.id === id)!;
}
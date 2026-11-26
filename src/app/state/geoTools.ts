import { type Design, type GeoNode, type Point, type ResolvedDesign } from "../../core/design/v5.ts";
import { heightId } from "../../core/design/defaults.ts";
import { fillFunctionParameters, slopeEndpointValues } from "../../core/design/functionTable.ts";
import { resolveDesign } from "../../core/design/parameters.ts";
import { curveSlotName } from "../../core/design/curveReferences.ts";
import { editCurveSource } from "../../core/edit/curveEdits.ts";
import { writeAt } from "../../core/design/address.ts";
import { type DrawTool, type GeoDraft } from "../../core/edit/types.ts";
import { closedPen, extendCurve, nearestSegment, penNode, penPath, shapePath } from "../../core/edit/paths.ts";
import { addSharedCurve, createOutline, createStrip, defaultFunction, nodeIds, stripConstruction, stripRange, tenth } from "../../core/edit/geoNodes.ts";
import { distance } from "../../core/math/geometry.ts";
import { constructionCenter, makeShape, nearbyBoundary } from "../../core/design/regions.ts";
import { sampleField, type Terrain } from "../../core/design/results.ts";
type Editor = import("./session.svelte.ts").Editor;

export const drawingTools: DrawTool[] = ["pen", "rect", "circle", "sector", "strip", "addOutline", "shore", "ridge", "peak", "slopeLine", "center", "harbor", "section", "sharedCurve", "redrawCurve", "continueCurve"];
const closedTools: DrawTool[] = ["pen", "addOutline", "shore"];
export const doubleClickTools: DrawTool[] = [...closedTools, "ridge", "slopeLine", "sharedCurve", "redrawCurve", "continueCurve"];
const pointTools: DrawTool[] = ["peak", "center", "harbor"];

export function startDrawing(e: Editor, tool: DrawTool, owner?: string, member?: number): GeoDraft {
    const d = e.project.design;
    const ids = tool !== "strip" && e.selection?.kind === "geoNode" ? [e.selection.id] : [];
    if (tool === "strip" && owner) {
        const c = d.geoNodes.find(n => n.id === owner)?.construction;
        if (c?.type === "strip") ids.push(...c.of);
    }
    return { tool, owner, member, ids, nodes: [], anchors: [], reverse: false };
}

export function startCurveDrawing(e: Editor, tool: "redrawCurve" | "continueCurve", key: string, endpoint?: number): GeoDraft {
    const graph = e.curves, slot = graph.slots.get(key)!;
    const owner = slot.location.kind === "geo" ? slot.location.id : undefined;
    const draft = startDrawing(e, tool, owner);
    draft.curve = { key, endpoint, name: curveSlotName(slot), original: graph.materialize(slot),
        pen: slot.location.kind === "curve" || slot.location.path[0] === "construction" ? "boundary" : "terrain", requiredClosed: slot.closed };
    return draft;
}

export function drawingReady(draft: GeoDraft) {
    const { tool, nodes, ids, anchors } = draft;
    if (tool === "strip") return ids.length > 0 && anchors.length !== 1;
    if (tool === "continueCurve") return !!nodes.length || !!draft.closed;
    if (closedTools.includes(tool) || draft.curve?.requiredClosed) return nodes.length >= 3;
    if (tool === "ridge" || tool === "slopeLine" || tool === "section" || tool === "sharedCurve" || tool === "redrawCurve") return nodes.length >= 2;
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
        if (draft.down) {
            const drag = draft.downRaw && cursor && distance(draft.downRaw, cursor) * e.map.scale > 3 ? cursor : undefined;
            preview.push(drawingNode(e, draft.down, drag));
        }
        else if (cursor) preview.push(drawingNode(e, cursor));
        const continued = draft.curve?.endpoint;
        draft.path = continued === undefined ? penPath(preview, closedTools.includes(tool) || !!draft.curve?.requiredClosed) :
            extendCurve(draft.curve!.original, preview, continued, !!draft.closed);
    }
}

function drawingNode(e: Editor, point: Point, drag?: Point) {
    if (drag) return penNode("", point, drag);
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

export function snapPoint(t: Terrain, design: ResolvedDesign, at: Point, scale: number, except?: string): Point {
    const nodes = design.geoNodes.filter(n => n.id !== except);
    let nearest: Point | undefined, gap = 6 / scale;
    for (const n of nodes) if (n.construction.type === "outline") for (const path of n.construction.outlines) for (const v of path.nodes) {
        const here = distance(at, v.p);
        if (here <= gap) {
            nearest = v.p; gap = here;
        }
    }
    if (nearest) return [...nearest];
    for (const n of nodes) {
        const shape = t.regions.get(n.id)?.shape;
        if (!shape || at[0] < shape.box[0] - gap || at[0] > shape.box[2] + gap || at[1] < shape.box[1] - gap || at[1] > shape.box[3] + gap) continue;
        const hit = nearestSegment(nearbyBoundary(shape, at, gap, .5 / scale).flat(), at);
        if (hit && hit.distance <= gap) {
            nearest = hit.point; gap = hit.distance;
        }
    }
    return nearest ?? at;
}

export function finishCurveDraft(d: Design, draft: GeoDraft) {
    const id = nodeIds(d);
    const nodes = draft.nodes.map(v => ({ ...v, id: id() }));
    if (draft.tool === "sharedCurve") return addSharedCurve(d, penPath<never>(nodes, !!draft.closed));
    const { key, endpoint, requiredClosed } = draft.curve!;
    editCurveSource(d, key, (curve, local) => {
        for (const node of nodes) node.p = local(node.p);
        if (endpoint !== undefined) {
            Object.assign(curve, extendCurve(curve, nodes, endpoint, !!draft.closed));
            return;
        }
        const replacement = penPath(nodes, requiredClosed || !!draft.closed);
        for (const [i, node] of replacement.nodes.entries()) {
            const previous = curve.nodes[i];
            if (previous?.h !== undefined) node.h = previous.h;
        }
        Object.assign(curve, replacement);
    });
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
    if (tool === "ridge" || tool === "slopeLine") {
        const f = n!.function;
        const previous = f.type === "slope" && f.kind === "path" ? f.line
            : f.type === "mountain" && member !== undefined ? f.ridges[member].line : undefined;
        const closed = !!draft.closed;
        if (draft.nodes.length < (closed ? 3 : 2)) throw Error(closed ? "闭合曲线至少需要三个节点" : "曲线至少需要两个节点");
        const id = nodeIds(d), line = penPath(draft.nodes.map(v => ({ ...v, id: id() })), closed);
        for (const [i, v] of line.nodes.entries()) {
            const h = (previous && "nodes" in previous ? previous.nodes[i]?.h : undefined) ?? (tool === "ridge" ? tenth(sampleField(terrain, heightId, v.p)) :
                i === 0 ? slopeEndpointValues[0] : i === line.nodes.length - 1 ? slopeEndpointValues[1] : undefined);
            if (h !== undefined) v.h = h;
        }
        if (tool === "slopeLine") {
            if (n!.function.type === "slope" && n!.function.kind === "path") n!.function.line = line;
            else n!.function = defaultFunction("slope", { line });
        }
        else if (f.type === "mountain") {
            if (member !== undefined) f.ridges[member].line = line;
            else {
                const path = ["ridges", f.ridges.length];
                writeAt(f, path, { line }); fillFunctionParameters(f, path);
            }
        }
        return n!;
    }
    if (pointTools.includes(tool)) {
        const p = draft.nodes[0]?.p;
        if (!p) throw Error("请先在地图上选择一个点");
        const h = tenth(sampleField(terrain, heightId, p));
        if (tool === "peak" && n?.function.type === "mountain") {
            if (member !== undefined) n.function.peaks[member].at = p;
            else {
                const path = ["peaks", n.function.peaks.length];
                writeAt(n.function, path, { at: p, height: h }); fillFunctionParameters(n.function, path);
            }
        }
        if (tool === "harbor" && n?.function.type === "coast") n.function.harbor.center = p;
        if (tool === "center" && n) {
            if (n.function.type === "slope" && n.function.kind === "radial") n.function.center = p;
            else n.function = defaultFunction("slope", { slope: "radial", center: p });
        }
        return n!;
    }
    const nextId = nodeIds(d);
    const path = (tool === "rect" || tool === "circle" || tool === "sector") ?
        shapePath(tool, draft.start!, draft.radius ?? draft.cursor!, nextId, draft.cursor) :
        closedPen(draft.nodes.map(v => ({ ...v, id: nextId() })));
    if (tool === "shore" && n) {
        if (n.function.type === "coast") n.function.shore = path;
        else n.function = defaultFunction("coast", { shore: path,
            center: constructionCenter(resolveDesign(d).geoNodes.find(v => v.id === n.id)!.construction, d.grid.step, terrain.grid, terrain.regions.get(n.id)) });
        return n;
    }
    if (tool === "addOutline" && n?.construction.type === "outline") {
        n.construction.outlines.push(path); return n;
    }
    return createOutline(d, path, draft.ids[0]);
}
function closingPoint(draft: GeoDraft, at: Point, scale: number) {
    const { curve, nodes } = draft;
    if (curve?.endpoint !== undefined) {
        const original = curve.original.nodes, other = original[curve.endpoint === 0 ? original.length - 1 : 0];
        return original.length + nodes.length >= 3 && distance(at, other.p) * scale < 7;
    }
    return nodes.length >= 3 && distance(at, nodes[0].p) * scale < 7;
}

export function draftPointer(e: Editor, phase: "down" | "move" | "up", raw: Point, ev: PointerEvent) {
    const draft = e.geoDraft;
    if (!draft) return false;
    const { tool } = draft;
    const at = !ev.ctrlKey && doubleClickTools.includes(tool) && !(phase === "move" && draft.down) ?
        snapPoint(e.mapProject.terrain, e.mapProject.design, raw, e.map.scale, draft.owner) : raw;
    if (phase === "down") {
        draft.down = at;
        draft.downRaw = raw;
        if (["rect", "circle", "sector"].includes(tool)) draft.start ??= at;
    }
    draft.cursor = at;
    if (phase !== "up") {
        updatePreview(e, draft); return true;
    }
    const down = draft.down, downRaw = draft.downRaw;
    draft.down = draft.downRaw = undefined;
    if (!down || !downRaw) return true;
    const dragged = distance(downRaw, raw) * e.map.scale > 3;
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
    else if (doubleClickTools.includes(tool) && !dragged && closingPoint(draft, downRaw, e.map.scale)) {
        draft.closed = true;
        complete = true;
    }
    else {
        const drag = doubleClickTools.includes(tool) && dragged ? raw : undefined;
        const node = doubleClickTools.includes(tool) ? drawingNode(e, down, drag) : penNode("", down);
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
export function geoAt<N extends GeoNode>(d: { geoNodes: N[] }, id: string): N {
    return d.geoNodes.find(n => n.id === id)!;
}
import { type Design, type GeoNode, type Point } from "../../core/design/v5.ts";
import { heightId } from "../../core/design/defaults.ts";
import { fillFunctionParameters, slopeEndpointValues } from "../../core/design/functionTable.ts";
import { writeAt } from "../../core/design/address.ts";
import { type DrawTool, type GeoDraft } from "../../core/edit/types.ts";
import { closedPen, nearestSegment, penNode, penPath, shapePath } from "../../core/edit/paths.ts";
import { createFree, createStrip, defaultFunction, nodeIds, stripConstruction, stripRange, tenth } from "../../core/edit/geoNodes.ts";
import { distance } from "../../core/math/geometry.ts";
import { constructionCenter, makeShape, nearbyBoundary } from "../../core/design/regions.ts";
import { sampleField, type Terrain } from "../../core/design/results.ts";
type Editor = import("./session.svelte.ts").Editor;

export const drawingTools: DrawTool[] = ["pen", "rect", "circle", "sector", "strip", "addPath", "shore", "ridge", "peak", "slopeLine", "center", "harbor", "section"];
const penTools: DrawTool[] = ["pen", "addPath", "shore"];
export const doubleClickTools: DrawTool[] = [...penTools, "ridge", "slopeLine"];
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

export function drawingReady(draft: GeoDraft) {
    const { tool, nodes, ids, anchors } = draft;
    if (tool === "strip") return ids.length > 0 && anchors.length === 2;
    if (penTools.includes(tool)) return nodes.length >= 3;
    if (tool === "ridge" || tool === "slopeLine" || tool === "section") return nodes.length >= 2;
    if (pointTools.includes(tool)) return !!nodes.length;
    return true;
}
function stripSource(d: Design, draft: GeoDraft) {
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
    else if (penTools.includes(tool) && nodes.length) {
        const preview = [...nodes];
        if (draft.down) preview.push(penNode("", draft.down, cursor));
        else if (cursor) preview.push(penNode("", cursor));
        draft.path = penPath(preview);
    }
}

function pickStripPoint(e: Editor, draft: GeoDraft, at: Point) {
    const source = stripSource(e.project.design, draft);
    const nodes = source?.construction.type === "free" ? source.construction.paths.flatMap(p => p.nodes) : [];
    const v = nodes.filter(v => distance(v.p, at) * e.map.scale <= 9).sort((a, b) => distance(a.p, at) - distance(b.p, at))[0];
    if (v) {
        const next = draft.anchors.length === 1 ? [...draft.anchors, v.id] : [v.id];
        if (next.length === 2) stripConstruction(e.project.design, draft.ids, stripRange(next));
        draft.anchors = next;
    }
    else if (!draft.owner && !draft.anchors.length && draft.ids.length < 2) {
        const node = e.map.geoHits(e.mapProject, at)[0];
        if (node && !draft.ids.includes(node.id)) draft.ids.push(node.id);
    }
}

export function snapPoint(t: Terrain, design: Design, at: Point, scale: number, except?: string): Point {
    const nodes = design.geoNodes.filter(n => n.id !== except);
    let nearest: Point | undefined, gap = 6 / scale;
    for (const n of nodes) if (n.construction.type === "free") for (const path of n.construction.paths) for (const v of path.nodes) {
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
        const line = { ...previous, points: draft.nodes.map(({ p }, i) => {
            if (previous?.points[i]?.h !== undefined) return { p, h: previous.points[i].h };
            if (tool === "ridge") return { p, h: tenth(sampleField(terrain, heightId, p)) };
            if (i === 0) return { p, h: slopeEndpointValues[0] };
            if (i === draft.nodes.length - 1) return { p, h: slopeEndpointValues[1] };
            return { p };
        }) };
        if (line.points.length < 2) throw Error("折线至少需要两个顶点");
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
            if (member !== undefined) n.function.peaks[member].at.p = p;
            else {
                const path = ["peaks", n.function.peaks.length];
                writeAt(n.function, path, { at: { p, h } }); fillFunctionParameters(n.function, path);
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
            center: constructionCenter(n.construction, d.grid.step, terrain.grid, terrain.regions.get(n.id)) });
        return n;
    }
    if (tool === "addPath" && n?.construction.type === "free") {
        n.construction.paths.push(path); return n;
    }
    return createFree(d, path, draft.ids[0]);
}
export function draftPointer(e: Editor, phase: "down" | "move" | "up", raw: Point, ev: PointerEvent) {
    const draft = e.geoDraft;
    if (!draft) return false;
    const { tool } = draft;
    const at = !ev.ctrlKey && penTools.includes(tool) && !(phase === "move" && draft.down) ?
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
    if (tool === "strip") pickStripPoint(e, draft, at);
    else if (tool === "rect" || tool === "circle" || tool === "sector") {
        if (draft.radius) complete = true;
        else if (!dragged && !draft.sizing) {
            draft.sizing = true;
            e.hint = tool === "rect" ? "单击确定对角，Esc 取消" : "单击确定半径，Esc 取消";
        }
        else if (tool === "sector") {
            if (distance(draft.start!, at) < 1e-6) throw Error("请选取不同的圆心和起始点");
            draft.radius = at;
            e.hint = "单击确定终止角，Esc 取消";
        }
        else complete = true;
    }
    else if (penTools.includes(tool) && !dragged && draft.nodes.length >= 3 && distance(down, draft.nodes[0].p) * e.map.scale < 7)
        complete = true;
    else {
        const drag = penTools.includes(tool) && dragged ? raw : undefined;
        const node = penNode("", down, drag);
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
export function geoAt(d: Design, id: string): GeoNode {
    return d.geoNodes.find(n => n.id === id)!;
}
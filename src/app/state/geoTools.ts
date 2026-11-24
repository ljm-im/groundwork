import { type Design, type GeoNode, type Path, type PathNode, type Point } from "../../core/design/v5.ts";
import { functionDefaults, ridgeNoiseDefaults } from "../../core/design/defaults.ts";
import { type Segment } from "../../core/design/regions.ts";
import { closedPen, nearestSegment, penNode, penPath, shapePath, type ShapeTool } from "../../core/edit/paths.ts";
import { createFree, createStrip, defaultFunction, nodeIds, sampleField, stripConstruction, stripRange, tenth } from "../../core/edit/geoNodes.ts";
import { distance } from "../../core/math/geometry.ts";
import { constructionCenter, makeShape, nearbyBoundary } from "../../core/design/regions.ts";
import { type Terrain } from "../../core/design/results.ts";
type Editor = import("./session.svelte.ts").Editor;

export type DrawTool = ShapeTool | "strip" | "addPath" | "shore" | "ridge" | "peak" | "slopeLine" | "center" | "harbor";
export interface GeoDraft {
    tool: DrawTool; owner?: string; member?: number; ids: string[]; field: string; nodes: PathNode[]; anchors: string[]; reverse: boolean;
    nextId: () => string; down?: Point; downRaw?: Point; clickNode?: string; start?: Point; sizing?: boolean; radius?: Point; cursor?: Point; path?: Path; spine?: Segment[]; spineRange?: string;
}
export const drawingTools: DrawTool[] = ["pen", "rect", "circle", "sector", "strip", "addPath", "shore", "ridge", "peak", "slopeLine", "center", "harbor"];
const penTools: DrawTool[] = ["pen", "addPath", "shore"];
export const doubleClickTools: DrawTool[] = [...penTools, "ridge", "slopeLine"];

export function startDrawing(e: Editor, tool: DrawTool, owner?: string, member?: number, sources = e.geoSelection): GeoDraft {
    const d = e.project.design, ids = [...sources];
    if (tool === "strip" && owner) {
        const c = d.geoNodes.find(n => n.id === owner)?.construction;
        if (c?.type === "strip") ids.splice(0, ids.length, ...c.of);
    }
    if (tool === "strip") stripConstruction(d, ids);
    const draft = { tool, owner, member, ids, field: e.displayField, nodes: [], anchors: [], reverse: false, nextId: nodeIds(d) };
    return draft;
}
export function stripSource(d: Design, draft: GeoDraft) {
    return d.geoNodes.findLast(n => draft.ids.includes(n.id));
}
function stripPreview(e: Editor, draft: GeoDraft) {
    const d = e.project.design, c = stripConstruction(d, draft.ids, draft.anchors.length === 2 ? stripRange(draft.anchors, draft.reverse) : undefined);
    const shapes = new Map([...e.project.terrain.regions].map(([id, r]) => [id, r.shape]));
    return makeShape({ id: "", label: "", construction: c, function: { type: "blend" } }, shapes, d.grid.step / 8).spine;
}
export function updatePreview(e: Editor, draft: GeoDraft) {
    const { tool, cursor, start, radius, nodes } = draft;
    draft.path = undefined;
    if (tool === "strip") {
        const range = JSON.stringify([draft.anchors, draft.reverse]);
        if (range !== draft.spineRange) {
            draft.spine = stripPreview(e, draft); draft.spineRange = range;
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
    e.map.draw();
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
    const { tool, field, owner, member } = draft, n = d.geoNodes.find(n => n.id === owner);
    if (tool === "strip") {
        const range = stripRange(draft.anchors, draft.reverse);
        if (n?.construction.type === "strip") {
            stripConstruction(d, draft.ids, range);
            if (range) n.construction.range = range;
            else delete n.construction.range;
            return n;
        }
        return createStrip(d, draft.ids, field, range);
    }
    if (tool === "ridge" || tool === "slopeLine") {
        const f = n!.function;
        const previous = f.type === "slope" && f.kind === "path" ? f.line
            : f.type === "mountain" && member !== undefined ? f.ridges[member].line : undefined;
        const line = { ...previous, points: draft.nodes.map(({ p }, i) => {
            if (previous?.points[i]?.h !== undefined) return { p, h: previous.points[i].h };
            if (tool === "ridge") return { p, h: tenth(sampleField(terrain, "height", p)) };
            if (i === 0) return { p, h: 0 };
            if (i === draft.nodes.length - 1) return { p, h: 2 };
            return { p };
        }) };
        if (line.points.length < 2) throw Error("折线至少需要两个顶点");
        if (tool === "slopeLine") {
            if (n!.function.type === "slope" && n!.function.kind === "path") n!.function.line = line;
            else n!.function = defaultFunction("slope", { line })!;
        }
        else if (f.type === "mountain") {
            if (member !== undefined) f.ridges[member].line = line;
            else f.ridges.push({ line, widths: [5, 5], widthNoise: { ...ridgeNoiseDefaults }, heightNoise: { ...ridgeNoiseDefaults } });
        }
        return n!;
    }
    if (tool === "peak" || tool === "center" || tool === "harbor") {
        const p = draft.nodes[0]?.p;
        if (!p) throw Error("请先在地图上选择一个点");
        const h = tenth(sampleField(terrain, "height", p));
        if (tool === "peak" && n?.function.type === "mountain") {
            if (member !== undefined) n.function.peaks[member].at.p = p;
            else n.function.peaks.push({ at: { p, h }, radius: 5, noise: 0, scale: 12 });
        }
        if (tool === "harbor" && n?.function.type === "coast") n.function.harbor.center = p;
        if (tool === "center" && n) {
            if (n.function.type === "slope" && n.function.kind === "radial") n.function.center = p;
            else n.function = { type: "slope", kind: "radial", center: p, ...functionDefaults.slope };
        }
        return n!;
    }
    const path = (tool === "rect" || tool === "circle" || tool === "sector") ?
        shapePath(tool, draft.start!, draft.radius ?? draft.cursor!, draft.nextId, draft.cursor) : closedPen(draft.nodes);
    if (tool === "shore" && n) {
        if (n.function.type === "coast") n.function.shore = path;
        else n.function = defaultFunction("coast", { shore: path,
            center: constructionCenter(n.construction, d.grid.step, terrain.grid, terrain.regions.get(n.id)) })!;
        return n;
    }
    if (tool === "addPath" && n?.construction.type === "free") {
        n.construction.paths.push(path); return n;
    }
    return createFree(d, path, field, draft.ids[0]);
}
export function draftPointer(e: Editor, phase: "down" | "move" | "up", raw: Point, ev: PointerEvent) {
    const draft = e.map.draft;
    if (!draft) return false;
    const { tool } = draft;
    const at = !ev.ctrlKey && penTools.includes(tool) && !(phase === "move" && draft.down) ?
        snapPoint(e.map.project.terrain, e.map.project.design, raw, e.map.scale, draft.owner) : raw;
    if (phase === "down") {
        draft.clickNode = undefined;
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
    if (tool === "strip") {
        const source = stripSource(e.project.design, draft);
        const nodes = source?.construction.type === "free" ? source.construction.paths.flatMap(p => p.nodes) : [];
        const v = nodes.filter(v => distance(v.p, at) * e.map.scale <= 9).sort((a, b) => distance(a.p, at) - distance(b.p, at))[0];
        if (v) {
            const next = draft.anchors.length === 1 ? [...draft.anchors, v.id] : [v.id];
            if (next.length === 2) stripConstruction(e.project.design, draft.ids, stripRange(next));
            draft.anchors = next;
        }
    }
    else if (tool === "rect" || tool === "circle" || tool === "sector") {
        if (draft.radius) e.completeDrawing(ev.shiftKey);
        else if (!dragged && !draft.sizing) {
            draft.sizing = true;
            e.hint = tool === "rect" ? "单击确定对角，Esc 放弃" : "单击确定半径，Esc 放弃";
        }
        else if (tool === "sector") {
            if (distance(draft.start!, at) < 1e-6) throw Error("请选取不同的圆心和起始点");
            draft.radius = at;
            e.hint = "单击确定终止角，Esc 放弃";
        }
        else e.completeDrawing(ev.shiftKey);
    }
    else if (penTools.includes(tool) && !dragged && draft.nodes.length >= 3 && distance(down, draft.nodes[0].p) * e.map.scale < 7)
        e.completeDrawing(ev.shiftKey);
    else {
        const drag = penTools.includes(tool) && dragged ? raw : undefined;
        const node = penNode(draft.nextId(), down, drag);
        if (tool === "peak" || tool === "center" || tool === "harbor") draft.nodes = [node];
        else {
            draft.nodes.push(node);
            if (!dragged) draft.clickNode = node.id;
        }
    }
    if (e.map.draft === draft) updatePreview(e, draft);
    return true;
}
export function geoAt(d: Design, id: string): GeoNode {
    return d.geoNodes.find(n => n.id === id)!;
}
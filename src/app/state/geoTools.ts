import { type Design, type GeoNode, type Path, type PathNode, type Point } from "../../core/design/v5.ts";
import { functionDefaults, ridgeNoiseDefaults } from "../../core/design/defaults.ts";
import { type Segment } from "../../core/design/regions.ts";
import { closedPen, nearestSegment, penNode, shapePath, type ShapeTool } from "../../core/edit/paths.ts";
import { createFree, createStrip, defaultFunction, nodeIds, sampleField, stripConstruction, stripRange, tenth } from "../../core/edit/geoNodes.ts";
import { distance } from "../../core/math/geometry.ts";
import { makeShape, nearbyBoundary } from "../../core/terrain/regions.ts";
import { type Terrain } from "../../core/design/results.ts";
type Editor = import("./session.svelte.ts").Editor;

export type DrawTool = ShapeTool | "strip" | "addPath" | "shore" | "ridge" | "peak" | "slopeLine" | "center";
export interface GeoDraft {
    tool: DrawTool; owner?: string; ids: string[]; field: string; nodes: PathNode[]; anchors: string[]; reverse: boolean;
    nextId: () => string; down?: Point; start?: Point; radius?: Point; cursor?: Point; path?: Path; spine?: Segment[]; spineRange?: string;
}
export const drawingTools: DrawTool[] = ["pen", "rect", "circle", "sector", "strip", "addPath", "shore", "ridge", "peak", "slopeLine", "center"];
const penTools: DrawTool[] = ["pen", "addPath", "shore"];

export function startDrawing(e: Editor, tool: DrawTool, owner?: string): GeoDraft {
    const d = e.island.design, ids = [...e.geoSelection];
    if (tool === "strip" && owner) {
        const c = d.geoNodes.find(n => n.id === owner)?.construction;
        if (c?.type === "strip") ids.splice(0, ids.length, ...c.of);
    }
    if (tool === "strip") stripConstruction(d, ids);
    const draft = { tool, owner, ids, field: e.displayField, nodes: [], anchors: [], reverse: false, nextId: nodeIds(d) };
    return draft;
}
export function stripSource(d: Design, draft: GeoDraft) {
    return d.geoNodes.findLast(n => draft.ids.includes(n.id));
}
function stripPreview(e: Editor, draft: GeoDraft) {
    const d = e.island.design, c = stripConstruction(d, draft.ids, draft.anchors.length === 2 ? stripRange(draft.anchors, draft.reverse) : undefined);
    const shapes = new Map([...e.island.terrain.regions].map(([id, r]) => [id, r.shape]));
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
        draft.path = { closed: true, nodes: preview };
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
    const { tool, field, owner } = draft, n = d.geoNodes.find(n => n.id === owner);
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
        const line = { points: draft.nodes.map(({ p }, i) => {
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
        else if (n?.function.type === "mountain") n.function.ridges.push({ line, widths: [5, 5], widthNoise: { ...ridgeNoiseDefaults }, heightNoise: { ...ridgeNoiseDefaults } });
        return n!;
    }
    if (tool === "peak" || tool === "center") {
        const p = draft.nodes[0]?.p;
        if (!p) throw Error("请先在地图上选择一个点");
        const h = tenth(sampleField(terrain, "height", p));
        if (tool === "peak" && n?.function.type === "mountain") n.function.peaks.push({ at: { p, h }, radius: 5, noise: 0, scale: 12 });
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
        else n.function = defaultFunction("coast", { shore: path })!;
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
        snapPoint(e.map.island.terrain, e.map.island.design, raw, e.map.scale, draft.owner) : raw;
    if (phase === "down") {
        draft.down = at;
        if (["rect", "circle", "sector"].includes(tool)) draft.start ??= at;
    }
    draft.cursor = at;
    if (phase !== "up") {
        updatePreview(e, draft); return true;
    }
    const down = draft.down;
    draft.down = undefined;
    if (!down) return true;
    if (tool === "strip") {
        const source = stripSource(e.island.design, draft);
        const nodes = source?.construction.type === "free" ? source.construction.paths.flatMap(p => p.nodes) : [];
        const v = nodes.filter(v => distance(v.p, at) * e.map.scale <= 9).sort((a, b) => distance(a.p, at) - distance(b.p, at))[0];
        if (v) {
            const next = draft.anchors.length === 1 ? [...draft.anchors, v.id] : [v.id];
            if (next.length === 2) stripConstruction(e.island.design, draft.ids, stripRange(next));
            draft.anchors = next;
        }
    }
    else if (tool === "rect" || tool === "circle" || tool === "sector" && draft.radius) e.completeDrawing();
    else if (tool === "sector") {
        draft.radius = at; e.hint = "单击确定终止角，Esc 放弃";
    }
    else if ((tool === "pen" || tool === "addPath") && draft.nodes.length >= 3 && distance(down, draft.nodes[0].p) * e.map.scale < 7) e.completeDrawing();
    else {
        const drag = penTools.includes(tool) && distance(down, raw) * e.map.scale > 3 ? raw : undefined;
        const node = penNode(draft.nextId(), down, drag);
        if (tool === "peak" || tool === "center") draft.nodes = [node];
        else draft.nodes.push(node);
    }
    if (e.map.draft === draft) updatePreview(e, draft);
    return true;
}
export function geoAt(d: Design, id: string): GeoNode {
    return d.geoNodes.find(n => n.id === id)!;
}
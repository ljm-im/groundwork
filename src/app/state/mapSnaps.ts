import { geometryAt, geometryIndex, type CurveSlot } from "../../core/design/curveReferences.ts";
import { flattenPath, neighbor } from "../../core/design/path.ts";
import { type Curve, type Point } from "../../core/design/v5.ts";
import { displayCurveTolerance, geometryPath, parameterPoints, pathEntries, type GeoControl } from "../../core/edit/geoControls.ts";
import { type Handle, type Selection } from "../../core/edit/types.ts";
import { directionRay, indexSnapTargets, projectToRay, snapPixels, squareCorner, type SnapLine, type SnapPoint, type SnapResult } from "../../core/edit/snapping.ts";
import { distance } from "../../core/math/geometry.ts";
import { showsParameterGeometry } from "../../render/geoOverlay.ts";
import { hasSamples } from "../../render/map.ts";
type Editor = import("./session.svelte.ts").Editor;

export type SnapModifiers = Pick<PointerEvent, "ctrlKey" | "shiftKey">;
export type DragSnap = (pointer: Point, modifiers: SnapModifiers) => SnapResult;

export function modifiedSnapPoint(pointer: Point, { ctrlKey, shiftKey }: SnapModifiers, origin?: Point, square = false) {
    if (ctrlKey) return pointer;
    if (!shiftKey) return;
    if (!origin) return pointer;
    return square ? squareCorner(origin, pointer) : projectToRay(directionRay(origin, pointer), pointer);
}

const placement = (kind: string, id: string, path: number) => kind + ":" + id + "." + path;
export const parameterSnapGroup = (id: string) => "parameter:" + id;
const sectionSnapGroup = (id: string) => "section:" + id;

export function mapSnapTargets(editor: Editor) {
    const { map, mapView, curves } = editor, view = mapView!;
    const { design, terrain } = view.project, { selection } = view;
    const margin = 4 * snapPixels;
    const [left, bottom] = map.world(-margin, map.height + margin);
    const [right, top] = map.world(map.width + margin, -margin);
    const tolerance = displayCurveTolerance(design.grid.step / 8, map.scale);
    const empty = !hasSamples(terrain);
    const points: SnapPoint[] = [], lines: SnapLine[] = [];
    const slots = new Map<string, CurveSlot>();
    for (const slot of curves.slots.values()) {
        const { location } = slot;
        if (location.kind === "geo" || location.kind === "geometry")
            slots.set(placement(location.kind === "geo" ? "geoNode" : "geometry", location.id, geometryIndex(slot)), slot);
    }
    function curveGroup(kind: string, id: string, path: number) {
        const key = placement(kind, id, path), slot = slots.get(key);
        return slot ? curves.source(slot).slot.key : key;
    }
    function pointInView(point: Point, group: string, index: number) {
        const [x, y] = point;
        if (x >= left && x <= right && y >= bottom && y <= top) points.push({ point, group, index });
    }
    function addCurve(curve: Curve, group: string) {
        for (const [i, node] of curve.nodes.entries()) pointInView(node.p, group, i);
        for (const { a, b } of flattenPath(curve, tolerance)) {
            if (Math.min(a[0], b[0]) <= right && Math.max(a[0], b[0]) >= left &&
                Math.min(a[1], b[1]) <= top && Math.max(a[1], b[1]) >= bottom) lines.push({ a, b, group });
        }
    }

    for (const node of design.geoNodes) {
        const active = selection?.kind === "geoNode" && selection.id === node.id;
        const boundaries = active || empty || !node.disabled && (view.layers.geoNodes || node.outline || node.fill);
        const parameters = showsParameterGeometry(view, node);
        for (const [path, curve] of pathEntries(node)) {
            if (path >= 0 ? boundaries : parameters) addCurve(curve, curveGroup("geoNode", node.id, path));
        }
        if (parameters) for (const [i, point] of parameterPoints(node)) pointInView(point, parameterSnapGroup(node.id), i);
    }
    if (selection?.kind === "geometry") {
        const item = geometryAt(design, selection.id);
        if (item && "curve" in item) addCurve(item.curve, curveGroup("geometry", selection.id, -1));
    }
    for (const section of design.sections) {
        if (view.layers.sections || view.objectGeometry?.kind === "section" && view.objectGeometry.id === section.id)
            section.points.forEach((point, i) => pointInView(point, sectionSnapGroup(section.id), i));
    }

    return { snap: indexSnapTargets(points, lines, map.scale), curveGroup };
}

export function controlSnap(editor: Editor, selection: Selection, control: GeoControl): DragSnap | undefined {
    const { role, point, index, path } = control, { kind, id } = selection;
    if (role === "body" || role === "outline" || role === "curve" || role === "arc") return;

    const { snap, curveGroup } = mapSnapTargets(editor);
    if (role === "parameter") {
        const exclude = { group: parameterSnapGroup(id), indices: [path] };
        return (pointer, ev) => {
            const modified = modifiedSnapPoint(pointer, ev, point);
            return modified ? { point: modified } : snap(pointer, editor.map.scale, { exclude });
        };
    }

    const owner = editor.geometryOwner(selection)!;
    const curve = geometryPath(owner, path)!;
    const group = curveGroup(kind, id, path);
    if (role === "segment") {
        const next = neighbor(curve, index, 1)!;
        const before = neighbor(curve, index, -1), after = neighbor(curve, next, 1);
        const endpoints = [{ p: curve.nodes[index].p, adjacent: before }, { p: curve.nodes[next].p, adjacent: after }];
        const exclude = { group, indices: [before, index, next, after].filter(i => i !== undefined) };
        return (pointer, ev) => {
            const modified = modifiedSnapPoint(pointer, ev, point);
            if (modified) return { point: modified };
            const dx = pointer[0] - point[0], dy = pointer[1] - point[1];
            let best: SnapResult = { point: pointer }, gap = Infinity;
            for (const { p, adjacent } of endpoints) {
                const target: Point = [p[0] + dx, p[1] + dy];
                const alignmentPoints = adjacent === undefined ? [] : [curve.nodes[adjacent].p];
                const result = snap(target, editor.map.scale, { alignmentPoints, exclude });
                const correction = distance(target, result.point);
                if (!result.snapped || correction >= gap) continue;
                best = { ...result, point: [pointer[0] + (result.point[0] - target[0]), pointer[1] + (result.point[1] - target[1])] };
                gap = correction;
            }
            return best;
        };
    }

    const origin = curve.nodes[index].p;
    const adjacent = [neighbor(curve, index, -1), neighbor(curve, index, 1)].filter(i => i !== undefined);
    const exclude = { group, indices: [index, ...adjacent] };
    const alignmentPoints = role === "vertex" ? adjacent.map(i => curve.nodes[i].p) : [origin];
    return (pointer, ev) => {
        const modified = modifiedSnapPoint(pointer, ev, origin);
        return modified ? { point: modified } : snap(pointer, editor.map.scale, { alignmentPoints, exclude });
    };
}

export function sectionSnap(editor: Editor, handle: Handle): DragSnap | undefined {
    if (handle.kind !== "section") return;
    const { snap } = mapSnapTargets(editor), exclude = { group: sectionSnapGroup(handle.id), indices: [0, 1] };
    return (pointer, ev) => {
        const modified = modifiedSnapPoint(pointer, ev, handle.point);
        return modified ? { point: modified } : snap(pointer, editor.map.scale, { exclude });
    };
}
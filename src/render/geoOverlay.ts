import { type MapView, type ProjectMap } from "./map.ts";
import { displayCurveTolerance, geoControls, geometryPath, parameterPoints, pathEntries, type CurveOwner, type GeoControl } from "../core/edit/geoControls.ts";
import { flattenPath, flattenSegment } from "../core/design/path.ts";
import { type Point, type PlacedGeoNode } from "../core/design/v5.ts";
import { type Segment } from "../core/design/regions.ts";
import { overlay, type MapColors } from "./palette.ts";
import { type SnapGuide } from "../core/edit/snapping.ts";

type HandleState = "normal" | "hovered" | "selected";

export function drawSnapGuides(map: ProjectMap, guides: readonly SnapGuide[], accent: string) {
    const { ctx } = map;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    for (const guide of guides) {
        ctx.beginPath();
        if (guide.kind === "point") ctx.arc(...map.screen(guide.point), 6, 0, 2 * Math.PI);
        else {
            const from = map.screen(guide.from), to = map.screen(guide.to);
            ctx.setLineDash([4, 4]);
            ctx.moveTo(...from);
            ctx.lineTo(...to);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            for (const [x, y] of [from, to]) {
                ctx.moveTo(x - 2, y - 2);
                ctx.lineTo(x + 2, y + 2);
                ctx.moveTo(x - 2, y + 2);
                ctx.lineTo(x + 2, y - 2);
            }
        }
        ctx.stroke();
    }
    ctx.restore();
}

export function drawHandle(ctx: CanvasRenderingContext2D, colors: MapColors, x: number, y: number, state: HandleState = "normal", control = false) {
    ctx.beginPath();
    ctx.arc(x, y, control ? overlay.controlRadius : overlay.handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = state === "selected" ? colors.accent : colors.bgPanel;
    ctx.fill();
    if (state === "hovered") {
        const alpha = ctx.globalAlpha;
        ctx.globalAlpha = alpha * overlay.segmentHoverOpacity;
        ctx.fillStyle = colors.accent;
        ctx.fill();
        ctx.globalAlpha = alpha;
    }
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = overlay.handleOutline;
    ctx.stroke();
}

export function showsParameterGeometry(view: MapView, node: PlacedGeoNode) {
    return view.selection?.kind === "geoNode" && view.selection.id === node.id || view.layers.geoNodes && !node.disabled;
}

export function hasOutlinePreview(paths?: ReadonlySet<number>) {
    if (!paths) return false;
    return [...paths].some(i => i >= 0);
}

function strokeEdges(map: ProjectMap, segments: Segment[], color: string, width: number, dashed = false) {
    const ctx = map.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [...overlay.dash] : []);
    ctx.beginPath();
    let last: Point | undefined;
    for (const { a, b } of segments) {
        if (!last || a[0] !== last[0] || a[1] !== last[1]) ctx.moveTo(...map.screen(a));
        ctx.lineTo(...map.screen(b));
        last = b;
    }
    ctx.stroke();
    ctx.setLineDash([]);
}

function selectedLine(view: MapView, id: string) {
    const { selection, geometry, vertex } = view;
    if (!view.draft && selection?.kind === "geoNode" && selection.id === id && geometry?.kind === "curve" && geometry.index < 0 && !vertex)
        return geometry.index;
}

function sameControl(a?: GeoControl, b?: GeoControl) {
    return a && b && a.role === b.role && a.path === b.path && a.index === b.index;
}

export function drawParameterGeometry(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design;
    const tolerance = displayCurveTolerance(d.grid.step / 8, scale);
    ctx.save();
    for (const owner of d.geoNodes) {
        const visible = showsParameterGeometry(view, owner), preview = view.dragNodes?.get(owner.id);
        if (!visible && (!preview || owner.disabled)) continue;
        const drag = view.dragNode?.id === owner.id;
        const n = preview?.node ?? owner;
        const whole = selectedLine(view, n.id), focused = view.selection?.kind === "geoNode" && view.selection.id === n.id;
        const part = !view.draft && focused ? view.vertex : undefined;
        const hover = !view.draft && !view.dragNode && view.hovered?.kind === "geoNode" && view.hovered.id === n.id ? view.hoverPart : undefined;
        const origin = !drag || view.dragCurve === undefined || view.dragCurve >= 0 || view.dragCommitting ? undefined : geometryPath(owner, view.dragCurve);
        if (origin) strokeEdges(map, flattenPath(origin, tolerance), colors.dragOrigin, overlay.parameterWidth, true);
        for (const [i, path] of pathEntries(n)) {
            if (i >= 0 || i === whole || !visible && !preview?.paths.has(i)) continue;
            const edges = flattenPath(path, tolerance);
            const selected = part?.role === "segment" && part.path === i ? path.nodes[part.index]?.id : undefined;
            strokeEdges(map, selected ? edges.filter(edge => edge.from !== selected) : edges, colors.parameterGeometry, overlay.parameterWidth, true);
        }
        if (!visible) continue;
        for (const [i, point] of parameterPoints(n)) {
            if (hover?.role === "parameter" && hover.path === i) continue;
            if (view.draft || !focused || view.geometry?.kind !== "parameter" || view.geometry.index !== i)
                drawHandle(ctx, colors, ...map.screen(point));
        }
        if (n.function.type === "coast" && owner.function.type === "coast" && owner.function.harbor.radius > 0) {
            const { center } = n.function.harbor, { radius } = owner.function.harbor;
            ctx.beginPath();
            ctx.arc(...map.screen(center), radius * scale, 0, Math.PI * 2);
            ctx.strokeStyle = colors.derivedGeometry;
            ctx.lineWidth = overlay.derivedWidth;
            ctx.setLineDash([...overlay.dots]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    ctx.restore();
}

export function drawGeoOverlay(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design, draft = view.draft;
    const dot = (point: Point, state?: HandleState, control = false) => drawHandle(ctx, colors, ...map.screen(point), state, control);
    ctx.save();
    const owner = view.selection?.kind === "geoNode" ? d.geoNodes.find(n => n.id === view.selection!.id) : undefined;
    const n = view.dragNode ?? owner;
    const outline = n?.construction.type === "outline" ? view.outline : undefined;
    const moved = view.dragNode && hasOutlinePreview(view.dragNodes?.get(view.dragNode.id)?.paths);
    if (n?.construction.type === "outline" && (!draft || draft.owner === n.id) && (moved || draft)) {
        for (const [i, path] of n.construction.outlines.entries()) {
            if (i === view.dragCurve && i === outline) continue;
            strokeEdges(map, flattenPath(path, .6 / scale), colors.accent, overlay.selectedWidth);
        }
        if (moved && owner && view.dragCurve !== undefined && !view.dragCommitting) {
            const path = geometryPath(owner, view.dragCurve);
            if (path) strokeEdges(map, flattenPath(path, .6 / scale), colors.dragOrigin, overlay.selectedWidth);
        }
    }
    if (!draft) {
        const { accent } = colors, tolerance = displayCurveTolerance(d.grid.step / 8, scale);
        function highlight(target: CurveOwner, index: number, segment?: number) {
            const path = geometryPath(target, index);
            if (!path) return;
            const edges = segment === undefined ? flattenPath(path, tolerance) : flattenSegment(path, segment, tolerance);
            strokeEdges(map, edges, accent, overlay.segmentWidth, index < 0);
        }
        function drawControls(target: CurveOwner, handle?: GeoControl) {
            const controls = geoControls(target, view.geometry);
            for (const c of controls) if (c.role === "in" || c.role === "out") {
                const node = geometryPath(target, c.path)!.nodes[c.index];
                strokeEdges(map, [{ a: node.p, b: c.point }], accent, overlay.controlLine, node.mode === "auto");
            }
            for (const c of controls) {
                const tangent = c.role === "in" || c.role === "out";
                const hover = sameControl(handle, c), selected = sameControl(view.vertex, c);
                const state = selected ? "selected" : hover ? "hovered" : "normal";
                dot(c.point, state, tangent);
                if (hover) handle = undefined;
            }
            return handle;
        }
        const hovered = view.hoverPart, hoverOwner = view.hovered?.kind === "geoNode" ? view.hovered.id : undefined;
        const onOwner = !!owner && hoverOwner === owner.id, whole = n && selectedLine(view, n.id);
        let hoverHandle: GeoControl | undefined;
        if (hovered && !view.dragNode) {
            if (hovered.role === "vertex" || hovered.role === "parameter" || hovered.role === "in" || hovered.role === "out" || hovered.role === "arc")
                hoverHandle = hovered;
            else {
                const selected = onOwner && (sameControl(hovered, view.vertex) ||
                    hovered.role === "outline" && hovered.path === view.outline || hovered.role === "curve" && hovered.path === whole);
                const target = !selected && d.geoNodes.find(node => node.id === hoverOwner);
                if (target) {
                    ctx.save();
                    ctx.globalAlpha = overlay.segmentHoverOpacity;
                    highlight(target, hovered.path, hovered.role === "segment" ? hovered.index : undefined);
                    ctx.restore();
                }
            }
        }
        if (n) {
            const index = outline ?? whole;
            if (index !== undefined) highlight(n, index);
            if (view.vertex?.role === "segment") highlight(n, view.vertex.path, view.vertex.index);
            const remaining = drawControls(n, onOwner ? hoverHandle : undefined);
            if (onOwner) hoverHandle = remaining;
        }
        if (hoverHandle) dot(hoverHandle.point, "hovered", hoverHandle.role === "in" || hoverHandle.role === "out");
        const h = view.selection, hover = view.hovered;
        const shared = h?.kind === "curve" ? d.curves[h.id] : undefined;
        if (hover?.kind === "curve" && (h?.kind !== "curve" || h.id !== hover.id) && d.curves[hover.id])
            strokeEdges(map, flattenPath(d.curves[hover.id].curve, tolerance), colors.accentHover, overlay.hoverWidth);
        if (shared) {
            const current = view.dragShared ?? shared;
            if (view.dragShared && !view.dragCommitting) strokeEdges(map, flattenPath(shared.curve, tolerance), colors.dragOrigin, overlay.parameterWidth, true);
            strokeEdges(map, flattenPath(current.curve, tolerance), accent, overlay.selectedWidth);
            if (view.vertex?.role === "segment") highlight(current, -1, view.vertex.index);
            drawControls(current, !view.dragShared && hover?.kind === "curve" && hover.id === h!.id ? view.hoverPart : undefined);
        }
    }
    if (draft) {
        if (draft.tool === "strip") {
            strokeEdges(map, draft.spine ?? [], colors.accent, overlay.selectedWidth);
            const upper = d.geoNodes.findLast(n => draft.ids.includes(n.id));
            if (upper?.construction.type === "outline") for (const path of upper.construction.outlines) for (const v of path.nodes)
                dot(v.p, draft.anchors.includes(v.id) ? "selected" : "normal");
        }
        else {
            if (["peak", "center", "harbor"].includes(draft.tool)) {
                if (!draft.nodes.length && draft.cursor) dot(draft.cursor);
            }
            else if (draft.path) strokeEdges(map, flattenPath(draft.path, .5 / scale), colors.accent, overlay.selectedWidth, true);
            else {
                const points = [...(draft.start ? [draft.start] : []), ...draft.nodes.map(v => v.p), ...(draft.cursor ? [draft.cursor] : [])];
                strokeEdges(map, points.slice(1).map((b, i) => ({ a: points[i], b })), colors.parameterGeometry, overlay.parameterWidth, true);
            }
            if (draft.curve?.endpoint !== undefined) {
                const { endpoint, original } = draft.curve;
                dot(original.nodes[endpoint].p, "selected");
                dot(original.nodes[endpoint === 0 ? original.nodes.length - 1 : 0].p);
            }
            for (const v of draft.nodes) dot(v.p);
        }
    }
    ctx.restore();
}
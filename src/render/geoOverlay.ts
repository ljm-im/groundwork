import { type MapView, type ProjectMap } from "./map.ts";
import { displayCurveTolerance, geoControls, geometryPath, parameterPoints, pathEntries, type GeoControl } from "../core/edit/geoControls.ts";
import { flattenPath } from "../core/design/path.ts";
import { type Point, type GeoNode } from "../core/design/v5.ts";
import { type Segment } from "../core/design/regions.ts";
import { overlay, type MapColors } from "./palette.ts";

export function drawHandle(ctx: CanvasRenderingContext2D, colors: MapColors, x: number, y: number, selected: boolean, control = false) {
    ctx.beginPath();
    ctx.arc(x, y, control ? overlay.controlRadius : overlay.handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = selected ? colors.accent : colors.bgPanel;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = overlay.handleOutline;
    ctx.fill();
    ctx.stroke();
}

export function showsParameterGeometry(view: MapView, node: GeoNode) {
    return view.selection?.kind === "geoNode" && view.selection.id === node.id || view.layers.geoNodes && !node.disabled;
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

export function drawParameterGeometry(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design;
    const tolerance = displayCurveTolerance(d.grid.step / 8, scale);
    ctx.save();
    for (const owner of d.geoNodes) {
        if (!showsParameterGeometry(view, owner) || view.draft && view.draft.owner !== owner.id) continue;
        const drag = view.dragNode?.id === owner.id ? view.dragNode : undefined;
        const n = drag ?? owner;
        const hovered = view.hovered?.kind === "geoNode" && view.hovered.id === n.id ? view.hoverGeometry : undefined;
        const origin = !drag || view.dragCurve === undefined || view.dragCommitting ? undefined : geometryPath(owner, view.dragCurve);
        if (origin) strokeEdges(map, flattenPath(origin, tolerance), colors.dragOrigin, overlay.parameterWidth, true);
        for (const [i, path] of pathEntries(n)) {
            if (i >= 0) continue;
            const color = hovered?.kind === "path" && hovered.index === i ? colors.accent : colors.parameterGeometry;
            strokeEdges(map, flattenPath(path, tolerance), color, overlay.parameterWidth, true);
        }
        for (const [i, point] of parameterPoints(n))
            drawHandle(ctx, colors, ...map.screen(point), hovered?.kind === "parameter" && hovered.index === i);
        if (n.function.type === "coast" && owner.function.type === "coast" && owner.function.harbor.radius > 0) {
            const { center } = n.function.harbor, { radius } = owner.function.harbor;
            ctx.beginPath();
            ctx.arc(...map.screen(center), radius * scale, 0, Math.PI * 2);
            ctx.strokeStyle = colors.parameterGeometry;
            ctx.lineWidth = overlay.parameterWidth;
            ctx.setLineDash([...overlay.dash]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
    ctx.restore();
}

export function drawGeoOverlay(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design, draft = view.draft;
    const dot = (point: Point, active = false, control = false) => drawHandle(ctx, colors, ...map.screen(point), active, control);
    ctx.save();
    const owner = view.selection?.kind === "geoNode" ? d.geoNodes.find(n => n.id === view.selection!.id) : undefined;
    if (owner && (!draft || draft.owner === owner.id)) {
        const n = view.dragNode ?? owner;
        if (n.construction.type === "free" && (view.dragNode && view.dragCurve === undefined || draft))
            for (const path of n.construction.paths)
                strokeEdges(map, flattenPath(path, .6 / scale), colors.accent, overlay.selectedWidth);
        if (!draft) for (const c of geoControls(n, view.geometry)) {
            const tangent = c.role === "in" || c.role === "out";
            if (tangent) {
                const node = geometryPath(n, c.path)!.nodes[c.index];
                strokeEdges(map, [{ a: node.p, b: c.point }], colors.accent, overlay.controlLine, node.mode === "auto");
            }
            const active = view.vertex && (["path", "role", "index"] as (keyof GeoControl)[]).every(k => view.vertex![k] === c[k]);
            dot(c.point, !!active, tangent);
        }
    }
    if (draft) {
        if (draft.tool === "strip") {
            strokeEdges(map, draft.spine ?? [], colors.accent, overlay.selectedWidth);
            const upper = d.geoNodes.findLast(n => draft.ids.includes(n.id));
            if (upper?.construction.type === "free") for (const path of upper.construction.paths) for (const v of path.nodes)
                dot(v.p, draft.anchors.includes(v.id));
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
            for (const v of draft.nodes) dot(v.p);
        }
    }
    ctx.restore();
}
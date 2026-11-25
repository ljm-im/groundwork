import { type MapView, type ProjectMap } from "./map.ts";
import { displayCurveTolerance, geoControls, geometryPath, parameterPoints, pathEntries, type GeoControl } from "../core/edit/geoControls.ts";
import { flattenPath } from "../core/design/path.ts";
import { type Point, type GeoNode } from "../core/design/v5.ts";
import { type Segment } from "../core/design/regions.ts";
import { mapColors, overlay } from "./palette.ts";

export function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, selected: boolean, control = false) {
    ctx.beginPath();
    ctx.arc(x, y, control ? overlay.controlRadius : overlay.handleRadius, 0, Math.PI * 2);
    ctx.fillStyle = selected ? mapColors.accent : mapColors.bgPanel;
    ctx.strokeStyle = mapColors.accent;
    ctx.lineWidth = overlay.handleOutline;
    ctx.fill();
    ctx.stroke();
}

export function showsParameterGeometry(view: MapView, node: GeoNode) {
    return view.selection?.kind === "geoNode" && view.selection.id === node.id || view.layers.geoNodes && !node.disabled;
}

export function drawGeoOverlay(map: ProjectMap, view: MapView) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design, draft = view.draft;
    const edges = (segments: Segment[], color: string, width: number, dashed = false) => {
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
    };
    const dot = (point: Point, active = false, control = false) => drawHandle(ctx, ...map.screen(point), active, control);
    const tolerance = displayCurveTolerance(d.grid.step / 8, scale);
    function controls(n: GeoNode, numeric: GeoNode<number>, selected: boolean) {
        for (const [i, path] of pathEntries(n)) {
            if (i < 0) edges(flattenPath(path, tolerance), mapColors.parameterGeometry, overlay.parameterWidth, true);
            else if (selected && (view.dragNode || draft?.owner === n.id))
                edges(flattenPath(path, .6 / scale), mapColors.accent, overlay.selectedWidth);
        }
        for (const [, point] of parameterPoints(n)) dot(point);
        if (n.function.type === "coast" && numeric.function.type === "coast" && numeric.function.harbor.radius > 0) {
            const { center } = n.function.harbor, { radius } = numeric.function.harbor;
            ctx.beginPath();
            ctx.arc(...map.screen(center), radius * scale, 0, Math.PI * 2);
            ctx.strokeStyle = mapColors.parameterGeometry;
            ctx.lineWidth = overlay.parameterWidth;
            ctx.setLineDash([...overlay.dash]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (draft || !selected) return;
        for (const c of geoControls(n, view.geometry)) {
            const tangent = c.role === "in" || c.role === "out";
            if (tangent) edges([{ a: geometryPath(n, c.path)!.nodes[c.index].p, b: c.point }], mapColors.accent, overlay.controlLine);
            const active = view.vertex && (["path", "role", "index"] as (keyof GeoControl)[]).every(k => view.vertex![k] === c[k]);
            dot(c.point, !!active, tangent);
        }
    }
    ctx.save();
    const owner = view.selection?.kind === "geoNode" ? d.geoNodes.find(n => n.id === view.selection!.id) : undefined;
    if (!draft) for (const node of d.geoNodes) if (node !== owner && showsParameterGeometry(view, node))
        controls(node, node, false);
    if (owner && (!draft || draft.owner === owner.id)) controls(view.dragNode ?? owner, owner, true);
    if (draft) {
        if (draft.tool === "strip") {
            edges(draft.spine ?? [], mapColors.accent, overlay.selectedWidth);
            const upper = d.geoNodes.findLast(n => draft.ids.includes(n.id));
            if (upper?.construction.type === "free") for (const path of upper.construction.paths) for (const v of path.nodes)
                dot(v.p, draft.anchors.includes(v.id));
        }
        else {
            if (["peak", "center", "harbor"].includes(draft.tool)) {
                if (!draft.nodes.length && draft.cursor) dot(draft.cursor);
            }
            else if (draft.path) edges(flattenPath(draft.path, .5 / scale), mapColors.accent, overlay.selectedWidth, true);
            else {
                const points = [...(draft.start ? [draft.start] : []), ...draft.nodes.map(v => v.p), ...(draft.cursor ? [draft.cursor] : [])];
                edges(points.slice(1).map((b, i) => ({ a: points[i], b })), mapColors.parameterGeometry, overlay.parameterWidth, true);
            }
            for (const v of draft.nodes) dot(v.p);
        }
    }
    ctx.restore();
}
import { geometryAt } from "../core/design/curveReferences.ts";
import { geometrySelectionPath, holderLayer, holderTarget, includesSelection, partControl, selectionLayers, selectionPlacement,
    type HolderLayer, type SelectionPath } from "../core/edit/selection.ts";
import { type MapView, type ProjectMap } from "./map.ts";
import { displayCurveTolerance, geoControls, geometryPath, parameterPoints, pathEntries } from "../core/edit/geoControls.ts";
import { flattenPath, flattenSegment } from "../core/design/path.ts";
import { type Curve, type Point, type PlacedGeoNode } from "../core/design/v5.ts";
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

export function drawPoint(ctx: CanvasRenderingContext2D, colors: MapColors, x: number, y: number, state: "selected" | "hovered", handle: HandleState = state) {
    drawHandle(ctx, colors, x, y, handle);
    ctx.save();
    if (state === "hovered") ctx.globalAlpha *= .5;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

export function showsParameterGeometry(view: MapView, node: PlacedGeoNode) {
    const selection = view.selectionPath?.[0];
    return selection?.kind === "geoNode" && selection.id === node.id || view.layers.geoNodes && !node.disabled;
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

function drawGeometryCurve(map: ProjectMap, curve: Curve, colors: MapColors, state: HandleState, tolerance: number, candidate = false,
    selectedSegment?: string) {
    const ctx = map.ctx, edges = flattenPath(curve, tolerance);
    if (curve.closed && edges.length) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(...map.screen(edges[0].a));
        for (const { b } of edges) ctx.lineTo(...map.screen(b));
        ctx.closePath();
        ctx.fillStyle = colors.parameterGeometry;
        ctx.globalAlpha *= overlay.geometryFill[state];
        ctx.fill("evenodd");
        ctx.restore();
    }
    const visible = selectedSegment ? edges.filter(edge => edge.from !== selectedSegment) : edges;
    if (state === "selected") strokeEdges(map, visible, colors.accent, curve.closed ? overlay.segmentWidth : overlay.parameterWidth);
    else if (state === "hovered" && !curve.closed)
        strokeEdges(map, visible, candidate ? colors.accent : colors.accentHover, candidate ? overlay.segmentWidth : overlay.parameterWidth);
    else strokeEdges(map, visible, colors.parameterGeometry, overlay.parameterWidth);
}

function focusedTarget(path: SelectionPath | null | undefined, node: PlacedGeoNode) {
    const { root, holder } = selectionLayers(path);
    return root?.kind === "geoNode" && root.id === node.id && holder ? holderTarget(node, holder) : undefined;
}

export function drawParameterGeometry(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design;
    const tolerance = displayCurveTolerance(d.grid.step / 8, scale), hoverGeometry = selectionLayers(view.hoverPath).geometry;
    ctx.save();
    for (const owner of d.geoNodes) {
        const visible = showsParameterGeometry(view, owner), preview = view.dragNodes?.get(owner.id);
        if (!visible && (!preview || owner.disabled)) continue;
        const n = preview?.node ?? owner;
        const selected = !view.draft && focusedTarget(view.selectionPath, n);
        const hovered = !view.draft && focusedTarget(view.hoverPath, n);
        for (const [i, curve] of pathEntries(n)) {
            if (i >= 0 || view.draft?.curve?.pick || !visible && !preview?.paths.has(i) ||
                selected && selected.kind === "curve" && selected.index === i || hoverGeometry && hovered && hovered.kind === "curve" && hovered.index === i) continue;
            strokeEdges(map, flattenPath(curve, tolerance), colors.parameterGeometry, overlay.parameterWidth, true);
        }
        if (!visible) continue;
        for (const [i, point] of parameterPoints(n)) {
            if (selected && selected.kind === "parameter" && selected.index === i || hovered && hovered.kind === "parameter" && hovered.index === i) continue;
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

function placedNode(view: MapView, id: string, preview: boolean) {
    return (preview ? view.dragNodes?.get(id)?.node : undefined) ?? view.project.design.geoNodes.find(n => n.id === id);
}

function shapeAt(view: MapView, path: SelectionPath, preview: boolean): ({ index: number } & ({ curve: Curve } | { point: Point })) | undefined {
    const { root, holder } = selectionLayers(path);
    if (root?.kind === "geometry") {
        const item = preview && view.dragGeometry || geometryAt(view.project.design, root.id);
        if (item) return "curve" in item ? { index: -1, curve: item.curve } : { index: -1, point: item.point };
    }
    if (root?.kind !== "geoNode" || !holder) return;
    const n = placedNode(view, root.id, preview);
    const target = n && holderTarget(n, holder);
    if (!n || !target) return;
    const index = target.index;
    if (target.kind === "parameter") {
        const point = parameterPoints(n).find(([i]) => i === index)?.[1];
        return point && { index, point };
    }
    const curve = geometryPath(n, index);
    return curve && { index, curve };
}

export function visibleControlCurves(view: MapView, preview = false): { curve: Curve; index: number; holder?: HolderLayer }[] {
    const path = view.selectionPath;
    if (!path || view.draft) return [];
    const { root, holder } = selectionLayers(path);
    if (root?.kind === "geoNode" && !holder) {
        const construction = placedNode(view, root.id, preview)?.construction;
        return construction?.type === "outline" ?
            construction.outlines.map((curve, index) => ({ curve, index, holder: holderLayer("outlines", index) })) : [];
    }
    const shape = shapeAt(view, path, preview);
    return shape && "curve" in shape ? [{ ...shape, holder }] : [];
}

function drawSelection(map: ProjectMap, view: MapView, path: SelectionPath, colors: MapColors, state: "selected" | "hovered", tolerance: number) {
    const { leaf, part, root } = selectionLayers(path), selected = state === "selected";
    const shape = shapeAt(view, path, selected);
    if (!leaf || !shape) return;
    const { ctx } = map;
    if ("point" in shape) {
        const screen = map.screen(shape.point);
        if (leaf.kind === "geometry") drawPoint(ctx, colors, ...screen, state);
        else drawHandle(ctx, colors, ...screen, state);
        return;
    }
    const { curve, index } = shape, parameter = root?.kind === "geoNode" && index < 0;
    if (selected && (view.dragGeometry || view.dragNode) && !view.dragCommitting) {
        const origin = shapeAt(view, path, false);
        if (origin && "curve" in origin && origin.curve !== curve)
            strokeEdges(map, flattenPath(origin.curve, tolerance), colors.dragOrigin, overlay.parameterWidth, leaf.kind === "holder" && parameter);
    }
    if (leaf.kind === "holder") {
        ctx.save();
        if (!selected) ctx.globalAlpha *= overlay.segmentHoverOpacity;
        strokeEdges(map, flattenPath(curve, tolerance), colors.accent, overlay.segmentWidth, parameter);
        ctx.restore();
    }
    else if (leaf.kind === "geometry") drawGeometryCurve(map, curve, colors, state, tolerance);
    else if (part) {
        const control = partControl(curve, part, index, selected ? part.kind : view.hoverHandle ?? part.kind);
        if (!control) return;
        if (selected) drawGeometryCurve(map, curve, colors, "normal", tolerance, false, part.kind === "segment" ? part.nodeId : undefined);
        if (control.role === "segment") {
            ctx.save();
            if (!selected) ctx.globalAlpha *= overlay.segmentHoverOpacity;
            strokeEdges(map, flattenSegment(curve, control.index, tolerance), colors.accent, overlay.segmentWidth, parameter);
            ctx.restore();
        }
        else if (!selected) drawHandle(ctx, colors, ...map.screen(control.point), state, control.role === "in" || control.role === "out");
    }
}

function drawSelectedControls(map: ProjectMap, view: MapView, path: SelectionPath, colors: MapColors) {
    const { part } = selectionLayers(path), hover = selectionLayers(view.hoverPath);
    for (const { curve, holder } of visibleControlCurves(view, true)) {
        const prefix: SelectionPath = holder ? [path[0], holder] : [path[0]];
        const hoverPart = view.hoverPath && includesSelection(view.hoverPath, prefix) ? hover.part : undefined;
        const controls = geoControls({ label: "", curve });
        for (const c of controls) if (c.role === "in" || c.role === "out") {
            const node = curve.nodes[c.index];
            strokeEdges(map, [{ a: node.p, b: c.point }], colors.accent, overlay.controlLine, node.mode === "auto");
        }
        for (const c of controls) {
            const node = curve.nodes[c.index], tangent = c.role === "in" || c.role === "out";
            const selected = c.role === part?.kind && node.id === part.nodeId;
            const hovered = c.role === (view.hoverHandle ?? hoverPart?.kind) && node.id === hoverPart?.nodeId;
            drawHandle(map.ctx, colors, ...map.screen(c.point), selected ? "selected" : hovered ? "hovered" : "normal", tangent);
        }
    }
}

export function drawGeoOverlay(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design, draft = view.draft;
    const dot = (point: Point, state?: HandleState, control = false) => drawHandle(ctx, colors, ...map.screen(point), state, control);
    ctx.save();
    const active = view.selectionPath, hover = view.hoverPath;
    if (draft?.owner && !draft.curve?.pick) {
        const owner = d.geoNodes.find(n => n.id === draft.owner);
        if (owner?.construction.type === "outline") for (const path of owner.construction.outlines)
            strokeEdges(map, flattenPath(path, .6 / scale), colors.accent, overlay.selectedWidth);
    }
    if (!draft) {
        const tolerance = displayCurveTolerance(d.grid.step / 8, scale);
        const { root, geometry, holder } = selectionLayers(active);
        const hovered = selectionLayers(hover);
        const placement = root && holder ? selectionPlacement(view.authored, view.curves, root, holder) : undefined;
        if (view.layers.geometry) for (const [id, item] of Object.entries(d.geometry)) {
            if (!item.independent || id === geometry?.id && !placement?.offset?.some(Boolean) ||
                id === hovered.root?.id && hovered.root.kind === "geometry") continue;
            if ("point" in item) dot(item.point);
            else drawGeometryCurve(map, item.curve, colors, "normal", tolerance);
        }
        const hoverIsActive = active && hover && active.length === hover.length && includesSelection(active, hover);
        const hoverIsPart = hovered.part && active && hover && includesSelection(hover, geometrySelectionPath(active));
        if (hover && !hoverIsActive && !hoverIsPart) drawSelection(map, view, hover, colors, "hovered", tolerance);
        if (active) drawSelection(map, view, active, colors, "selected", tolerance);
        if (hover && hoverIsPart && !hoverIsActive && hovered.part?.kind === "segment" && !view.hoverHandle)
            drawSelection(map, view, hover, colors, "hovered", tolerance);
        if (active) drawSelectedControls(map, view, active, colors);
        for (const curve of view.referenceCurves ?? [])
            drawGeometryCurve(map, curve, colors, "hovered", tolerance);
    }
    if (draft?.curve?.pick) {
        const tolerance = displayCurveTolerance(d.grid.step / 8, scale), choices = view.curveChoices ?? [];
        for (const { key, placements } of choices) if (key !== view.hoveredCurveChoice)
            for (const curve of placements) drawGeometryCurve(map, curve, colors, "normal", tolerance);
        for (const { key, placements } of choices) if (key === view.hoveredCurveChoice)
            for (const curve of placements) drawGeometryCurve(map, curve, colors, "hovered", tolerance, true);
    }
    else if (draft) {
        if (draft.tool === "strip") {
            strokeEdges(map, draft.spine ?? [], colors.accent, overlay.selectedWidth);
            const upper = d.geoNodes.findLast(n => draft.ids.includes(n.id));
            if (upper?.construction.type === "outline") for (const path of upper.construction.outlines) for (const v of path.nodes)
                dot(v.p, draft.anchors.includes(v.id) ? "selected" : "normal");
        }
        else {
            if (["peak", "center", "harbor", "geometryPoint"].includes(draft.tool)) {
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
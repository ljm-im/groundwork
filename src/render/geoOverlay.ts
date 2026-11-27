import { geometryAt } from "../core/design/curveReferences.ts";
import { geometrySelectionPath, holderLayer, holderTarget, includesSelection, partControl, selectionLayers, selectionPlacement,
    type HolderLayer, type SelectionPath } from "../core/edit/selection.ts";
import { type CurvePlacement, type MapView, type ProjectMap } from "./map.ts";
import { displayCurveTolerance, geoControls, geometryPath, parameterPoints, pathEntries } from "../core/edit/geoControls.ts";
import { flattenPath, flattenSegment } from "../core/design/path.ts";
import { type Curve, type Point, type PlacedGeoNode } from "../core/design/v5.ts";
import { type Segment } from "../core/design/regions.ts";
import { overlay, type MapColors } from "./palette.ts";
import { type SnapGuide } from "../core/edit/snapping.ts";

export type HighlightState = "hovered" | "selected";
type HandleState = "normal" | HighlightState;

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

export function strokeHighlight(ctx: CanvasRenderingContext2D, colors: MapColors, state: HighlightState, width: number,
    paint: () => void, dashed = false) {
    ctx.save();
    if (state === "hovered") ctx.globalAlpha *= overlay.segmentHoverOpacity;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [...overlay.dash] : []);
    paint();
    ctx.restore();
}

export function drawPoint(ctx: CanvasRenderingContext2D, colors: MapColors, x: number, y: number, state: HighlightState, handle: HandleState = state) {
    drawHandle(ctx, colors, x, y, handle);
    strokeHighlight(ctx, colors, state, 2, () => {
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
    });
}

export function showsParameterGeometry(view: MapView, node: PlacedGeoNode) {
    const selection = view.selectionPath?.[0];
    return selection?.kind === "geoNode" && selection.id === node.id || view.layers.geoNodes && !node.disabled;
}

export function hasOutlinePreview(paths?: ReadonlySet<number>) {
    if (!paths) return false;
    return [...paths].some(i => i >= 0);
}

function traceEdges(map: ProjectMap, segments: Segment[]) {
    const ctx = map.ctx;
    ctx.beginPath();
    let last: Point | undefined;
    for (const { a, b } of segments) {
        if (!last || a[0] !== last[0] || a[1] !== last[1]) ctx.moveTo(...map.screen(a));
        ctx.lineTo(...map.screen(b));
        last = b;
    }
}

function strokeEdges(map: ProjectMap, segments: Segment[], color: string, width: number, dashed = false) {
    const ctx = map.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [...overlay.dash] : []);
    traceEdges(map, segments);
    ctx.stroke();
    ctx.setLineDash([]);
}

function fillCurveFace(map: ProjectMap, edges: Segment[], colors: MapColors, state: keyof typeof overlay.geometryFill) {
    if (!edges.length) return;
    const { ctx } = map;
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

type CurveLayer = ({
    kind: "geometry";
    independent: boolean;
} | {
    kind: "holder";
    dashed: boolean;
} | {
    kind: "segment";
    dashed: boolean;
    index: number;
});

function drawCurveHighlight(map: ProjectMap, curve: Curve, colors: MapColors, state: HighlightState, tolerance: number, layer: CurveLayer) {
    const edges = layer.kind === "segment" ? flattenSegment(curve, layer.index, tolerance) : flattenPath(curve, tolerance);
    const geometry = layer.kind === "geometry";
    if (geometry && curve.closed && (state === "selected" || layer.independent)) fillCurveFace(map, edges, colors, state);
    const width = geometry && !curve.closed ? overlay.parameterWidth : overlay.segmentWidth;
    strokeHighlight(map.ctx, colors, state, width, () => {
        traceEdges(map, edges);
        map.ctx.stroke();
    }, !geometry && layer.dashed);
}

function hoverPlacedCurve(map: ProjectMap, view: MapView, placement: CurvePlacement, colors: MapColors, tolerance: number) {
    drawCurveHighlight(map, placement.curve, colors, "hovered", tolerance, {
        kind: "geometry", independent: !placement.offset && !!geometryAt(view.project.design, placement.id)?.independent
    });
}

function drawCurveCandidate(map: ProjectMap, view: MapView, placement: CurvePlacement, colors: MapColors, tolerance: number, hovered: boolean) {
    if (hovered) hoverPlacedCurve(map, view, placement, colors, tolerance);
    else strokeEdges(map, flattenPath(placement.curve, tolerance), colors.parameterGeometry, overlay.parameterWidth);
}

type Placement = Pick<CurvePlacement, "id" | "offset">;

function samePlacement(a: Placement, b: Placement) {
    return a.id === b.id && (a.offset?.[0] ?? 0) === (b.offset?.[0] ?? 0) && (a.offset?.[1] ?? 0) === (b.offset?.[1] ?? 0);
}

function highlightedPlacements(view: MapView): readonly Placement[] {
    if (view.draft) return [];
    const references = view.referenceCurves ?? [];
    const { root, holder, part } = selectionLayers(view.hoverPath);
    if (part) return references;
    if (root?.kind === "geometry") return [...references, root];
    if (root && holder) {
        const placement = selectionPlacement(view.authored, view.curves, root, holder);
        if (placement) return [...references, placement];
    }
    if (root?.kind === "section" && !holder) {
        const section = view.authored.sections.find(section => section.id === root.id);
        if (section) return [...references, ...section.points.map(({ point: id, offset }) => ({ id, offset }))];
    }
    return references;
}

function focusedTarget(path: SelectionPath | null | undefined, node: PlacedGeoNode) {
    const { root, holder } = selectionLayers(path);
    return root?.kind === "geoNode" && root.id === node.id && holder ? holderTarget(node, holder) : undefined;
}

export function drawParameterGeometry(map: ProjectMap, view: MapView, colors: MapColors) {
    const ctx = map.ctx, scale = map.scale, d = view.project.design, graph = view.curves;
    const tolerance = displayCurveTolerance(d.grid.step / 8, scale);
    const hiddenPaths = new Map<string, Set<number>>();
    for (const highlight of highlightedPlacements(view)) for (const holder of graph.curvePlacements(highlight.id)) {
        if (holder.index >= 0 || !holder.active) continue;
        const placement = { id: highlight.id, offset: graph.offset(graph.ofHolder(holder)) };
        if (!samePlacement(placement, highlight)) continue;
        const { id } = holder.location, paths = hiddenPaths.get(id);
        if (paths) paths.add(holder.index);
        else hiddenPaths.set(id, new Set([holder.index]));
    }
    const hoverPart = selectionLayers(view.hoverPath).part;
    ctx.save();
    for (const owner of d.geoNodes) {
        const visible = showsParameterGeometry(view, owner), preview = view.dragNodes?.get(owner.id);
        if (!visible && (!preview || owner.disabled)) continue;
        const n = preview?.node ?? owner;
        const selected = !view.draft && focusedTarget(view.selectionPath, n);
        const hovered = !view.draft && focusedTarget(view.hoverPath, n);
        for (const [i, curve] of pathEntries(n)) {
            if (i >= 0 || view.draft?.curve?.pick || !visible && !preview?.paths.has(i) || hiddenPaths.get(owner.id)?.has(i) ||
                selected && selected.kind === "curve" && selected.index === i) continue;
            const edges = flattenPath(curve, tolerance);
            const hoveredSegment = hovered && hovered.kind === "curve" && hovered.index === i && hoverPart?.kind === "segment" && !view.hoverHandle;
            strokeEdges(map, hoveredSegment ? edges.filter(edge => edge.from !== hoverPart.nodeId) : edges,
                colors.parameterGeometry, overlay.parameterWidth, true);
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

function drawSelection(map: ProjectMap, view: MapView, path: SelectionPath, colors: MapColors, state: HighlightState,
    tolerance: number, outlineColor?: string) {
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
        drawCurveHighlight(map, curve, colors, state, tolerance, { kind: "holder", dashed: parameter });
    }
    else if (leaf.kind === "geometry") {
        const faceSelected = view.selectionPath && includesSelection(view.selectionPath, path);
        drawCurveHighlight(map, curve, colors, state, tolerance, {
            kind: "geometry", independent: !faceSelected && root?.kind === "geometry" && !!geometryAt(view.project.design, root.id)?.independent
        });
    }
    else if (part) {
        const control = partControl(curve, part, index, selected ? part.kind : view.hoverHandle ?? part.kind);
        if (!control) return;
        if (selected) {
            const edges = flattenPath(curve, tolerance);
            if (curve.closed) fillCurveFace(map, edges, colors, "selected");
            const visible = part.kind === "segment" ? edges.filter(edge => edge.from !== part.nodeId) : edges;
            if (parameter || root?.kind === "geometry") {
                const hover = view.hoverPath, hoveringCurve = hover && includesSelection(hover, geometrySelectionPath(path));
                if (!hoveringCurve || hover.at(-1)?.kind !== "geometry") {
                    const hoveredPart = hoveringCurve && selectionLayers(hover).part;
                    const idle = !view.hoverHandle && hoveredPart && hoveredPart.kind === "segment" ?
                        visible.filter(edge => edge.from !== hoveredPart.nodeId) : visible;
                    strokeEdges(map, idle, colors.parameterGeometry, overlay.parameterWidth, parameter);
                }
            }
            else if (outlineColor) strokeEdges(map, visible, outlineColor, overlay.boundaryWidth);
        }
        if (control.role === "segment") {
            drawCurveHighlight(map, curve, colors, state, tolerance, { kind: "segment", dashed: parameter, index: control.index });
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

export function drawGeoOverlay(map: ProjectMap, view: MapView, colors: MapColors, outlineColor?: string) {
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
        const hovered = selectionLayers(hover), highlights = highlightedPlacements(view);
        const placement = root && holder ? selectionPlacement(view.authored, view.curves, root, holder) : undefined;
        if (view.layers.geometry) for (const [id, item] of Object.entries(d.geometry)) {
            const selected = id === geometry?.id || root?.kind === "section" && id === placement?.id;
            if (!item.independent || selected && !placement?.offset?.some(Boolean) ||
                highlights.some(highlight => samePlacement({ id }, highlight))) continue;
            if ("point" in item) dot(item.point);
            else strokeEdges(map, flattenPath(item.curve, tolerance), colors.parameterGeometry, overlay.parameterWidth);
        }
        const hoverIsActive = active && hover && active.length === hover.length && includesSelection(active, hover);
        const hoverIsPart = hovered.part && active && hover && includesSelection(hover, geometrySelectionPath(active));
        if (hover && !hoverIsActive && !hoverIsPart) drawSelection(map, view, hover, colors, "hovered", tolerance);
        if (active) drawSelection(map, view, active, colors, "selected", tolerance, outlineColor);
        if (hover && hoverIsPart && !hoverIsActive && hovered.part?.kind === "segment" && !view.hoverHandle)
            drawSelection(map, view, hover, colors, "hovered", tolerance);
        if (active) drawSelectedControls(map, view, active, colors);
        for (const placement of view.referenceCurves ?? []) hoverPlacedCurve(map, view, placement, colors, tolerance);
    }
    if (draft?.curve?.pick) {
        const tolerance = displayCurveTolerance(d.grid.step / 8, scale), choices = view.curveChoices ?? [];
        for (const { key, placements } of choices) if (key !== view.hoveredCurveChoice)
            for (const placement of placements) drawCurveCandidate(map, view, placement, colors, tolerance, false);
        for (const { key, placements } of choices) if (key === view.hoveredCurveChoice)
            for (const placement of placements) drawCurveCandidate(map, view, placement, colors, tolerance, true);
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
import { type GeoNode, type Mark, type TextMark, type Point } from "../core/design/v5.ts";
import { displaySteps, markParameters } from "../core/design/functionTable.ts";
import { fieldPrecision, heightId } from "../core/design/defaults.ts";
import { type Issue, type Terrain } from "../core/design/results.ts";
import { type GeoDraft, type Handle, type Selection } from "../core/edit/types.ts";
import { type ProjectView } from "../core/project.ts";
import { type GridDisplay, type layerDefaults, pixelGridSpacing } from "../core/edit/display.ts";
import { type Box } from "../core/math/geometry.ts";
import { clamp, distance, nearest } from "../core/math/geometry.ts";
import { objectIssues } from "../core/checks/issues.ts";
import { hitGeoControl, hitParameterGeometries, hitPathSegment, parameterTarget, type GeoControl, type GeometryTarget } from "../core/edit/geoControls.ts";
import { contourLabels, fieldContours } from "./fieldContours.ts";
import { constrainGeoLabel, constrainSectionLabel, geoLabelPoint } from "./labelLayout.ts";
import { drawGeoOverlay, drawHandle, drawParameterGeometry, showsParameterGeometry } from "./geoOverlay.ts";
import { baseMap, canvasText, contourStyle, interfaceColors, mapColors, overlay, type MapColors, type Theme } from "./palette.ts";
import { displayReading, displayValue } from "../core/design/display.ts";
import { sectionHandles } from "../core/edit/controls.ts";
import { relief } from "./relief.ts";
import { fieldFill } from "./fieldFill.ts";

import { type Region } from "../core/design/regions.ts";
import { type Grid } from "../core/math/geometry.ts";

type Context = CanvasRenderingContext2D;
export type LabelTarget = { kind: "geoNode" | "section"; id: string };
type LabelHit = LabelTarget & { point: Point; box: Box };
export type LabelPreview = LabelTarget & { offset: Point };
export type MapHit = { selection: Selection; control?: GeoControl; handle?: Handle };

const sectionHitRadius = 5, endpointHitRadius = 9;

function geoHit(id: string, control: GeoControl): MapHit {
    return { selection: { kind: "geoNode", id }, control };
}
const bodyControl = (point: Point): GeoControl => ({ role: "body", path: 0, index: 0, point });

export function nextMapHit(hits: Iterable<MapHit>, selection: Selection | null, geometry?: GeometryTarget) {
    let first: MapHit | undefined, found = false;
    for (const hit of hits) {
        if (found) return hit;
        first ??= hit;
        if (hit.selection.kind !== selection?.kind || hit.selection.id !== selection.id) continue;
        const target = hit.control && parameterTarget(hit.control);
        const active = geometry && (geometry.kind === "parameter" || geometry.index < 0) ? geometry : undefined;
        found = target?.kind === active?.kind && target?.index === active?.index;
    }
    return first;
}

export type MapView = Readonly<{
    project: Readonly<ProjectView>;
    layers: Readonly<typeof layerDefaults>;
    grid: Readonly<GridDisplay>;
    displayField: string;
    selection: Selection | null;
    hovered?: Selection;
    hoverGeometry?: GeometryTarget;
    referencedGeo: readonly string[];
    geometry?: GeometryTarget;
    objectGeometry?: Selection;
    vertex?: GeoControl;
    draft?: Readonly<GeoDraft>;
    dragNode?: GeoNode;
    dragCurve?: number;
    dragCommitting?: boolean;
    dragMark?: Readonly<{ id: string; point: Point }>;
    dragLabel?: Readonly<LabelPreview>;
    selectedIssues?: readonly Issue[];
    issueStart?: number;
}>;

const labelFont = (bold = false) => (bold ? canvasText.semibold : canvasText.regular) + " " + canvasText.sm + "px " + canvasText.font;
const issueColor = (colors: MapColors, issue: Issue) => issue.severity === "error" ? colors.danger : colors.warning;
const line = (ctx: Context, points: Point[], closed = false) => {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    if (closed) ctx.closePath();
};

function stroke(ctx: Context, points: Point[], color: string, width: number, dash: number[] = []) {
    line(ctx, points);
    ctx.strokeStyle = color;
    ctx.lineWidth = width!;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
}

const outlines = new WeakMap<Region, { area: Path2D; outline: Path2D }>();
function regionPaths(region: Region, g: Grid) {
    const cached = outlines.get(region);
    if (cached) return cached;
    const area = new Path2D(), outline = new Path2D();
    if (!region.shape.cross) {
        for (const edges of region.shape.boundary()) {
            if (!edges.length) continue;
            area.moveTo(...edges[0].a);
            for (const edge of edges) area.lineTo(...edge.b);
            area.closePath();
        }
        outline.addPath(area);
    }
    else if (!region.cells.length) {
        for (const path of region.shape.boundary()) for (const { a, b } of path) {
            outline.moveTo(...a); outline.lineTo(...b);
        }
    }
    else {
        for (const k of region.cells) {
            const i = k % g.width, j = Math.floor(k / g.width), x = g.xMin + i * g.step, y = g.yMax - j * g.step;
            const right = x + g.step, bottom = y - g.step;
            area.rect(x, bottom, g.step, g.step);
            if (!i || !region.mask[k - 1]) {
                outline.moveTo(x, y); outline.lineTo(x, bottom);
            }
            if (!j || !region.mask[k - g.width]) {
                outline.moveTo(x, y); outline.lineTo(right, y);
            }
            if (i + 1 === g.width || !region.mask[k + 1]) {
                outline.moveTo(right, y); outline.lineTo(right, bottom);
            }
            if (j + 1 === g.height || !region.mask[k + g.width]) {
                outline.moveTo(x, bottom); outline.lineTo(right, bottom);
            }
        }
    }
    const paths = { area, outline };
    outlines.set(region, paths);
    return paths;
}

function circle(ctx: Context, x: number, y: number, r: number, fill: string | null, outline?: string | null, width = 1) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (outline) {
        ctx.strokeStyle = outline;
        ctx.lineWidth = width!;
        ctx.stroke();
    }
}

function mapText(ctx: Context, colors: MapColors, text: string, x: number, y: number, bold = false, maxWidth?: number) {
    ctx.font = labelFont(bold);
    ctx.lineJoin = "round";
    ctx.lineWidth = overlay.labelHalo;
    ctx.strokeStyle = colors.bgPanel;
    ctx.strokeText(text, x, y, maxWidth);
    ctx.fillStyle = colors.text;
    ctx.fillText(text, x, y, maxWidth);
}

const sampledTerrains = new WeakMap<Terrain, boolean>();
export function hasSamples(terrain: Terrain) {
    const known = sampledTerrains.get(terrain);
    if (known !== undefined) return known;
    const sampled = Object.values(terrain.fields).some(field => field.defined.some(Boolean));
    sampledTerrains.set(terrain, sampled);
    return sampled;
}

export function clampMarkPoint([x, y]: Point, [left, top, right, bottom]: Box, width: number, height: number, obstacles: readonly Box[] = []): Point {
    const fit = (value: number, low: number, high: number) => low <= high ? clamp(value, low, high) : (low + high) / 2;
    const fitX = (v: number) => fit(v, -left, width - right), fitY = (v: number) => fit(v, -top, height - bottom);
    let best: Point = [fitX(x), fitY(y)];
    // Expand the obstacles by the mark's footprint so placement can compare anchor positions.
    const blocked = obstacles.map(([l, t, r, b]): Box => [l - right, t - bottom, r - left, b - top]);
    if (!blocked.some(([l, t, r, b]) => best[0] > l && best[0] < r && best[1] > t && best[1] < b)) return best;
    const xs = [best[0], ...blocked.flatMap(([l, , r]) => [fitX(l), fitX(r)])];
    const ys = [best[1], ...blocked.flatMap(([, t, , b]) => [fitY(t), fitY(b)])];
    let leastCovered = Infinity, nearest = Infinity;
    for (const a of xs) for (const b of ys) {
        const covered = obstacles.reduce((area, [l, t, r, bottomEdge]) => area +
            Math.max(0, Math.min(r, a + right) - Math.max(l, a + left)) *
            Math.max(0, Math.min(bottomEdge, b + bottom) - Math.max(t, b + top)), 0);
        const gap = (a - x) ** 2 + (b - y) ** 2;
        if (covered < leastCovered || covered === leastCovered && gap < nearest) {
            leastCovered = covered;
            nearest = gap;
            best = [a, b];
        }
    }
    return best;
}

export class ProjectMap {
    readonly canvas: HTMLCanvasElement;
    readonly ctx: Context;
    scale = 1;
    referenceScale = 1;
    declare center: Point;
    declare width: number;
    declare height: number;
    declare dpr: number;
    private readonly cameraChanged: () => void;

    markObstacles: Box[] = [];
    private markBoxes: { mark: Handle; box: Box }[] = [];
    private labelBoxes: LabelHit[] = [];
    private contourText?: { contours: ReturnType<typeof fieldContours>; camera: [number, number, number, number]; placed: ReturnType<typeof contourLabels> };

    constructor(canvas: HTMLCanvasElement, cameraChanged: () => void) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.cameraChanged = cameraChanged;
    }
    frame(terrain: Terrain, reset = false) {
        if (reset || !this.center) this.fit(terrain);
    }
    resize(width: number, height: number, dpr: number) {
        if (width === this.width && height === this.height && dpr === this.dpr) return false;
        this.width = width;
        this.height = height;
        this.dpr = dpr;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        return true;
    }
    fit(terrain: Terrain, notify = true) {
        const g = terrain.grid;
        let box: Box = [g.xMin, g.yMin, g.xMax, g.yMax];
        if (!hasSamples(terrain)) {
            const boxes = [...terrain.regions.values()].map(r => r.shape.box).filter(b => b.every(Number.isFinite));
            if (boxes.length) box = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
                Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
        }
        this.center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        this.referenceScale = this.scale = Math.min(Math.max(1, this.width - 65) / Math.max(g.step, box[2] - box[0]),
            Math.max(1, this.height - 84) / Math.max(g.step, box[3] - box[1]));
        if (notify) this.cameraChanged();
    }
    zoomFactor() {
        return this.scale / this.referenceScale;
    }
    screen(p: Point): Point {
        return [(p[0] - this.center[0]) * this.scale + this.width / 2, (this.center[1] - p[1]) * this.scale + this.height / 2 + 9];
    }
    world(x: number, y: number): Point {
        return [this.center[0] + (x - this.width / 2) / this.scale, this.center[1] - (y - this.height / 2 - 9) / this.scale];
    }
    zoomAt(factor: number, x = this.width / 2, y = this.height / 2) {
        const before = this.world(x, y);
        this.scale = this.referenceScale * clamp(this.zoomFactor() * factor, .05, 30);
        const after = this.world(x, y);
        this.center[0] += before[0] - after[0];
        this.center[1] += before[1] - after[1];
        this.cameraChanged();
    }
    revealBounds([left, bottom, right, top]: Box, offsets?: Box) {
        if (![left, bottom, right, top].every(Number.isFinite)) return;
        const [x0, y0] = this.screen([left, top]), [x1, y1] = this.screen([right, bottom]);
        if (offsets) {
            const [l, t, r, b] = offsets;
            if (x0 + l >= 0 && y0 + t >= 0 && x1 + r <= this.width && y1 + b <= this.height) return;
            const margin = 12, width = right - left, height = top - bottom;
            this.scale = Math.min(this.scale,
                width > 0 ? Math.max(1, this.width - (r - l) - margin) / width : Infinity,
                height > 0 ? Math.max(1, this.height - (b - t) - margin) / height : Infinity);
            this.center = [(left + right) / 2 + (l + r) / (2 * this.scale), (bottom + top) / 2 - (9 + (t + b) / 2) / this.scale];
            this.cameraChanged();
        }
        else if (x0 > this.width || x1 < 0 || y0 > this.height || y1 < 0) {
            this.center = [(left + right) / 2, (bottom + top) / 2];
            this.cameraChanged();
        }
    }
    focusBounds([left, bottom, right, top]: Box) {
        const base = this.referenceScale;
        this.center = [(left + right) / 2, (bottom + top) / 2];
        this.scale = base * clamp(Math.min(this.width * .80 / (base * Math.max(1, right - left)),
            this.height * .72 / (base * Math.max(1, top - bottom))), .5, 5);
        this.cameraChanged();
    }
    panTo(center: Point) {
        this.center = center;
        this.cameraChanged();
    }
    issueHits(view: MapView, screen: Point) {
        return view.layers.issues ? view.project.issues.filter(i => distance(this.screen(i.point), screen) <= 12)
            .sort((a, b) => distance(this.screen(a.point), screen) - distance(this.screen(b.point), screen)) : [];
    }
    private drawIssueShapes(ctx: Context, view: MapView, colors: MapColors) {
        const chosen = view.selectedIssues?.filter(issue => view.project.issues.includes(issue)) ?? [], scale = this.scale;
        const related = objectIssues(view.project, view.selection);
        for (const issue of [...related.filter(i => !chosen.includes(i)), ...chosen]) {
            const active = chosen.includes(issue), elapsed = performance.now() - (view.issueStart ?? 0);
            ctx.save();
            ctx.globalAlpha = active ? (elapsed < 1500 ? .72 + .28 * Math.cos(elapsed * Math.PI / 250) : 1) : .42;
            circle(ctx, ...issue.point, 8 / scale, null, issueColor(colors, issue), 2 / scale);
            ctx.restore();
        }
    }
    private outlineStyle(view: MapView, kind: string, id: string, colors: MapColors) {
        const selected = view.selection?.id === id && view.selection.kind === kind;
        const stripSource = kind === "geoNode" && view.draft?.tool === "strip" && view.draft.ids.includes(id);
        if (selected || stripSource) return { color: colors.accent, width: overlay.selectedWidth / this.scale };
        if (view.hovered?.kind === kind && view.hovered.id === id && !view.hoverGeometry || kind === "geoNode" && view.referencedGeo.includes(id))
            return { color: colors.accentHover, width: overlay.hoverWidth / this.scale };
    }
    *objectHits(view: MapView, screen: Point, edit = false): Generator<MapHit> {
        for (const h of this.markHits(...screen)) yield { selection: h, handle: h };
        const p = this.world(...screen), scale = this.scale;
        const { terrain, design } = view.project, { geoNodes, grid, sections } = design;
        const endpoints = new Map<string, { handle: Handle; gap: number }>();
        for (const handle of this.sectionControls(view)) {
            const gap = distance(p, handle.point) * scale;
            if (gap < (endpoints.get(handle.id)?.gap ?? endpointHitRadius)) endpoints.set(handle.id, { handle, gap });
        }
        for (const s of sections.toReversed()) {
            const h = endpoints.get(s.id)?.handle;
            if (h) yield { selection: h, handle: h };
            else if (view.layers.sections && nearest(...p, s.points).distance * scale <= sectionHitRadius)
                yield { selection: { kind: "section", id: s.id } };
        }
        for (const node of geoNodes.toReversed()) if (showsParameterGeometry(view, node)) {
            for (const control of hitParameterGeometries(node, p, scale, grid.step / 8)) yield geoHit(node.id, control);
        }
        const empty = !hasSamples(terrain);
        if (edit) for (const node of geoNodes.toReversed()) {
            if (!empty && (node.disabled || !view.layers.geoNodes && !node.outline && !node.fill)) continue;
            const box = terrain.regions.get(node.id)?.shape.box, margin = 5 / scale;
            if (!box || p[0] < box[0] - margin || p[0] > box[2] + margin || p[1] < box[1] - margin || p[1] > box[3] + margin) continue;
            const control = hitPathSegment(node, p, scale, grid.step / 8);
            if (control) yield geoHit(node.id, control);
        }
        for (const node of geoNodes.toReversed())
            if ((!node.disabled || empty) && terrain.regions.get(node.id)?.shape.contains(p)) yield geoHit(node.id, bodyControl(p));
    }
    selectedControl(view: MapView, screen: Point): MapHit | undefined {
        const { selection } = view;
        if (selection?.kind === "section") {
            const h = this.hitSectionHandle(view, screen, selection.id);
            if (h) return { selection: h, handle: h };
        }
        if (selection?.kind === "geoNode") {
            const node = view.project.design.geoNodes.find(n => n.id === selection.id);
            const control = node && hitGeoControl(node, this.world(...screen), this.scale, view.geometry);
            if (control) return geoHit(selection.id, control);
        }
    }
    selectedBody(view: MapView, screen: Point, edit = false): MapHit | undefined {
        const { selection, project, geometry } = view;
        if (!selection) return;
        if (selection.kind === "mark") {
            for (const h of this.markHits(...screen)) if (h.id === selection.id) return { selection: h, handle: h };
            return;
        }
        const p = this.world(...screen);
        if (selection.kind === "section" && view.layers.sections) {
            const section = project.design.sections.find(s => s.id === selection.id);
            if (section && nearest(...p, section.points).distance * this.scale <= sectionHitRadius)
                return { selection: { kind: "section", id: selection.id } };
        }
        if (selection.kind === "geoNode") {
            const node = project.design.geoNodes.find(n => n.id === selection.id);
            if (!node) return;
            if (geometry?.kind !== "parameter") {
                const segment = hitPathSegment(node, p, this.scale, project.design.grid.step / 8, geometry);
                if (segment && (segment.path < 0 || edit)) return geoHit(node.id, segment);
                if (segment) return geoHit(node.id, bodyControl(p));
            }
            if (!edit && project.terrain.regions.get(node.id)?.shape.contains(p)) return geoHit(node.id, bodyControl(p));
        }
    }
    pickGeo(project: ProjectView, point: Point, after?: string, excluded: readonly string[] = []) {
        const empty = !hasSamples(project.terrain);
        const hits = project.design.geoNodes.filter(n => (!n.disabled || empty) && project.terrain.regions.get(n.id)?.shape.contains(point)).reverse();
        const start = after ? hits.findIndex(n => n.id === after) + 1 : 0;
        for (let i = 0; i < hits.length; i++) {
            const hit = hits[(start + i) % hits.length];
            if (!excluded.includes(hit.id)) return hit;
        }
    }
    draw(view: MapView, theme: Theme) {
        if (!this.width || !this.center) return;
        const colors = mapColors[theme], base = baseMap[theme], contourColors = contourStyle[theme];
        const ctx = this.ctx,
            { terrain: t, design: d } = view.project,
            g = t.grid,
            scale = this.scale,
            origin = this.screen([0, 0]), empty = !hasSamples(t);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = interfaceColors[theme].bgApp;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.save();
        ctx.translate(...origin);
        ctx.scale(scale, -scale);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const samples = Object.hasOwn(t.fields, view.displayField) && t.fields[view.displayField];
        const raster = view.displayField === heightId ? relief(t, theme) : samples && fieldFill(g, samples, theme);
        if (raster) {
            ctx.save();
            ctx.translate(g.xMin, g.yMax);
            ctx.scale(1, -1);
            ctx.drawImage(raster, 0, 0, g.xMax - g.xMin, g.yMax - g.yMin);
            ctx.restore();
        }
        if (view.layers.grid) this.drawGrid(ctx, view, scale, base);
        const draggedRegionId = view.dragCurve === undefined && view.dragNode?.construction.type === "free" ? view.dragNode.id : undefined;
        for (const n of d.geoNodes) {
            if (n.disabled && !empty) continue;
            if (!empty && !n.fill && !n.outline && !view.layers.geoNodes) continue;
            const paths = regionPaths(t.regions.get(n.id)!, g);
            if (n.fill && !empty) {
                ctx.fillStyle = n.fill; ctx.fill(paths.area, "evenodd");
            }
            if (n.id !== draggedRegionId && (empty || n.outline || view.layers.geoNodes)) {
                ctx.strokeStyle = base.boundary;
                ctx.lineWidth = .6 / scale;
                ctx.stroke(paths.outline);
            }
        }
        const contours = view.layers.contours && samples ? fieldContours(g, samples, fieldPrecision(d.fields[view.displayField]), scale) : undefined;
        contours?.paths.forEach((path, rank) => {
            if (!path) return;
            ctx.strokeStyle = contourColors.lines[rank] ?? contourColors.zero;
            ctx.lineWidth = (contourStyle.lines[rank]?.width ?? contourStyle.zeroWidth) / scale;
            ctx.stroke(path);
        });
        const outlined = new Set(view.referencedGeo);
        if (view.selection?.kind === "geoNode") outlined.add(view.selection.id);
        if (view.draft?.tool === "strip") for (const id of view.draft.ids) outlined.add(id);
        if (view.hovered?.kind === "geoNode") outlined.add(view.hovered.id);
        for (const id of outlined) {
            const r = t.regions.get(id), outline = this.outlineStyle(view, "geoNode", id, colors);
            if (!r || !outline || view.dragCommitting && id === draggedRegionId) continue;
            const paths = regionPaths(r, g);
            if (r.shape.spine) {
                ctx.fillStyle = colors.stripArea;
                ctx.fill(paths.area, "evenodd");
                for (const edge of r.shape.spine) stroke(ctx, [edge.a, edge.b], outline.color, outline.width);
            }
            ctx.strokeStyle = id === draggedRegionId ? colors.dragOrigin : outline.color;
            ctx.lineWidth = outline.width; ctx.stroke(paths.outline);
        }
        this.drawIssueShapes(ctx, view, colors);
        ctx.restore();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        drawParameterGeometry(this, view, colors);
        if (view.layers.sections) {
            ctx.save();
            ctx.lineCap = "round";
            for (const sec of d.sections) {
                const points = sec.points.map(p => this.screen(p)), outline = this.outlineStyle(view, "section", sec.id, colors);
                if (outline) stroke(ctx, points, outline.color, outline.width * scale);
                else stroke(ctx, points, base.sectionLine, .85, [...overlay.dash]);
            }
            ctx.restore();
        }
        this.drawOverlays(view, colors);
        drawGeoOverlay(this, view, colors);
        this.drawLabels(ctx, view, colors);
        this.drawMarks(ctx, view, colors);
        if (contours && view.layers.contourLabels) this.drawContourLabels(ctx, contours, colors);
    }
    private drawContourLabels(ctx: Context, contours: ReturnType<typeof fieldContours>, colors: MapColors) {
        const { base, lines } = contours, camera = [...this.center, this.width, this.height] as const;
        if (this.contourText?.contours !== contours || !this.contourText.camera.every((value, i) => value === camera[i])) {
            ctx.font = labelFont();
            const placed = contourLabels(lines, this.width, this.height, point => this.screen(point), value => {
                const text = ctx.measureText(displayReading(value, base));
                return [text.width + overlay.labelHalo, text.actualBoundingBoxAscent + text.actualBoundingBoxDescent + overlay.labelHalo];
            });
            this.contourText = { contours, camera: [...camera], placed };
        }
        for (const { point, value } of this.contourText.placed) mapText(ctx, colors, displayReading(value, base), ...point);
    }
    private drawGrid(ctx: Context, view: MapView, scale: number, colors: typeof baseMap[Theme]) {
        const { mode, meters, pixels } = view.grid;
        const step = mode === "meters" ? meters : pixelGridSpacing(scale, pixels);
        const [left, bottom] = this.world(0, this.height), [right, top] = this.world(this.width, 0);
        const lines = (spacing: number, color: string, fine = false) => {
            // Subpixel lines cannot show useful spacing and could require millions of strokes.
            if (spacing * scale < 2 || !Number.isFinite(spacing)) return;
            const firstX = Math.ceil(left / spacing), lastX = Math.floor(right / spacing);
            const firstY = Math.ceil(bottom / spacing), lastY = Math.floor(top / spacing);
            if (![firstX, lastX, firstY, lastY].every(Number.isSafeInteger)) return;
            ctx.beginPath();
            for (let i = firstX; i <= lastX; i++) {
                if (fine && i % 5 === 0) continue;
                ctx.moveTo(i * spacing, bottom);
                ctx.lineTo(i * spacing, top);
            }
            for (let i = firstY; i <= lastY; i++) {
                if (fine && i % 5 === 0) continue;
                ctx.moveTo(left, i * spacing);
                ctx.lineTo(right, i * spacing);
            }
            ctx.lineWidth = .65 / scale;
            ctx.strokeStyle = color;
            ctx.stroke();
        };
        if (view.layers.fineGrid) lines(step / 5, colors.fineGrid, true);
        lines(step, colors.mainGrid);
    }
    private drawLabels(ctx: Context, view: MapView, colors: MapColors) {
        const { design: d, terrain } = view.project;
        this.labelBoxes = [];
        const draw = (target: LabelTarget, name: string, point: Point) => {
            if (!name) return;
            const [x, y] = this.screen(point);
            const section = target.kind === "section", left = section ? x + 7 : x, middle = section ? y - 8 : y;
            ctx.save();
            ctx.textAlign = section ? "left" : "center";
            mapText(ctx, colors, name, left, middle);
            const width = ctx.measureText(name).width, start = section ? left : left - width / 2;
            const half = canvasText.sm / 2;
            this.labelBoxes.push({ ...target, point, box: [start - 2, middle - half - 2, start + width + 2, middle + half + 2] });
            ctx.restore();
        };
        if (view.layers.labels) for (const n of d.geoNodes) if (n.showLabel && !n.disabled) {
            const target = { kind: "geoNode", id: n.id } as const, region = terrain.regions.get(n.id);
            const origin = region && geoLabelPoint(region, terrain.grid);
            if (origin && region) {
                const drag = view.dragLabel;
                const offset = drag?.kind === target.kind && drag.id === n.id ? drag.offset : n.labelOffset;
                const point = offset && constrainGeoLabel(region, addOffset(origin, offset), this.scale);
                draw(target, n.label, point || origin);
            }
        }
        if (view.layers.sections) for (const section of d.sections) if (section.showLabel !== false) {
            const target = { kind: "section", id: section.id } as const, drag = view.dragLabel;
            const offset = drag?.kind === "section" && drag.id === section.id ? drag.offset : section.labelOffset;
            const point = offset ? constrainSectionLabel(section.points, addOffset(section.points[0], offset), this.scale) : section.points[0];
            draw(target, section.label, point);
        }
    }
    hitLabel(x: number, y: number) {
        return this.labelBoxes.findLast(({ box: [left, top, right, bottom] }) => x >= left && x <= right && y >= top && y <= bottom);
    }
    labelOffset({ terrain, design }: ProjectView, target: LabelTarget, at: Point): LabelPreview | undefined {
        const region = target.kind === "geoNode" ? terrain.regions.get(target.id) : undefined;
        const origin = target.kind === "geoNode" ? region && geoLabelPoint(region, terrain.grid) : design.sections.find(s => s.id === target.id)?.points[0];
        if (origin) return { ...target, offset: [at[0] - origin[0], at[1] - origin[1]] };
    }

    markScreen(mark: Pick<Mark, "point" | "follow">): Point {
        return mark.follow === "screen" ? mark.point : this.screen(mark.point);
    }

    markCoordinate(screen: Point, follow: Mark["follow"]): Point {
        return follow === "screen" ? screen : this.world(...screen);
    }

    private markLayout(mark: Mark<number>, ctx = this.ctx): { text: string; width: number; ruler?: number; box: Box } {
        const screen = mark.follow === "screen";
        ctx.save();
        ctx.font = labelFont(mark.kind === "text");
        if (mark.kind === "scale") {
            const target = Math.min(80, Math.max(1, (this.width - 15) / 2));
            const length = screen ? pixelGridSpacing(this.scale, target) : mark.length ?? Number(markParameters.scale.default);
            const ruler = length * this.scale, text = displayReading(length, displaySteps.length, markParameters.scale.unit);
            const measured = ctx.measureText(text).width, width = screen ? Math.min(measured, Math.max(1, this.width - ruler - 15)) : measured;
            ctx.restore();
            return { text, width, ruler, box: [-5, -12, ruler + 10 + width, 7] };
        }
        const text = markReading(mark), measured = Math.max(10, ctx.measureText(text).width);
        const width = screen ? Math.min(measured, Math.max(1, this.width - 10)) : measured;
        ctx.restore();
        return { text, width, box: [-width / 2 - 5, -10, width / 2 + 5, 10] };
    }
    visibleMarkPoint(mark: Mark<number>, point = mark.point, box?: Box): Point {
        if (mark.follow === "map") return this.markScreen({ point, follow: mark.follow });
        return clampMarkPoint(point, box ?? this.markLayout(mark).box, this.width, this.height, this.markObstacles);
    }
    revealMark(mark: Mark<number>) {
        const { box, ruler = 0 } = this.markLayout(mark);
        const [x, y] = mark.point, [l, t, r, b] = box;
        const right = mark.kind === "scale" ? x + (mark.length ?? Number(markParameters.scale.default)) : x;
        this.revealBounds([x, y, right, y], [l, t, r - ruler, b]);
    }

    private drawMarks(ctx: Context, view: MapView, colors: MapColors) {
        this.markBoxes = [];
        if (!view.layers.marks) return;
        for (const mark of view.project.design.marks) {
            const point = view.dragMark?.id === mark.id ? view.dragMark.point : mark.point;
            const { text, width, ruler, box } = this.markLayout(mark, ctx);
            const screen = mark.follow === "screen";
            const [x, y] = this.visibleMarkPoint(mark, point, box);
            const selected = view.selection?.kind === "mark" && view.selection.id === mark.id;
            const hovered = view.hovered?.kind === "mark" && view.hovered.id === mark.id;
            const handle: Handle = { kind: "mark", id: mark.id, role: "body", point: screen ? [x, y] : point };
            ctx.save();
            ctx.textAlign = "left";
            if (ruler !== undefined) {
                const right = x + ruler, color = selected ? colors.accent : hovered ? colors.accentHover : colors.text;
                stroke(ctx, [[x, y - 4], [x, y], [right, y], [right, y - 4]], colors.bgPanel, 4);
                stroke(ctx, [[x, y - 4], [x, y], [right, y], [right, y - 4]], color, selected ? overlay.selectedWidth : 1.7);
                mapText(ctx, colors, text, right + 6, y - 2, false, width);
                if (selected) drawHandle(ctx, colors, x, y, true);
            }
            else {
                const left = x - width / 2;
                if (selected || hovered) {
                    ctx.fillStyle = colors.bgSelected;
                    ctx.beginPath();
                    ctx.roundRect(left - 4, y - 9, width + 8, 18, 3);
                    ctx.fill();
                }
                mapText(ctx, colors, text, left, y, true, width);
            }
            const [l, t, r, b] = box;
            this.markBoxes.push({ mark: handle, box: [x + l, y + t, x + r, y + b] });
            ctx.restore();
        }
    }
    *markHits(x: number, y: number) {
        for (const { mark, box: [l, t, r, b] } of this.markBoxes.toReversed())
            if (x >= l && x <= r && y >= t && y <= b) yield mark;
    }
    private drawOverlays(view: MapView, colors: MapColors) {
        const ctx = this.ctx, active = view.selection;
        if (view.layers.issues)
            for (const problem of view.project.issues) {
                const [x, y] = this.screen(problem.point);
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = ctx.strokeStyle = issueColor(colors, problem);
                ctx.lineWidth = 1.3;
                ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
                ctx.strokeRect(-2.8, -2.8, 5.6, 5.6);
                ctx.restore();
            }
        for (const h of this.sectionControls(view)) {
            const [x, y] = this.screen(h.point);
            if (x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12) continue;
            const selected = active?.kind === h.kind && active.id === h.id && active.index === h.index &&
                active.role === h.role;
            drawHandle(ctx, colors, x, y, selected);
        }
        for (const issue of view.selectedIssues ?? []) {
            if (!view.project.issues.includes(issue)) continue;
            const [x, y] = this.screen(issue.point);
            circle(ctx, x, y, 10, null, issueColor(colors, issue), overlay.selectedWidth);
        }
    }
    private sectionControls(view: MapView) {
        return view.geometry && view.selection?.kind === "geoNode" ? [] :
            sectionHandles(view.project.design, view.layers.sections, view.objectGeometry);
    }
    private hitSectionHandle(view: MapView, screen: Point, id: string) {
        let best: Handle | undefined, min = endpointHitRadius;
        for (const h of this.sectionControls(view).reverse()) {
            if (h.id !== id) continue;
            const dist = distance(this.screen(h.point), screen);
            if (dist < min) {
                best = h;
                min = dist;
            }
        }
        return best;
    }
}

function addOffset([x, y]: Point, [dx, dy]: Point): Point {
    return [x + dx, y + dy];
}

function markReading(mark: TextMark<number>) {
    return mark.showElevation ? [mark.label, displayValue(mark.elevation, markParameters.text.step, markParameters.text.unit)].filter(Boolean).join(" ") : mark.label;
}
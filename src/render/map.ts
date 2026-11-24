import { type GeoNode, type Mark, type TextMark, type Point } from "../core/design/v5.ts";
import { displaySteps, markParameters } from "../core/design/functionTable.ts";
import { fieldPrecision, heightId } from "../core/design/defaults.ts";
import { type Issue, type Terrain } from "../core/design/results.ts";
import { type Handle, type Selection } from "../core/edit/types.ts";
import { type ProjectView } from "../core/project.ts";
import { type GridDisplay, type layerDefaults, pixelGridSpacing } from "../app/state/layers.ts";
import { type Box } from "../core/math/geometry.ts";
import { clamp, distance, nearest } from "../core/math/geometry.ts";
import { issueView, objectIssues } from "../core/checks/issues.ts";
import { type GeoDraft } from "../app/state/geoTools.ts";
import { type GeoControl, type GeometryTarget } from "../core/edit/geoControls.ts";
import { fieldContours } from "./fieldContours.ts";
import { geoLabelPoint } from "./labelLayout.ts";
import { drawGeoOverlay, drawHandle } from "./geoOverlay.ts";
import { baseMap, canvasText, contourStyle, overlay, palette } from "./palette.ts";
import { displayReading, displayValue } from "../app/state/numbers.ts";
import { sectionHandles } from "../core/edit/controls.ts";
import { relief } from "./relief.ts";
import { fieldFill } from "./fieldFill.ts";

import { type Region } from "../core/design/regions.ts";
import { type Grid } from "../core/math/geometry.ts";

type Context = CanvasRenderingContext2D;

const labelFont = (bold = false) => (bold ? canvasText.semibold : canvasText.regular) + " " + canvasText.sm + "px " + canvasText.font;
const issueColor = (issue: Issue) => issue.severity === "error" ? palette.danger : palette.warning;
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

function mapText(ctx: Context, text: string, x: number, y: number, bold = false, color: string = palette.text) {
    ctx.font = labelFont(bold);
    ctx.lineJoin = "round";
    ctx.lineWidth = overlay.labelHalo;
    ctx.strokeStyle = palette.bgPanel;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

const hasSamples = (t: Terrain) => Object.values(t.fields).some(field => field.defined.some(Boolean));

export class ProjectMap {
    declare canvas: HTMLCanvasElement;
    declare ctx: Context;
    declare layers: typeof layerDefaults;
    declare gridDisplay: GridDisplay;
    scale = 1;
    referenceScale = 1;
    declare selection: Selection | null;
    declare project: ProjectView;
    declare frameTerrain: Terrain;
    emptyCanvas = false;
    displayField = heightId;
    geoSelection: string[] = [];
    referencedGeo = (): readonly string[] => [];
    private hovered?: Selection;
    geometry?: GeometryTarget;
    objectGeometry?: Selection;
    vertex?: GeoControl;
    dragNode?: GeoNode;
    dragMark?: { id: string; point: Point };
    draft?: GeoDraft;
    declare center: Point;
    declare width: number;
    declare height: number;
    declare dpr: number;
    declare activeIssue: Issue | null;
    declare pulseStart: number;
    declare pulseFrame: number;
    declare controls: Handle[];

    private markBoxes: { mark: Handle; box: Box }[] = [];

    constructor(canvas: HTMLCanvasElement, layers: typeof layerDefaults, gridDisplay: GridDisplay) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.layers = layers;
        this.gridDisplay = gridDisplay;
        this.selection = null;
    }
    setProject(project: ProjectView, reset = false, frameTerrain = project.terrain) {
        this.project = project;
        this.hovered = undefined;
        this.emptyCanvas = !hasSamples(project.terrain);
        this.frame(frameTerrain, reset);
    }
    frame(terrain: Terrain, reset = false) {
        this.frameTerrain = terrain;
        if (reset || !this.center) this.fit(false);
    }
    resize() {
        const box = this.canvas.getBoundingClientRect(),
            dpr = window.devicePixelRatio || 1;
        this.width = box.width;
        this.height = box.height;
        this.dpr = dpr;
        this.canvas.width = Math.round(box.width * dpr);
        this.canvas.height = Math.round(box.height * dpr);
        if (this.project) this.draw();
    }
    fit(draw = true) {
        const terrain = this.frameTerrain ?? this.project.terrain, g = terrain.grid;
        let box: Box = [g.xMin, g.yMin, g.xMax, g.yMax];
        if (!hasSamples(terrain)) {
            const boxes = [...terrain.regions.values()].map(r => r.shape.box).filter(b => b.every(Number.isFinite));
            if (boxes.length) box = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
                Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
        }
        this.center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
        this.referenceScale = this.scale = Math.min(Math.max(1, this.width - 65) / Math.max(g.step, box[2] - box[0]),
            Math.max(1, this.height - 84) / Math.max(g.step, box[3] - box[1]));
        if (draw) this.draw();
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
        this.draw();
    }
    focus(point: Point, zoom = 3) {
        this.center = point.slice() as Point;
        this.scale = Math.max(this.scale, zoom * this.referenceScale);
        this.draw();
    }
    focusBounds([left, bottom, right, top]: Box) {
        const base = this.referenceScale;
        this.center = [(left + right) / 2, (bottom + top) / 2];
        this.scale = base * clamp(Math.min(this.width * .80 / (base * Math.max(1, right - left)),
            this.height * .72 / (base * Math.max(1, top - bottom))), .5, 5);
        this.draw();
    }
    focusIssue(issue: Issue) {
        this.clearIssue();
        this.activeIssue = issue;
        const view = issueView(issue, this.width, this.height, this.referenceScale);
        this.center = view.center;
        this.scale = view.zoom * this.referenceScale;
        this.pulseStart = performance.now();
        const animate = () => {
            this.draw();
            if (this.activeIssue === issue && performance.now() - this.pulseStart < 1500) this.pulseFrame = requestAnimationFrame(animate);
        };
        animate();
    }
    clearIssue() {
        cancelAnimationFrame(this.pulseFrame);
        this.activeIssue = null;
    }
    issueHits(screen: Point) {
        return this.layers.issues ? this.project.issues.filter(i => distance(this.screen(i.point), screen) <= 12)
            .sort((a, b) => distance(this.screen(a.point), screen) - distance(this.screen(b.point), screen)) : [];
    }
    drawIssueShapes(ctx: Context) {
        const chosen = this.activeIssue && this.project.issues.includes(this.activeIssue) ? this.activeIssue : null, scale = this.scale;
        const related = objectIssues(this.project, this.selection);
        for (const issue of [...related.filter(i => i !== chosen), ...(chosen ? [chosen] : [])]) {
            const active = issue === chosen, elapsed = performance.now() - this.pulseStart;
            ctx.save();
            ctx.globalAlpha = active ? (elapsed < 1500 ? .72 + .28 * Math.cos(elapsed * Math.PI / 250) : 1) : .42;
            circle(ctx, ...issue.point, 8 / scale, null, issueColor(issue), 2 / scale);
            ctx.restore();
        }
    }
    hoverSelection(selection?: Selection) {
        if (selection?.kind === this.hovered?.kind && selection?.id === this.hovered?.id) return;
        this.hovered = selection;
        this.draw();
    }
    private outlineStyle(kind: string, id: string) {
        const selected = kind === "geoNode" ? this.geoSelection.includes(id) : this.selection?.id === id && this.selection.kind === kind;
        if (selected) return { color: palette.accent, width: overlay.selectedWidth / this.scale };
        if (this.hovered?.kind === kind && this.hovered.id === id || kind === "geoNode" && this.referencedGeo().includes(id))
            return { color: palette.accentHover, width: overlay.hoverWidth / this.scale };
    }
    geoHits(p: Point) {
        return this.project.design.geoNodes.filter(n => (!n.disabled || this.emptyCanvas) && this.project.terrain.regions.get(n.id)?.shape.contains(p)).reverse();
    }
    draw() {
        if (!this.project || !this.width) return;
        const ctx = this.ctx,
            { terrain: t, design: d } = this.project,
            g = t.grid,
            scale = this.scale,
            origin = this.screen([0, 0]);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = palette.bgApp;
        ctx.fillRect(0, 0, this.width, this.height);
        ctx.save();
        ctx.translate(...origin);
        ctx.scale(scale, -scale);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const samples = Object.hasOwn(t.fields, this.displayField) && t.fields[this.displayField];
        const raster = this.displayField === heightId ? relief(t) : samples && fieldFill(g, samples);
        if (raster) {
            ctx.save();
            ctx.translate(g.xMin, g.yMax);
            ctx.scale(1, -1);
            ctx.drawImage(raster, 0, 0, g.xMax - g.xMin, g.yMax - g.yMin);
            ctx.restore();
        }
        if (this.layers.grid) this.drawGrid(ctx, scale);
        const contours = this.layers.contours && samples ? fieldContours(g, samples, fieldPrecision(d.fields[this.displayField]), scale) : undefined;
        contours?.paths.forEach((path, rank) => {
            if (!path) return;
            const style = contourStyle.lines[rank] ?? contourStyle.zero;
            ctx.strokeStyle = style.color; ctx.lineWidth = style.width / scale; ctx.stroke(path);
        });
        const draggedRegionId = this.dragNode?.construction.type === "free" ? this.dragNode.id : undefined;
        for (const n of d.geoNodes) {
            if (n.disabled && !this.emptyCanvas) continue;
            if (!this.emptyCanvas && !n.fill && !n.outline && !this.layers.geoNodes) continue;
            const paths = regionPaths(t.regions.get(n.id)!, g);
            if (n.fill && !this.emptyCanvas) {
                ctx.fillStyle = n.fill; ctx.fill(paths.area, "evenodd");
            }
            if (n.id !== draggedRegionId && (this.emptyCanvas || n.outline || this.layers.geoNodes)) {
                ctx.strokeStyle = baseMap.boundary;
                ctx.lineWidth = .6 / scale;
                ctx.stroke(paths.outline);
            }
        }
        const outlined = new Set([...this.geoSelection, ...this.referencedGeo()]);
        if (this.hovered?.kind === "geoNode") outlined.add(this.hovered.id);
        for (const id of outlined) {
            const r = t.regions.get(id), outline = this.outlineStyle("geoNode", id);
            if (!r || !outline) continue;
            const paths = regionPaths(r, g);
            if (r.shape.spine) {
                ctx.fillStyle = palette.stripArea;
                ctx.fill(paths.area, "evenodd");
                for (const edge of r.shape.spine) stroke(ctx, [edge.a, edge.b], outline.color, outline.width);
            }
            ctx.strokeStyle = id === draggedRegionId ? palette.dragOrigin : outline.color;
            ctx.lineWidth = outline.width; ctx.stroke(paths.outline);
        }
        this.drawIssueShapes(ctx);
        const dash = overlay.dash.map(px => px / scale);
        if (this.layers.sections)
            for (const sec of d.sections) {
                const outline = this.outlineStyle("section", sec.id);
                if (outline) stroke(ctx, sec.points, outline.color, outline.width);
                else stroke(ctx, sec.points, baseMap.sectionLine, .85 / scale, dash);
            }
        ctx.restore();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        this.drawOverlays();
        drawGeoOverlay(this);
        if (this.layers.labels || this.layers.sections) this.drawLabels(ctx, d, t);
        this.drawMarks(ctx);
        if (contours && this.layers.contourLabels) this.drawContourLabels(ctx, contours);
        document.getElementById("zoom-value")!.textContent = displayReading(this.zoomFactor() * 100, 1, "%");
    }
    private drawContourLabels(ctx: Context, { base, labels }: ReturnType<typeof fieldContours>) {
        const { labelDistance, labelInset } = contourStyle, accepted: Point[] = [];
        for (const { point, value } of labels) {
            const p = this.screen(point), [x, y] = p;
            if (x < labelInset || x > this.width - labelInset || y < labelInset || y > this.height - labelInset) continue;
            if (accepted.some(other => distance(p, other) < labelDistance)) continue;
            accepted.push(p);
            mapText(ctx, displayReading(value, base), x, y);
        }
    }
    private drawGrid(ctx: Context, scale: number) {
        const { mode, meters, pixels } = this.gridDisplay;
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
        if (this.layers.fineGrid) lines(step / 5, baseMap.fineGrid, true);
        lines(step, baseMap.mainGrid);
    }
    private drawLabels(ctx: Context, d: ProjectView["design"], terrain: Terrain) {
        if (this.layers.labels) for (const n of d.geoNodes) if (n.showLabel && !n.disabled) {
            const region = terrain.regions.get(n.id), point = region && geoLabelPoint(region, terrain.grid);
            if (point) mapText(ctx, n.label, ...this.screen(point));
        }
        if (this.layers.sections) for (const section of d.sections) if (section.showLabel !== false) {
            const [x, y] = this.screen(section.points[0]);
            ctx.save();
            ctx.textAlign = "left";
            mapText(ctx, section.label, x + 7, y - 8);
            ctx.restore();
        }
    }

    markScreen(mark: Pick<Mark, "point" | "follow">): Point {
        return mark.follow === "screen" ? mark.point : this.screen(mark.point);
    }

    markCoordinate(screen: Point, follow: Mark["follow"]): Point {
        return follow === "screen" ? screen : this.world(...screen);
    }

    private drawMarks(ctx: Context) {
        this.markBoxes = [];
        if (!this.layers.marks) return;
        for (const mark of this.project.design.marks) {
            const point = this.dragMark?.id === mark.id ? this.dragMark.point : mark.point;
            const [x, y] = this.markScreen({ point, follow: mark.follow });
            const selected = this.selection?.kind === "mark" && this.selection.id === mark.id;
            const handle: Handle = { kind: "mark", id: mark.id, role: "body", point };
            const color = selected ? palette.accent : palette.text;
            ctx.save();
            if (mark.kind === "scale") {
                const length = mark.follow === "screen" ? pixelGridSpacing(this.scale, 80) : mark.length;
                const right = x + length * this.scale;
                ctx.textAlign = "left";
                stroke(ctx, [[x, y - 4], [x, y], [right, y], [right, y - 4]], palette.bgPanel, 4);
                stroke(ctx, [[x, y - 4], [x, y], [right, y], [right, y - 4]], color, selected ? overlay.selectedWidth : 1.7);
                const text = displayReading(length, displaySteps.length, markParameters.scale.unit);
                mapText(ctx, text, right + 6, y - 2);
                this.markBoxes.push({ mark: handle, box: [x - 5, y - 10, right + 10 + ctx.measureText(text).width, y + 7] });
            }
            else {
                const text = markReading(mark).text;
                ctx.font = labelFont(true);
                const width = Math.max(10, ctx.measureText(text).width), left = x - width / 2;
                if (selected) {
                    ctx.fillStyle = palette.bgSelected;
                    ctx.beginPath();
                    ctx.roundRect(left - 4, y - 9, width + 8, 18, 3);
                    ctx.fill();
                }
                ctx.textAlign = "left";
                mapText(ctx, text, left, y, true);
                this.markBoxes.push({ mark: handle, box: [Math.min(left - 5, x - 4), y - 10, left + width + 5, y + 10] });
            }
            if (selected && mark.kind === "scale") drawHandle(ctx, x, y, true);
            ctx.restore();
        }
    }
    hitMark(x: number, y: number): Handle | undefined {
        return this.markBoxes.findLast(({ box: [l, t, r, b] }) => x >= l && x <= r && y >= t && y <= b)?.mark;
    }
    drawOverlays() {
        const ctx = this.ctx,
            d = this.project.design,
            active = this.selection;
        if (this.layers.issues)
            for (const problem of this.project.issues) {
                const [x, y] = this.screen(problem.point);
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = ctx.strokeStyle = issueColor(problem);
                ctx.lineWidth = 1.3;
                ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
                ctx.strokeRect(-2.8, -2.8, 5.6, 5.6);
                ctx.restore();
            }
        this.controls = this.geometry && active?.kind === "geoNode" ? [] : sectionHandles(d, this.layers.sections, this.objectGeometry);
        for (const h of this.controls) {
            const [x, y] = this.screen(h.point);
            if (x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12) continue;
            const selected = active?.kind === h.kind && active.id === h.id && (active.index ?? 0) === h.index &&
                (!active.role || active.role === h.role);
            drawHandle(ctx, x, y, selected);
        }
        if (this.activeIssue && this.project.issues.includes(this.activeIssue)) {
            const [x, y] = this.screen(this.activeIssue.point);
            circle(ctx, x, y, 10, null, issueColor(this.activeIssue), overlay.selectedWidth);
        }
    }
    hitHandle(x: number, y: number) {
        let best = null,
            min = 9;
        for (const h of [...(this.controls ?? [])].reverse()) {
            const p = this.screen(h.point),
                dist = Math.hypot(x - p[0], y - p[1]);
            if (dist < min) {
                best = h;
                min = dist;
            }
        }
        return best;
    }
    hitSection(p: Point): Selection | undefined {
        if (!this.layers.sections) return;
        const hit = this.project.design.sections.findLast(s => nearest(...p, s.points).distance * this.scale <= 5);
        if (hit) return { kind: "section", id: hit.id };
    }
}

function markReading(mark: TextMark<number>) {
    const text = mark.showElevation ? [mark.label, displayValue(mark.elevation, markParameters.text.step, markParameters.text.unit)].filter(Boolean).join(" ") : mark.label;
    return { text };
}
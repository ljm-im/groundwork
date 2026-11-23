import { type GeoNode, type TextMark, type Point, markPoint } from "../core/design/v5.ts";
import { type Issue, type Terrain, type Tree } from "../core/design/results.ts";
import { type Handle, type Selection } from "../core/edit/types.ts";
import { type IslandView } from "../core/island.ts";
import { type GridDisplay, type layerDefaults, pixelGridSpacing } from "../app/state/layers.ts";
import { type Box } from "../core/math/geometry.ts";
import { advance, bearing, clamp, distance, mixPoint, nearest, onCanvas, pointAt, sampleDefined } from "../core/math/geometry.ts";
import { buildingShape, nodePose } from "../core/design/model.ts";
import { titlePoint } from "../core/edit/buildings.ts";
import { issueShapes, issueView, objectIssues } from "../core/checks/issues.ts";
import { type GeoDraft } from "../app/state/geoTools.ts";
import { type GeoControl, type GeometryTarget } from "../core/edit/geoControls.ts";
import { fieldContours } from "./fieldContours.ts";
import { geoLabelPoint } from "./labelLayout.ts";
import { drawGeoOverlay, drawHandle } from "./geoOverlay.ts";
import { baseMap, canvasText, overlay, palette, treeStyles } from "./palette.ts";
import { displayNumber } from "../app/state/numbers.ts";
import { handles } from "../core/edit/controls.ts";
import { relief } from "./relief.ts";

import { type Region } from "../core/design/regions.ts";
import { type Grid } from "../core/math/geometry.ts";

type Context = CanvasRenderingContext2D;

const labelFont = (bold = false) => (bold ? canvasText.semibold : canvasText.regular) + " " + canvasText.sm + "px " + canvasText.font;
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

function polygon(ctx: Context, points: Point[], fill: string | null, outline?: string | null, width?: number) {
    line(ctx, points, true);
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

export class IslandMap {
    declare canvas: HTMLCanvasElement;
    declare ctx: Context;
    declare layers: typeof layerDefaults;
    declare gridDisplay: GridDisplay;
    scale = 1;
    referenceScale = 1;
    declare selection: Selection | null;
    declare island: IslandView;
    declare frameTerrain: Terrain;
    private markDesign!: Pick<IslandView["design"], "marks" | "buildings">;
    emptyCanvas = false;
    displayField = "height";
    geoSelection: string[] = [];
    highlights: string[] = [];
    private hovered?: Selection;
    geometry?: GeometryTarget;
    objectGeometry?: Selection;
    vertex?: GeoControl;
    dragNode?: GeoNode;
    dragMark?: { id: string; point: Point };
    draft?: GeoDraft;
    profilePoint?: Point;
    private contours?: ReturnType<typeof fieldContours>;
    private contourValues?: Float32Array;
    declare cache: ReturnType<typeof relief>;
    declare center: Point;
    declare width: number;
    declare height: number;
    declare dpr: number;
    declare activeIssue: Issue | null;
    declare pulseStart: number;
    declare pulseFrame: number;
    declare linkPreview: Point[] | null;
    declare controls: Handle[];
    declare titleBoxes: { id: string; x: number; y: number; width: number; height: number; point: Point }[];

    private markBoxes: { mark: Handle; box: Box }[] = [];

    constructor(canvas: HTMLCanvasElement, layers: typeof layerDefaults, gridDisplay: GridDisplay) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.layers = layers;
        this.gridDisplay = gridDisplay;
        this.selection = null;
    }
    setIsland(island: IslandView, reset = false, frameTerrain = island.terrain, markDesign = island.design) {
        this.island = island;
        this.markDesign = markDesign;
        this.hovered = undefined;
        this.cache = relief(island);
        this.emptyCanvas = !island.terrain.defined.some(Boolean);
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
        if (this.island) this.draw();
    }
    fit(draw = true) {
        const terrain = this.frameTerrain ?? this.island.terrain, g = terrain.grid;
        let box: Box = [g.xMin, g.yMin, g.xMax, g.yMax];
        if (!terrain.defined.some(Boolean)) {
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
        const view = issueView(this.island, issue, this.width, this.height, this.referenceScale);
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
        return this.layers.issues ? this.island.issues.filter(i => distance(this.screen(i.point), screen) <= 12)
            .sort((a, b) => distance(this.screen(a.point), screen) - distance(this.screen(b.point), screen)) : [];
    }
    drawIssueShapes(ctx: Context) {
        const chosen = this.activeIssue && this.island.issues.includes(this.activeIssue) ? this.activeIssue : null, scale = this.scale;
        const related = objectIssues(this.island, this.selection);
        for (const issue of [...related.filter(i => i !== chosen), ...(chosen ? [chosen] : [])]) {
            const active = issue === chosen, elapsed = performance.now() - this.pulseStart;
            ctx.save();
            ctx.globalAlpha = active ? (elapsed < 1500 ? .72 + .28 * Math.cos(elapsed * Math.PI / 250) : 1) : .42;
            for (const shape of issueShapes(this.island, issue)) {
                const pts = shape.closed ? [...shape.points, shape.points[0]] : shape.points;
                if (pts.length === 1) circle(ctx, ...pts[0], 8 / scale, null, palette.danger, 2 / scale);
                else stroke(ctx, pts, palette.danger, (active ? overlay.selectedWidth : overlay.hoverWidth) / scale);
            }
            ctx.restore();
        }
    }
    hoverSelection(selection?: Selection) {
        if (selection?.kind === this.hovered?.kind && selection?.id === this.hovered?.id) return;
        this.hovered = selection;
        this.draw();
    }
    private outlineStyle(kind: string, id: string) {
        const selected = kind === "geoNode" ? this.geoSelection.includes(id) : this.selection?.id === id &&
            (this.selection.kind === kind || kind === "edge" && this.selection.kind === "via");
        if (selected) return { color: palette.accent, width: overlay.selectedWidth / this.scale };
        if (this.hovered?.kind === kind && this.hovered.id === id || kind === "geoNode" && this.highlights.includes(id))
            return { color: palette.accentHover, width: overlay.hoverWidth / this.scale };
    }
    geoHits(p: Point) {
        return this.island.design.geoNodes.filter(n => (!n.disabled || this.emptyCanvas) && this.island.terrain.regions.get(n.id)?.shape.contains(p)).reverse();
    }
    draw() {
        if (!this.island || !this.width) return;
        const ctx = this.ctx,
            { terrain: t, design: d } = this.island,
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
        const margin = this.cache.margin;
        ctx.save();
        ctx.translate(g.xMin - margin, g.yMax + margin);
        ctx.scale(1, -1);
        ctx.drawImage(this.cache.raster, 0, 0, g.xMax - g.xMin + 2 * margin, g.yMax - g.yMin + 2 * margin);
        ctx.restore();
        if (this.layers.grid) this.drawGrid(ctx, scale);
        if (this.layers.contours && this.displayField !== "height" && t.fields[this.displayField]) {
            if (this.contourValues !== t.fields[this.displayField]) {
                this.contourValues = t.fields[this.displayField];
                this.contours = fieldContours(t, this.displayField);
            }
            for (const line of this.contours!.lines) {
                ctx.strokeStyle = baseMap.fieldContours; ctx.lineWidth = 1.25 / scale; ctx.stroke(line.path);
            }
        }
        else if (this.layers.contours) this.cache.lines.forEach((p, i) => {
            ctx.strokeStyle = baseMap.heightContours[i];
            ctx.lineWidth = (i === 3 ? .36 : .2);
            ctx.stroke(p);
        });
        Object.entries(this.cache.woods).forEach(([species, p]) => {
            ctx.fillStyle = treeStyles[species as Tree["species"]][0];
            ctx.fill(p);
            ctx.lineWidth = .18;
            ctx.strokeStyle = baseMap.woodsOutline;
            ctx.stroke(p);
        });
        for (const n of d.geoNodes) {
            if (n.disabled && !this.emptyCanvas) continue;
            if (!this.emptyCanvas && !n.fill && !n.outline && !this.layers.geoNodes) continue;
            const paths = regionPaths(t.regions.get(n.id)!, g);
            if (n.fill && !this.emptyCanvas) {
                ctx.fillStyle = n.fill; ctx.fill(paths.area, "evenodd");
            }
            if (this.emptyCanvas || n.outline || this.layers.geoNodes) {
                ctx.strokeStyle = baseMap.boundary;
                ctx.lineWidth = .6 / scale;
                ctx.stroke(paths.outline);
            }
        }
        for (const r of this.island.routes) {
            if (r.offCanvas) continue;
            ctx.save();
            const outline = this.outlineStyle("edge", r.id);
            const p = r.points,
                width = r.edge.width;
            stroke(ctx, p, r.edge.levelDeck ? baseMap.deckEdge : baseMap.roadEdge, width + .65);
            if (outline) stroke(ctx, p, outline.color, width + 2 * outline.width);
            stroke(ctx, p, r.edge.color ?? baseMap.roadSurface, width);
            for (let i = 0; i < r.stairs.length; i++)
                if (r.stairs[i]) {
                    const a = r.points[i],
                        b = r.points[i + 1],
                        center = mixPoint(a, b, .5),
                        angle = bearing(a, b) + Math.PI / 2;
                    stroke(ctx, [advance(center, angle, width * .47), advance(center, angle, -width * .47)], baseMap.stairTread, .23);
                }
            if (["edge", "via"].includes(this.selection?.kind ?? "") && this.selection?.id === r.id && this.selection.index != null)
                for (const part of r.parts) if (part.index === this.selection.index)
                    stroke(ctx, part.points, palette.accent, overlay.hoverWidth / scale);
            if (this.layers.issues)
                for (const part of r.parts)
                    if (part.failed) stroke(ctx, part.points, palette.danger, overlay.selectedWidth / scale, overlay.dash.map(px => px / scale));
            ctx.restore();
        }
        for (const room of d.vegetation.rooms) {
            const [x, y] = room.center;
            ctx.setLineDash(overlay.dash.map(px => px / scale));
            circle(ctx, x, y, room.radius, baseMap.vegetationRoom, baseMap.vegetationOutline, .45);
            ctx.setLineDash([]);
            for (let i = 0; i < 3; i++) {
                const a = i * 2.1 + x;
                circle(ctx, x + Math.cos(a) * 4, y - Math.sin(a) * 4, 1.6, baseMap.vegetationBloom);
            }
        }
        const tree = d.vegetation.yardTree;
        if (tree && onCanvas(g, t.defined, ...tree.center)) circle(ctx, ...tree.center, tree.radius, baseMap.yardTree, baseMap.vegetationOutline, .22);
        for (const b of d.buildings) {
            const [x, y] = b.center;
            const outline = this.outlineStyle("building", b.id);
            if (b.shape === "rect") {
                const footprint = buildingShape(b).polygon!;
                polygon(ctx, footprint, b.color, baseMap.rectBuilding, .27);
                if (outline) polygon(ctx, footprint, null, outline.color, outline.width);
            }
            else if (b.shape === "ring") {
                circle(ctx, x, y, (b.radius! + b.inner!) / 2, null, b.color, b.radius! - b.inner!);
                circle(ctx, x, y, b.radius!, null, baseMap.ringBuilding, .25);
                circle(ctx, x, y, b.inner!, null, baseMap.ringBuilding, .25);
                ctx.setLineDash(overlay.dash.map(px => px / scale));
                circle(ctx, x, y, (b.radius! + b.inner!) / 2, null, baseMap.ringBuilding, .18);
                ctx.setLineDash([]);
                if (outline) {
                    circle(ctx, x, y, b.radius!, null, outline.color, outline.width);
                    circle(ctx, x, y, b.inner!, null, outline.color, outline.width);
                }
            }
            else {
                circle(ctx, x, y, b.radius! + .45, b.color, baseMap.circleBuilding, .45);
                if (outline) circle(ctx, x, y, b.radius! + .45, null, outline.color, outline.width);
            }
        }
        const outlined = new Set([...this.geoSelection, ...this.highlights]);
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
            ctx.strokeStyle = outline.color; ctx.lineWidth = outline.width; ctx.stroke(paths.outline);
        }
        this.drawIssueShapes(ctx);
        const dash = overlay.dash.map(px => px / scale);
        if (this.linkPreview) stroke(ctx, this.linkPreview, palette.accent, overlay.controlLine / scale, dash);
        if (this.layers.sections)
            for (const sec of d.sections) {
                const outline = this.outlineStyle("section", sec.id);
                if (outline) stroke(ctx, sec.points, outline.color, outline.width);
                else stroke(ctx, sec.points, baseMap.sectionLine, .85 / scale, dash);
            }
        ctx.restore();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        this.titleBoxes = [];
        this.drawOverlays();
        drawGeoOverlay(this);
        if (this.layers.labels) this.drawLabels(ctx, d, t);
        this.drawMarks(ctx);
        if (this.layers.contours && this.displayField !== "height" && this.contours) {
            for (const { label, value } of this.contours.lines) if (label) mapText(ctx, displayNumber(value, this.contours.step), ...this.screen(label));
            if (this.contours.constant !== undefined) {
                ctx.textAlign = "right";
                mapText(ctx, "该场在画布内处处为 " + displayNumber(this.contours.constant, .1), this.width - 16, 87);
            }
        }
        document.getElementById("zoom-value")!.textContent = displayNumber(this.zoomFactor() * 100, 1, "%");
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
    private drawLabels(ctx: Context, d: IslandView["design"], terrain: Terrain) {
        const near = (label: string, point: Point) => {
            const [x, y] = this.screen(point);
            ctx.save();
            ctx.textAlign = "left";
            mapText(ctx, label, x + 7, y - 8);
            ctx.restore();
        };
        for (const n of d.geoNodes) if (n.showLabel && !n.disabled) {
            const region = terrain.regions.get(n.id), point = region && geoLabelPoint(region, terrain.grid);
            if (point) mapText(ctx, n.label, ...this.screen(point));
        }
        for (const section of d.sections) if (section.showLabel !== false) near(section.label, section.points[0]);
        for (const route of this.island.routes) if (!route.offCanvas && route.edge.showLabel !== false)
            mapText(ctx, route.edge.label, ...this.screen(pointAt(route.points, route.s, route.length / 2)));
        for (const b of d.buildings) {
            if (b.showLabel !== false) {
                const point = titlePoint(d, b), [x, y] = this.screen(point);
                mapText(ctx, b.label, x, y, true);
                this.titleBoxes.push({ id: b.id, x, y, width: ctx.measureText(b.label).width, height: 16, point });
            }
            for (const door of b.doors) if (door.showLabel !== false && door.label)
                near(door.label, nodePose(d, { type: "door", building: b.id, door: door.id }).point);
        }
        const occupied: Box[] = [];
        for (const node of d.nodes) if (node.showLabel !== false) {
            const [x, y] = this.screen(nodePose(d, node).point);
            if (x < -60 || x > this.width + 60 || y < -12 || y > this.height + 60) continue;
            const active = this.selection?.kind === "node" && this.selection.id === node.id;
            ctx.font = labelFont(active);
            const w = ctx.measureText(node.label).width + 12;
            let top = y - 23;
            while (occupied.some(b => x + w / 2 > b[0] && x - w / 2 < b[2] && top < b[3] && top + 16 > b[1])) top -= 17;
            occupied.push([x - w / 2, top, x + w / 2, top + 16]);
            mapText(ctx, node.label, x, top + 8, active);
        }
    }
    private drawMarks(ctx: Context) {
        this.markBoxes = [];
        if (!this.layers.marks) return;
        const design = this.markDesign;
        for (const mark of design.marks) {
            if (mark.kind === "text" && this.zoomFactor() < (mark.minZoom ?? 0)) continue;
            const point = this.dragMark?.id === mark.id ? this.dragMark.point : markPoint(mark, design.buildings);
            const [x, y] = this.screen(point);
            const selected = this.selection?.kind === "mark" && this.selection.id === mark.id;
            const handle: Handle = { kind: "mark", id: mark.id, role: "body", point };
            const color = selected ? palette.accent : palette.text;
            ctx.save();
            if (mark.kind === "scale") {
                const length = mark.length ?? 10, right = x + length * this.scale;
                ctx.textAlign = "left";
                stroke(ctx, [[x, y - 4], [x, y], [right, y], [right, y - 4]], palette.bgPanel, 4);
                stroke(ctx, [[x, y - 4], [x, y], [right, y], [right, y - 4]], color, selected ? overlay.selectedWidth : 1.7);
                const text = displayNumber(length, .1, "m");
                mapText(ctx, text, right + 6, y - 2);
                this.markBoxes.push({ mark: handle, box: [x - 5, y - 10, right + 10 + ctx.measureText(text).width, y + 7] });
            }
            else {
                const { text, actual, difference } = markReading({ ...this.island, design }, mark);
                const spot = mark.spot && !mark.titleOnly && actual !== undefined;
                const caption = text + (difference ?? "");
                const prefix = spot ? 6 : 0;
                ctx.font = labelFont(!spot);
                const width = Math.max(10, ctx.measureText(caption).width), left = spot ? x + prefix : x - width / 2;
                if (spot) circle(ctx, x, y, 2.1, palette.text, palette.bgPanel, .8);
                if (selected) {
                    ctx.fillStyle = palette.bgSelected;
                    ctx.beginPath();
                    ctx.roundRect(left - 4, y - 9, width + 8, 18, 3);
                    ctx.fill();
                }
                ctx.textAlign = "left";
                mapText(ctx, text, left, y, !spot);
                if (difference) mapText(ctx, difference, left + ctx.measureText(text).width, y, !spot, palette.danger);
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
            d = this.island.design,
            active = this.selection;
        if (this.layers.issues)
            for (const problem of this.island.issues) {
                const [x, y] = this.screen(problem.point);
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = problem.severity === "notice" ? palette.bgPanel : palette.danger;
                ctx.strokeStyle = palette.danger;
                ctx.lineWidth = 1.3;
                ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
                ctx.strokeRect(-2.8, -2.8, 5.6, 5.6);
                ctx.restore();
            }
        this.controls = this.geometry && active?.kind === "geoNode" ? [] : handles(d, this.layers, active, this.objectGeometry);
        for (const h of this.controls) {
            const [x, y] = this.screen(h.point);
            if (x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12) continue;
            const selected = active?.kind === h.kind && active.id === h.id && (active.index ?? 0) === h.index &&
                (!active.role || active.role === h.role);
            const rotation = h.kind === "building" && h.role === "rotate";
            if (h.kind === "node") {
                const pose = nodePose(d, d.nodes.find(n => n.id === h.id)!);
                if (pose.angle != null) {
                    const end: Point = [x + 10 * Math.cos(pose.angle), y - 10 * Math.sin(pose.angle)];
                    stroke(ctx, [[x, y], end], palette.accent, overlay.controlLine);
                    drawHandle(ctx, ...end, false, true);
                }
            }
            if (rotation) {
                const b = d.buildings.find(item => item.id === h.id)!;
                stroke(ctx, [this.screen(b.center), [x, y]], palette.accent, overlay.controlLine);
            }
            drawHandle(ctx, x, y, selected, rotation);
        }
        if (this.activeIssue && this.island.issues.includes(this.activeIssue)) {
            const [x, y] = this.screen(this.activeIssue.point);
            circle(ctx, x, y, 10, null, palette.danger, overlay.selectedWidth);
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
    hitBuilding(x: number, y: number) {
        const world = this.world(x, y), buildings = this.island.design.buildings;
        const box = this.titleBoxes?.findLast(t => Math.abs(x - t.x) <= t.width / 2 + 2 && Math.abs(y - t.y) <= t.height / 2);
        if (box && this.selection?.kind === "building" && this.selection.id === box.id)
            return { kind: "building", id: box.id, role: "title", point: box.point };
        const body = buildings.findLast(b => buildingShape(b).signedDistance(...world) <= 0);
        if (body) return { kind: "building", id: body.id, role: "body", point: body.center };
        if (box) return { kind: "building", id: box.id, role: "title", point: box.point };
        return null;
    }
    hitRoad(p: Point) {
        let best = null,
            min = 8 / this.scale, centerDistance = Infinity;
        for (const r of this.island.routes) {
            for (const part of r.parts) {
                if (part.points.length < 2) continue;
                const hit = nearest(...p, part.points),
                    gap = Math.max(0, hit.distance - r.edge.width / 2);
                if (gap < min || gap === min && hit.distance < centerDistance) {
                    min = gap;
                    centerDistance = hit.distance;
                    best = { route: r, index: part.index, point: mixPoint(part.points[hit.segment], part.points[hit.segment + 1], hit.t) };
                }
            }
        }
        return best;
    }
}

export function markReading(island: Pick<IslandView, "terrain" | "graded"> & { design: Pick<IslandView["design"], "buildings"> }, mark: TextMark<number>) {
    const text = mark.label;
    if (mark.titleOnly) return { text };
    const target = mark.showElevation ? mark.elevation ?? 0 : undefined;
    const anchor = island.design.buildings.find(b => b.id === mark.building)?.center ?? mark.point;
    const actual = mark.spot ? sampleDefined(island.terrain.grid, island.graded.heights, island.terrain.defined, ...anchor) : undefined;
    const height = actual ?? target;
    if (height === undefined) return { text };
    return { actual, text: [text, displayNumber(height, .1, "m")].filter(Boolean).join(" "),
        difference: actual !== undefined && target !== undefined && Math.abs(actual - target) > .5 ? "（设计 " + displayNumber(target, .1, "m") + "）" : "" };
}
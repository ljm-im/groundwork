import { type GeoNode, type Label, type Point } from "../core/design/v5.ts";
import { type Issue, type Tree } from "../core/design/results.ts";
import { type Handle, type Selection } from "../core/edit/types.ts";
import { type Island, type IslandView } from "../core/island.ts";
import { type layerDefaults } from "../app/state/layers.ts";
import { type Box } from "../core/math/geometry.ts";
import { advance, bearing, clamp, distance, mixPoint, nearest, onCanvas, sampleDefined } from "../core/math/geometry.ts";
import { buildingShape, nodePose } from "../core/design/model.ts";
import { titlePoint } from "../core/edit/buildings.ts";
import { issueShapes, issueView, objectIssues } from "../core/checks/issues.ts";
import { type GeoDraft } from "../app/state/geoTools.ts";
import { type GeoControl } from "../core/edit/geoControls.ts";
import { fieldContours } from "./fieldContours.ts";
import { drawGeoOverlay } from "./geoOverlay.ts";
import { treeStyles } from "../core/vegetation/vegetation.ts";
import { handles } from "../core/edit/controls.ts";
import { relief } from "./relief.ts";

import { type Region } from "../core/design/regions.ts";
import { type Grid } from "../core/math/geometry.ts";

type Context = CanvasRenderingContext2D;

const ink = "#214e4c",
    paper = "#fffdf2",
    aqua = "#12696a";
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

function mapText(ctx: Context, text: string, x: number, y: number, size = 12, color = "#283b30", bold = false) {
    ctx.font = (bold ? "600 " : "500 ") + size + "px \"Microsoft YaHei UI\", sans-serif";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,252,236,.94)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

export class IslandMap {
    declare canvas: HTMLCanvasElement;
    declare ctx: Context;
    declare layers: typeof layerDefaults;
    declare zoom: number;
    declare selection: Selection | null;
    declare island: IslandView;
    declare frameGrid: Grid;
    displayField = "height";
    geoSelection: string[] = [];
    highlights: string[] = [];
    vertex?: GeoControl;
    dragNode?: GeoNode;
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

    constructor(canvas: HTMLCanvasElement, layers: typeof layerDefaults) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d")!;
        this.layers = layers;
        this.zoom = 1;
        this.selection = null;
    }
    setIsland(island: IslandView, reset = false, frameGrid = island.terrain.grid) {
        this.island = island;
        this.frameGrid = frameGrid;
        this.cache = relief(island);
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
        const g = this.frameGrid ?? this.island.terrain.grid;
        this.center = [(g.xMin + g.xMax) / 2, (g.yMin + g.yMax) / 2];
        this.zoom = 1;
        if (draw) this.draw();
    }
    get scale() {
        const g = this.frameGrid ?? this.island.terrain.grid;
        return this.zoom * Math.min((this.width - 65) / (g.xMax - g.xMin), (this.height - 84) / (g.yMax - g.yMin));
    }
    screen(p: Point): Point {
        return [(p[0] - this.center[0]) * this.scale + this.width / 2, (this.center[1] - p[1]) * this.scale + this.height / 2 + 9];
    }
    world(x: number, y: number): Point {
        return [this.center[0] + (x - this.width / 2) / this.scale, this.center[1] - (y - this.height / 2 - 9) / this.scale];
    }
    zoomAt(factor: number, x = this.width / 2, y = this.height / 2) {
        const before = this.world(x, y);
        this.zoom = clamp(this.zoom * factor, .5, 14);
        const after = this.world(x, y);
        this.center[0] += before[0] - after[0];
        this.center[1] += before[1] - after[1];
        this.draw();
    }
    focus(point: Point, zoom = 3) {
        this.center = point.slice() as Point;
        this.zoom = Math.max(this.zoom, zoom);
        this.draw();
    }
    focusBounds([left, bottom, right, top]: Box) {
        const base = this.scale / this.zoom;
        this.center = [(left + right) / 2, (bottom + top) / 2];
        this.zoom = clamp(Math.min(this.width * .80 / (base * Math.max(1, right - left)),
            this.height * .72 / (base * Math.max(1, top - bottom))), .5, 5);
        this.draw();
    }
    focusIssue(issue: Issue) {
        this.clearIssue();
        this.activeIssue = issue;
        const view = issueView(this.island, issue, this.width, this.height, this.scale / this.zoom);
        this.center = view.center;
        this.zoom = view.zoom;
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
                if (pts.length === 1) circle(ctx, ...pts[0], 8 / scale, null, active ? "#a72723" : "#b76a2f", 2.5 / scale);
                else {
                    const width = shape.width ?? 0;
                    stroke(ctx, pts, active ? "#b72b24" : "#be6737", width + (active ? 5 : 3) / scale);
                    if (!shape.closed && width) stroke(ctx, pts, active ? "#ffbe74" : "#f9d3a1", width * .69);
                }
            }
            ctx.restore();
        }
    }
    geoHits(p: Point) {
        return this.island.design.geoNodes.filter(n => !n.disabled && this.island.terrain.regions.get(n.id)?.shape.contains(p)).reverse();
    }
    draw() {
        if (!this.island || !this.width) return;
        const ctx = this.ctx,
            { terrain: t, design: d } = this.island,
            g = t.grid,
            scale = this.scale,
            origin = this.screen([0, 0]);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = "#ebeee8";
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
        const corner = this.world(0, this.height),
            opposite = this.world(this.width, 0);
        ctx.beginPath();
        for (let x = Math.ceil(corner[0] / 25) * 25; x <= opposite[0]; x += 25) {
            ctx.moveTo(x, corner[1]);
            ctx.lineTo(x, opposite[1]);
        }
        for (let y = Math.ceil(corner[1] / 25) * 25; y <= opposite[1]; y += 25) {
            ctx.moveTo(corner[0], y);
            ctx.lineTo(opposite[0], y);
        }
        ctx.lineWidth = .6 / scale;
        ctx.strokeStyle = "rgba(54,99,104,.13)";
        ctx.stroke();
        if (this.displayField !== "height" && t.fields[this.displayField]) {
            if (this.contourValues !== t.fields[this.displayField]) {
                this.contourValues = t.fields[this.displayField];
                this.contours = fieldContours(t, this.displayField);
            }
            for (const line of this.contours!.lines) {
                ctx.strokeStyle = "#38597d"; ctx.lineWidth = 1.25 / scale; ctx.stroke(line.path);
            }
        }
        else if (this.layers.contours) this.cache.lines.forEach((p, i) => {
            ctx.strokeStyle = ["#64909a", "rgba(70,58,40,.13)", "rgba(70,58,40,.25)", "rgba(70,58,40,.53)"][i];
            ctx.lineWidth = (i === 3 ? .36 : .2);
            ctx.stroke(p);
        });
        if (this.layers.trees) Object.entries(this.cache.woods).forEach(([species, p]) => {
            ctx.fillStyle = treeStyles[species as Tree["species"]][0];
            ctx.fill(p);
            ctx.lineWidth = .18;
            ctx.strokeStyle = "rgba(40,60,30,.48)";
            ctx.stroke(p);
        });
        for (const n of d.geoNodes) {
            if (n.disabled) continue;
            if (!n.fill && !n.outline && !this.layers.geoNodes) continue;
            const paths = regionPaths(t.regions.get(n.id)!, g);
            if (n.fill) {
                ctx.fillStyle = n.fill; ctx.fill(paths.area, "evenodd");
            }
            if (n.outline || this.layers.geoNodes) {
                ctx.strokeStyle = "#806d50";
                ctx.lineWidth = .6 / scale;
                ctx.stroke(paths.outline);
            }
        }
        for (const r of this.island.routes) {
            if (r.offCanvas) continue;
            ctx.save();
            const selected = this.selection ?.id === r.id && ["edge", "via"].includes(this.selection.kind);
            const p = r.points,
                width = r.edge.width;
            if (selected) stroke(ctx, p, "#197e83", width + 1.75);
            stroke(ctx, p, r.edge.levelDeck ? "#806546" : "#9b896c", width + .65);
            stroke(ctx, p, r.edge.color ?? (selected ? "#a9dddd" : "#f0e4cc"), width);
            for (let i = 0; i < r.stairs.length; i++)
                if (r.stairs[i]) {
                    const a = r.points[i],
                        b = r.points[i + 1],
                        center = mixPoint(a, b, .5),
                        angle = bearing(a, b) + Math.PI / 2;
                    stroke(ctx, [advance(center, angle, width * .47), advance(center, angle, -width * .47)], "#89775a", .23);
                }
            if (selected && this.selection!.index != null) for (const part of r.parts) if (part.index === this.selection!.index)
                stroke(ctx, part.points, "#277d78", Math.min(.26, width * .15));
            if (this.layers.issues)
                for (const part of r.parts)
                    if (part.failed) stroke(ctx, part.points, "#bf342c", Math.max(.6, width * .48), [1.5, .9]);
            ctx.restore();
        }
        for (const room of d.vegetation.rooms) {
            const [x, y] = room.center;
            ctx.setLineDash([.9, .65]);
            circle(ctx, x, y, room.radius, "#b5d49a", "#4f7a3a", .45);
            ctx.setLineDash([]);
            for (let i = 0; i < 3; i++) {
                const a = i * 2.1 + x;
                circle(ctx, x + Math.cos(a) * 4, y - Math.sin(a) * 4, 1.6, "#d9a3b8");
            }
        }
        const tree = d.vegetation.yardTree;
        if (this.layers.trees && tree && onCanvas(g, t.defined, ...tree.center)) circle(ctx, ...tree.center, tree.radius, "#9cc584", "#4f7a3a", .22);
        for (const b of d.buildings) {
            const [x, y] = b.center;
            if (b.shape === "rect") polygon(ctx, buildingShape(b).polygon!, b.color, "#4b453a", .27);
            else if (b.shape === "ring") {
                circle(ctx, x, y, (b.radius! + b.inner!) / 2, null, b.color, b.radius! - b.inner!);
                circle(ctx, x, y, b.radius!, null, "#485453", .25);
                circle(ctx, x, y, b.inner!, null, "#485453", .25);
                ctx.setLineDash([1.3, 1]);
                circle(ctx, x, y, (b.radius! + b.inner!) / 2, null, "#485453", .18);
                ctx.setLineDash([]);
            }
            else circle(ctx, x, y, b.radius! + .45, b.color, "#7a3a28", .45);
        }
        for (const id of [...this.geoSelection, ...this.highlights]) {
            const r = t.regions.get(id);
            if (!r) continue;
            const color = this.highlights.includes(id) ? "#bd6825" : "#12696a";
            const paths = regionPaths(r, g);
            if (r.shape.spine) {
                ctx.fillStyle = "rgba(21,123,120,.23)"; ctx.fill(paths.area);
                for (const edge of r.shape.spine) stroke(ctx, [edge.a, edge.b], color, 2.7 / scale);
            }
            ctx.strokeStyle = color; ctx.lineWidth = 2 / scale; ctx.stroke(paths.outline);
        }
        this.drawIssueShapes(ctx);
        if (this.linkPreview) stroke(ctx, this.linkPreview, ink, 1.6 / scale, [5 / scale, 3 / scale]);
        if (this.layers.sections)
            for (const sec of d.sections) stroke(ctx, sec.points, "rgba(40,75,74,.6)", .85 / scale, [5 / scale, 4 / scale]);
        ctx.restore();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        this.titleBoxes = [];
        if (this.layers.labels)
            for (const lab of [...d.labels.filter(l => !l.building), ...d.buildings.filter(b => b.showTitle !== false).map(b => {
                const old = d.labels.find(l => l.building === b.id);
                const pos = titlePoint(d, b);
                return { ...old, name: b.name, building: b.id, point: pos, offset: [pos[0] - b.center[0], pos[1] - b.center[1]] as Point, titleOnly: !old };
            })]) {
                if (lab.minZoom && this.zoom < lab.minZoom) continue;
                const { point, text, difference, actual } = labelReading(this.island, lab);
                const [x, y] = this.screen(point), size = actual == null ? 12 : (this.zoom >= 2.1 ? 12 : 10);
                ctx.save();
                if (lab.building) {
                    ctx.font = size + "px \"Microsoft YaHei UI\",sans-serif";
                    const width = ctx.measureText(text + (difference ?? "")).width;
                    this.titleBoxes.push({ id: lab.building, x, y, width, height: size + 4, point });
                }
                if (lab.spot) {
                    circle(ctx, x, y, 2.1, "#574a37", paper, .8);
                    ctx.textAlign = "left";
                    mapText(ctx, text, x + 6, y, size, "#574a37");
                }
                else if (difference) {
                    ctx.font = "500 " + size + "px \"Microsoft YaHei UI\", sans-serif";
                    const left = x - ctx.measureText(text + difference).width / 2;
                    ctx.textAlign = "left";
                    mapText(ctx, text, left, y, size);
                    mapText(ctx, difference, left + ctx.measureText(text).width, y, size, "#aa3026");
                }
                else mapText(ctx, text, x, y, size, "#2d3a2d", actual == null);
                ctx.restore();
            }
        this.drawOverlays();
        drawGeoOverlay(this);
        if (this.displayField !== "height" && this.contours) {
            for (const { label, value } of this.contours.lines) if (label) mapText(ctx, String(+value.toPrecision(5)), ...this.screen(label), 11, "#294964");
            if (this.contours.constant !== undefined) {
                ctx.textAlign = "right";
                mapText(ctx, "该场在画布内处处为 " + +this.contours.constant.toPrecision(6), this.width - 16, 87, 12);
            }
        }
        const unit = [1, 2, 5, 10, 20, 50, 100].filter(n => n * scale <= 86).at(-1) ?? 1;
        document.getElementById("scale-bar")!.style.width = (unit * scale) + "px";
        document.getElementById("scale-text")!.textContent = unit + " m";
        document.getElementById("zoom-value")!.textContent = Math.round(this.zoom * 100) + "%";
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
                ctx.fillStyle = problem.severity === "notice" ? "#fff2e8" : "#ba4035";
                ctx.strokeStyle = "#ae4438";
                ctx.lineWidth = 1.3;
                ctx.fillRect(-2.8, -2.8, 5.6, 5.6);
                ctx.strokeRect(-2.8, -2.8, 5.6, 5.6);
                ctx.restore();
            }
        this.controls = handles(d, this.layers, active);
        const occupied: Box[] = [];
        for (const h of this.controls) {
            const [x, y] = this.screen(h.point);
            if (x < -12 || y < -12 || x > this.width + 12 || y > this.height + 12) continue;
            const selected = active?.kind === h.kind && active.id === h.id && (active.index ?? 0) === h.index &&
        (!active.role || active.role === h.role);
            if (selected) {
                circle(ctx, x, y, 10, "rgba(251,252,238,.62)", aqua, 1.5);
            }
            if (h.kind === "section") {
                const text = h.id + (h.index ? "′" : "");
                ctx.fillStyle = "#597f80";
                ctx.fillRect(x - 7, y - 7, 14, 14);
                ctx.font = "bold 10px sans-serif";
                ctx.fillStyle = "white";
                ctx.fillText(text, x, y + .5);
            }
            else if (h.kind === "node") {
                const n = d.nodes.find(n => n.id === h.id)!,
                    pose = nodePose(d, n);
                if (pose.angle != null) {
                    const angle = pose.angle;
                    const len = 10,
                        cos = Math.cos(angle),
                        sin = -Math.sin(angle);
                    stroke(ctx, [
                        [x, y],
                        [x + cos * len, y + sin * len]
                    ], paper, 3.4);
                    stroke(ctx, [
                        [x, y],
                        [x + cos * len, y + sin * len]
                    ], ink, 1.6);
                }
                if (n.type === "door") {
                    ctx.save();
                    ctx.translate(x, y);
                    ctx.rotate(-pose.normal!);
                    ctx.fillStyle = paper;
                    ctx.strokeStyle = ink;
                    ctx.lineWidth = 1.8;
                    ctx.fillRect(-3.5, -3.5, 7, 7);
                    ctx.strokeRect(-3.5, -3.5, 7, 7);
                    ctx.restore();
                }
                else circle(ctx, x, y, n.type === "junction" ? 5 : 3.8, n.type === "junction" ? ink : paper, ink, 1.6);
                if (this.zoom >= 2.1 || selected || active ?.kind === "edge" && [this.island.routes.find(r => r.id === active.id) ?.edge.from, this.island.routes.find(r => r.id === active.id) ?.edge.to].includes(h.id)) {
                    ctx.font = "600 11px \"Microsoft YaHei UI\", sans-serif";
                    const w = ctx.measureText(n.name).width + 12;
                    let top = y - 23;
                    while (occupied.some(b => x + w / 2 > b[0] && x - w / 2 < b[2] && top < b[3] && top + 16 > b[1])) top -= 17;
                    occupied.push([x - w / 2, top, x + w / 2, top + 16]);
                    ctx.fillStyle = selected ? ink : "rgba(248,251,239,.95)";
                    ctx.beginPath();
                    ctx.roundRect(x - w / 2, top, w, 16, 3);
                    ctx.fill();
                    ctx.fillStyle = selected ? "#fff" : ink;
                    ctx.fillText(n.name, x, top + 8);
                }
            }
            else {
                const size = h.kind === "via" ? 5.5 : 5;
                ctx.save();
                ctx.translate(x, y);
                if (h.kind === "via") ctx.rotate(Math.PI / 4);
                ctx.fillStyle = h.kind === "via" ? "#e2f1e6" : paper;
                ctx.strokeStyle = ink;
                ctx.lineWidth = 1.3;
                ctx.fillRect(-size / 2, -size / 2, size, size);
                ctx.strokeRect(-size / 2, -size / 2, size, size);
                ctx.restore();
            }
        }
        if (this.activeIssue && this.island.issues.includes(this.activeIssue)) {
            const [x, y] = this.screen(this.activeIssue.point);
            circle(ctx, x, y, 10, null, "#b24136", 2);
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

export function labelReading(island: Pick<Island, "design" | "terrain" | "graded">, label: Label): { point: Point; text: string; actual?: number; difference?: string } {
    const d = island.design, b = label.building && d.buildings.find(b => b.id === label.building);
    const anchor = b ? b.center : label.point!;
    const point = b && label.offset ? anchor.map((v, i) => v + label.offset![i]) as Point : anchor;
    if (label.titleOnly) return { point, text: label.name };
    const target = label.var ? d.variables[label.var]?.value : undefined;
    if (target === undefined && !label.spot) return { point, text: label.name };
    const actual = sampleDefined(island.terrain.grid, island.graded.heights, island.terrain.defined, ...anchor);
    if (actual === undefined) return { point, text: label.name };
    return { point, actual, text: [label.name, actual.toFixed(1) + "m"].filter(Boolean).join(" "),
        difference: target != null && Math.abs(actual - target) > .5 ? "（设计 " + +target.toFixed(1) + "m）" : "" };
}
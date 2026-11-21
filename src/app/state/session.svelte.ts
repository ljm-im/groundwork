import { tick } from "svelte";
import { Island } from "../../core/island.js";
import { History } from "../../core/edit/history.ts";
import { layerDefaults } from "./layers.ts";
import { areaBoundary, nodePose, zonePolygon } from "../../core/design/model.ts";
import { bounds, sample } from "../../core/math/geometry.ts";
import { addDoor, doorNode, doorRoads, openDoorAt, removeBuildingPart } from "../../core/edit/buildings.ts";
import { removeVia, removeLinks } from "../../core/edit/topology.ts";
import { addFeature, clickDrawing, deleteFeature, featureBounds, featureNames, featureOf, finishExtension, newDrawing } from "../../core/edit/landforms.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { drawSections } from "../../render/sections.js";
import { IslandMap } from "../../render/map.js";
import { previewLevels } from "./levelPreview";
import { DesignFiles } from "./files";
import { errorText, type Building, type Design, type Door, type Drawing, type FeatureKind, type Gesture, type IslandModel, type Issue, type Layer, type MapView, type Point, type RoadNode, type Selection, type Tab, type Tool } from "../types";

export const hints: Record<Tool, string> = {
    peak: "单击地图放置山头", ridge: "依次点出山脊折点，双击或按 Enter 完成 · 单击已有山脊线加点，单击端点延长",
    planting: "依次点出绿化区边界，双击或按 Enter 完成 · 单击已有绿化区边界加点",
    clearing: "依次点出空地边界，双击或按 Enter 完成 · 单击已有多边形空地边界加点",
    door: "单击建筑外墙开门", select: "拖动空白处平移 · 拖动控制点编辑 · 双击山脊或边界线加点",
    node: "单击空地放置节点，或单击建筑外墙开门", edge: "单击起点节点或建筑外墙",
    gate: "依次点区域和外部节点，先点的一端是起点", fork: "单击道路插入分岔，或从建筑外墙起步",
    building: "单击空地放置建筑，Esc 返回选择", via: "单击道路插入途经点，可连续添加，Esc 返回选择"
};

export function timed<T>(name: string, work: () => T): T {
    const start = performance.now(), result = work();
    performance.clearMeasures(name);
    performance.measure(name, { start, end: performance.now() });
    return result;
}

export class Editor {
    // The engine mutates large grids in place. Publish an inspector revision only after a completed edit.
    island = $state.raw<IslandModel>(null!);
    tab = $state<Tab>("network");
    tool = $state<Tool>("select");
    selection = $state.raw<Selection | null>(null);
    issue = $state.raw<Issue | null>(null);
    candidates = $state.raw<Issue[] | null>(null);
    layers = $state({ ...layerDefaults });
    filter = $state("");
    buildingFilter = $state("");
    terrainFilter = $state("");
    densityOpen = $state(false);
    revision = $state(0);
    hint = $state(hints.select);
    position = $state("");
    busy = $state<string | null>("正在生成地形…");
    toast = $state.raw<{ text: string; point?: Point } | null>(null);
    removal = $state.raw<{ title: string; roads: string[]; perform: () => void } | null>(null);
    conversion = $state.raw<{ text: string; finish: (convert: boolean) => void } | null>(null);
    draft = $state.raw<{ text: string; filename?: string; date: string } | null>(null);
    filename = $state("island.json");
    dirty = $state(false);
    canUndo = $state(false);
    canRedo = $state(false);
    history!: History & { states: string[]; index: number };
    readonly files = new DesignFiles(this);
    map!: MapView;
    panel!: HTMLElement;
    plots!: HTMLElement;
    linkFrom: string | null = null;
    linkYard: ReturnType<typeof areaBoundary> | null = null;
    forkFromDoor = false;
    gesture: Gesture | null = null;
    pendingLevels = new Set<string>();
    pendingEdges = new Set<string>();
    private frame = 0;
    private toastTimer?: ReturnType<typeof setTimeout>;

    attach(canvas: HTMLCanvasElement) {
        this.map = new IslandMap(canvas, this.layers) as MapView;
    }
    dispose() {
        cancelAnimationFrame(this.frame);
        this.map.clearIssue();
        clearTimeout(this.toastTimer);
    }
    message(text: string, point?: Point) {
        this.toast = { text, point };
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.toast = null, point ? 2000 : 3600);
    }
    syncHistory() {
        this.canUndo = this.history.canUndo;
        this.canRedo = this.history.canRedo;
        this.dirty = this.history.dirty;
        this.files.remember();
    }
    record() {
        this.history.record(this.island.design);
        this.syncHistory();
    }
    select(h: Selection | null, open = true) {
        if (h && h.kind in featureNames) this.densityOpen = false;
        this.selection = h;
        this.map.selection = h;
        this.issue = this.candidates = null;
        this.map.clearIssue();
        this.panel.scrollTop = 0;
        if (open && h) {
            if (h.kind in featureNames || h.kind === "zone" && this.island.design.zones.find(z => z.id === h.id)?.height.endRise) this.tab = "terrain";
            if (["edge", "node", "via"].includes(h.kind)) this.tab = "network";
            if (h.kind === "building") this.tab = "buildings";
        }
        this.revision++;
        this.map.draw();
    }
    refresh(reset = false, sidebar = true) {
        if (this.issue && !this.island.issues.includes(this.issue)) {
            this.issue = null;
            this.map.clearIssue();
        }
        if (this.candidates?.some(i => !this.island.issues.includes(i))) this.candidates = null;
        this.map.selection = this.selection;
        this.map.setIsland(this.island, reset);
        this.map.draw();
        drawSections(this.plots, this.island);
        if (sidebar) this.revision++;
    }
    setTool(mode: Tool) {
        this.tool = mode;
        this.linkFrom = this.linkYard = null;
        this.forkFromDoor = false;
        this.map.drawing = ["ridge", "planting", "clearing"].includes(mode) ? newDrawing(mode as FeatureKind) as Drawing : null;
        if (mode === "ridge" || mode === "peak") this.layers.ridges = true;
        if (mode === "planting" || mode === "clearing") this.layers.plantingAreas = true;
        if (["node", "edge", "fork", "gate", "door", "via"].includes(mode)) this.layers.network = true;
        this.map.linkPreview = null;
        this.hint = hints[mode];
        this.map.draw();
    }
    changeTab(tab: Tab) {
        if (this.tool in featureNames && tab !== "terrain") this.setTool("select");
        if (tab !== "terrain") this.densityOpen = false;
        this.tab = tab;
        if (tab === "issues") this.candidates = null;
        this.panel.scrollTop = 0;
    }
    layer(key: Layer, value: boolean) {
        this.layers[key] = value;
        this.map.draw();
    }
    flush() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        if (this.pendingLevels.size) {
            const changed = this.pendingLevels;
            this.pendingLevels = new Set();
            timed("terrain-editor:level-preview", () => {
                previewLevels(this.island, changed);
                this.refresh(false, false);
            });
        }
        else if (this.pendingEdges.size) {
            const ids = this.pendingEdges;
            this.pendingEdges = new Set();
            timed("terrain-editor:edge-edit", () => {
                this.island.reroute(ids);
                this.refresh(false, !this.gesture);
            });
        }
        else {
            this.map.draw();
            drawSections(this.plots, this.island);
        }
    }
    schedule() {
        this.frame ||= requestAnimationFrame(() => this.flush());
    }
    flushPending() {
        if (this.frame) this.flush();
    }
    async working(label: string, fn: () => void) {
        if (this.busy) return;
        this.busy = label;
        try {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            fn();
        }
        catch (e) {
            this.message(errorText(e));
            console.error(e);
        }
        finally {
            this.busy = null;
        }
    }
    replace(design: Design, reset = false) {
        this.island = new Island(design) as IslandModel;
        this.selection = this.issue = this.candidates = null;
        this.map.clearIssue();
        this.setTool("select");
        this.refresh(reset);
    }
    rebuild() {
        return this.working("正在重新生成地形与侵蚀…", () => {
            this.island = new Island(this.island.design) as IslandModel;
            this.refresh();
            this.record();
        });
    }
    navigate(forward: boolean) {
        if (this.busy || this.gesture || !(forward ? this.canRedo : this.canUndo)) return;
        return this.working(forward ? "正在重做…" : "正在撤销…", () => {
            this.replace(this.history.step(forward)!);
            this.syncHistory();
        });
    }
    reroute(ids: Set<string>) {
        timed("terrain-editor:edge-edit", () => {
            this.island.reroute(ids);
            this.refresh();
        });
        this.record();
    }
    rerouteAll() {
        timed("terrain-editor:all-routes", () => {
            this.island.reroute(undefined);
            this.refresh();
        });
        this.message("全部道路已重新选线");
    }
    finishFeature(kind: string) {
        if (kind === "peak" || kind === "ridge") return this.rebuild();
        this.island.replant();
        this.refresh();
        this.record();
    }
    groundHeights(points: Point[]) {
        const { grid, heights } = this.island.terrain;
        return points.map(p => Math.round(sample(grid, heights, ...p) + 6));
    }
    createFeature(kind: FeatureKind, points: Point[]) {
        const heights = this.groundHeights(points);
        try {
            const item = addFeature(this.island.design, kind, points, kind === "ridge" ? heights : heights[0]);
            this.setTool("select");
            this.select({ kind, id: item.id });
            this.finishFeature(kind);
        }
        catch (e) {
            this.message(errorText(e));
        }
    }
    drawVertex(point: Point) {
        const drawing = this.map.drawing!;
        try {
            const result = clickDrawing(this.island.design, drawing, point, this.map.scale);
            if (!result) {
                this.map.draw();
                return;
            }
            this.select(result.selection);
            if (result.changed) this.finishFeature(drawing.kind);
            if (drawing.extension) this.hint = "依次单击延长山脊，双击或按 Enter 确认，Esc 放弃延长";
        }
        catch (e) {
            this.message(errorText(e));
        }
    }
    finishDrawing() {
        const drawing = this.map.drawing!;
        if (!drawing.extension) {
            if (drawing.points.length) this.createFeature(drawing.kind, drawing.points);
            return;
        }
        const selected = finishExtension(this.island.design, drawing, this.groundHeights(drawing.points));
        this.setTool("ridge");
        this.select(selected);
        if (drawing.points.length) this.finishFeature("ridge");
    }
    focus(kind: string, id: string) {
        const d = this.island.design, h = { kind, id };
        if (kind in featureNames) {
            this.layers[kind === "ridge" || kind === "peak" ? "ridges" : "plantingAreas"] = true;
            this.setTool("select");
        }
        else if (kind === "zone") this.setTool("select");
        this.select(h);
        if (kind === "edge") this.map.focusBounds(bounds(this.island.routes.find(r => r.id === id)!.points));
        else if (kind === "node") this.map.focus(nodePose(d, id).point, 2.3);
        else if (kind === "building") this.map.focus(d.buildings.find(b => b.id === id)!.center, 3);
        else if (kind === "zone") this.map.focusBounds(bounds(zonePolygon(d.zones.find(z => z.id === id)!.shape)));
        else this.map.focusBounds(featureBounds(d, kind as FeatureKind, featureOf(d, h)!));
    }
    vertex(index: number) {
        const h = this.selection!, item = this.island.design.ridges.find(r => r.id === h.id)!;
        this.select({ kind: h.kind, id: h.id, role: "vertex", index });
        this.map.focus(item.points[index].point, 2.5);
    }
    issueAt(issue: Issue) {
        this.layers.issues = true;
        if (!objectIssues(this.island, this.selection).includes(issue)) {
            this.selection = issue.node ? { kind: "node", id: issue.node } : issue.building ? { kind: "building", id: issue.building }
                : issue.zone ? { kind: "zone", id: issue.zone } : { kind: "edge", id: issue.road! };
        }
        this.map.selection = this.selection;
        this.issue = issue;
        void tick().then(() => this.panel.querySelector(`[data-issue="${this.island.issues.indexOf(issue)}"]`)?.scrollIntoView({ block: "nearest" }));
        this.map.focusIssue(issue);
    }
    pickMarkers(hits: Issue[]) {
        this.tab = "issues";
        this.selection = this.issue = null;
        this.candidates = hits.length > 1 ? hits : null;
        this.map.selection = null;
        this.map.clearIssue();
        this.panel.scrollTop = 0;
        if (hits.length === 1) this.issueAt(hits[0]);
        else this.map.draw();
    }
    addDoor(building: Building, wall: number) {
        addDoor(this.island.design, building, wall);
        this.select({ kind: "building", id: building.id });
        this.island.reroute(new Set());
        this.refresh();
        this.record();
    }
    connectDoor(building: Building, door: Door) {
        const node = doorNode(this.island.design, building, door);
        this.record();
        this.setTool("edge");
        this.linkFrom = node.id;
        this.select({ kind: "node", id: node.id });
        this.hint = "单击要连接的终点节点，Esc 取消";
    }
    removePart(b: Building, door?: Door) {
        const d = this.island.design, edges: EdgeLike[] = doorRoads(d, b, door);
        const perform = () => {
            removeBuildingPart(d, b, door);
            this.selection = door ? { kind: "building", id: b.id } : null;
            this.tab = "buildings";
            this.rebuild();
        };
        if (!edges.length) {
            perform();
            return;
        }
        this.removal = { title: "删除" + (door ? door.name ?? door.id : b.name) + "？", roads: edges.map(e => e.name), perform };
    }
    offerConversion(node: RoadNode, wall: NonNullable<ReturnType<typeof import("../../core/edit/buildings.ts").nearbyWall>>, edges: EdgeLike[]) {
        this.conversion = {
            text: "将“" + node.name + "”吸附到“" + wall.building.name + "”外墙。连接此节点的 " + edges.length + " 条道路会保留。",
            finish: (convert) => {
                if (convert) {
                    openDoorAt(this.island.design, wall, node);
                    this.select({ kind: "node", id: node.id });
                    this.reroute(new Set(edges.map(e => e.id)));
                }
                else {
                    this.revision++;
                    this.record();
                }
            }
        };
    }
    removeSelected() {
        const h = this.selection, d = this.island.design;
        if (!h) return;
        if (h.kind in featureNames) {
            try {
                const next = deleteFeature(d, h);
                if (this.map.drawing?.extension?.id === h.id) this.setTool(this.tool);
                this.select(next);
                this.finishFeature(h.kind);
            }
            catch (e) {
                this.message(errorText(e));
            }
            return;
        }
        if (h.kind === "building") {
            this.removePart(d.buildings.find(b => b.id === h.id)!);
            return;
        }
        const node = h.kind === "node" && d.nodes.find(n => n.id === h.id);
        if (node && node.type === "door") {
            const b = d.buildings.find(b => b.id === node.building)!;
            this.removePart(b, b.doors.find(door => door.id === node.door));
            return;
        }
        if (this.linkFrom) this.setTool("select");
        let ids = new Set<string>();
        if (h.kind === "node") {
            d.nodes = d.nodes.filter(n => n.id !== h.id);
            ids = removeLinks(d, new Set(d.edges.filter(e => e.from === h.id || e.to === h.id).map(e => e.id)));
        }
        else if (h.kind === "via") {
            removeVia(d.edges.find(e => e.id === h.id)!, h.index!);
            ids.add(h.id);
        }
        else if (h.kind === "edge") ids = removeLinks(d, new Set([h.id]));
        else return;
        this.selection = null;
        this.reroute(ids);
    }
}
type EdgeLike = { id: string; name: string };
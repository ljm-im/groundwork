import { tick } from "svelte";
import { Island } from "../../core/island.ts";
import { TerrainCache } from "../../core/terrain/cache.ts";
import { History, promptOwner, type PromptTarget } from "../../core/edit/history.ts";
import { layerDefaults } from "./layers.ts";
import { nodePose } from "../../core/design/model.ts";
import { bounds } from "../../core/math/geometry.ts";
import { addDoor, doorNode, doorRoads, openDoorAt, removeBuildingPart } from "../../core/edit/buildings.ts";
import { removeVia, removeLinks } from "../../core/edit/topology.ts";
import { type GeoNode, type GeoFunction } from "../../core/design/v5.ts";
import { parseDesign } from "../../core/design/model.ts";
import { type GeoControl, geometryPath, removeParameterPoint } from "../../core/edit/geoControls.ts";
import { addVariable, addField, copyGeo, defaultFunction, deleteGeo, dependentStrips, enableGeo, pathCenter, declarationUses, rangeUsers, removeDeclaration, sampleField, tenth } from "../../core/edit/geoNodes.ts";
import { setSegment } from "../../core/edit/paths.ts";
import { drawingTools, finishDraft, geoAt, startDrawing, updatePreview, type DrawTool } from "./geoTools.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { drawSections } from "../../render/sections.ts";
import { IslandMap } from "../../render/map.ts";
import { DesignFiles, type FileAction, type SaveState } from "./files.ts";
import { errorText, type Building, type Design, type Door, type Gesture, type IslandModel, type Issue, type Layer, type MapView, type Point, type RoadNode, type Selection, type Tab, type Tool } from "../types.ts";

export const hints: Record<Tool, string> = {
    pen: "单击放点 · 拖出控制柄 · 回车或单击首点闭合", rect: "拖动到矩形的对角", circle: "从圆心拖出半径",
    sector: "从圆心拖出半径，再单击确定终止角", strip: "点选起止节点 · Tab 交换 · 回车确认 · Esc 放弃",
    addPath: "绘制闭合路径 · 回车完成", shore: "绘制海岸线 · 回车闭合 · Esc 放弃",
    ridge: "单击添加山脊顶点 · 回车完成", peak: "单击添加山峰", slopeLine: "单击添加坡线顶点 · 回车完成", center: "单击选择圆心",
    door: "单击建筑外墙开门", select: "左键选择与编辑 · 中键拖动平移 · 滚轮缩放",
    node: "单击空地放置节点，或单击建筑外墙开门", edge: "单击起点节点或建筑外墙",
    fork: "单击道路插入分岔，或从建筑外墙起步",
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
    tab = $state<Tab>("terrain");
    tool = $state<Tool>("select");
    selection = $state.raw<Selection | null>(null);
    issue = $state.raw<Issue | null>(null);
    candidates = $state.raw<Issue[] | null>(null);
    layers = $state({ ...layerDefaults });
    filter = $state("");
    buildingFilter = $state("");
    terrainFilter = $state("");
    geoSelection = $state.raw<string[]>([]);
    hoverRefs = $state.raw<string[]>([]);
    displayField = $state("height");
    viewport = $state<string | null>(null);
    bottomTab = $state<"sections" | "profile">("sections");
    pathIndex = $state(0);
    erosionOpen = $state(false);
    menu = $state.raw<{ x: number; y: number; segment?: GeoControl } | null>(null);
    revision = $state(0);
    hint = $state(hints.select);
    position = $state("");
    busy = $state<string | null>(null);
    toast = $state.raw<{ text: string; point?: Point } | null>(null);
    removal = $state.raw<{ title: string; items: string[]; detail?: string; action?: string; perform?: () => void } | null>(null);
    conversion = $state.raw<{ text: string; finish: (convert: boolean) => void } | null>(null);
    draft = $state.raw<{ text: string; filename?: string; date: string } | null>(null);
    fileRequest = $state<FileAction | null>(null);
    filename = $state("未打开文件");
    saveState = $state<SaveState>("已保存");
    dirty = $state(false);
    canUndo = $state(false);
    canRedo = $state(false);
    history!: History;
    readonly files = new DesignFiles(this);
    map!: MapView;
    panel!: HTMLElement;
    properties?: HTMLElement;
    plots!: HTMLElement;
    linkFrom: string | null = null;
    forkFromDoor = false;
    gesture: Gesture | null = null;
    pendingLevels = new Set<string>();
    pendingEdges = new Set<string>();
    private readonly terrainCache = new TerrainCache();
    private frame = 0;
    private toastTimer?: ReturnType<typeof setTimeout>;

    attach(canvas: HTMLCanvasElement) {
        this.map = new IslandMap(canvas, this.layers);
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
    syncHistory(changed = false) {
        this.canUndo = this.history.canUndo;
        this.canRedo = this.history.canRedo;
        this.files.syncHistory(changed);
    }
    record() {
        this.syncHistory(this.history.record(this.island.design));
    }
    describe(target: PromptTarget, value: string) {
        const owner = promptOwner(this.island.design, target);
        if ((owner.prompt ?? "") === value) return;
        if (value === "") delete owner.prompt;
        else owner.prompt = value;
        this.syncHistory(this.history.record(this.island.design, target));
    }
    select(h: Selection | null, open = true, extend = false) {
        this.menu = null;
        this.map.vertex = undefined;
        this.map.profilePoint = undefined;
        if (this.properties && (h?.id !== this.selection?.id || h?.kind !== this.selection?.kind)) this.properties.scrollTop = 0;
        this.pathIndex = 0;
        if (this.map.draft && h?.id !== this.selection?.id) this.setTool("select");
        const selected = h?.kind === "geoNode" ? h.id : undefined;
        this.geoSelection = selected ? extend ? this.geoSelection.includes(selected) ? this.geoSelection.filter(id => id !== selected) : [selected, ...this.geoSelection] : [selected] : [];
        if (selected) h = this.geoSelection.length ? { kind: "geoNode", id: this.geoSelection[0] } : null;
        this.map.geoSelection = this.geoSelection;
        this.selection = h;
        this.map.selection = h;
        this.issue = this.candidates = null;
        this.map.clearIssue();
        if (open && h) {
            if (h.kind === "geoNode") this.tab = "terrain";
            if (["edge", "node", "via"].includes(h.kind)) this.tab = "network";
            if (h.kind === "building") this.tab = "buildings";
            if (["variable", "field"].includes(h.kind)) this.tab = "variables";
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
        if (!this.island.design.geoNodes.some(n => n.id === this.viewport)) this.viewport = null;
        if (this.displayField !== "height" && !Object.hasOwn(this.island.design.fields, this.displayField)) this.displayField = "height";
        this.map.displayField = this.displayField;
        this.map.geoSelection = this.geoSelection;
        this.map.setIsland(this.viewport ? this.island.viewThrough(this.viewport) : this.island, reset, this.island.terrain.grid);
        this.map.draw();
        this.sections();
        if (sidebar) this.revision++;
    }
    sections() {
        if (this.plots && this.map?.island) drawSections(this.plots, this.map.island);
    }
    setTool(mode: Tool, owner?: string) {
        this.menu = null;
        this.map.draft = undefined;
        this.map.vertex = undefined;
        this.linkFrom = null;
        this.forkFromDoor = false;
        this.tool = mode;
        this.hint = hints[mode];
        if (drawingTools.includes(mode as DrawTool)) {
            try {
                this.map.draft = startDrawing(this, mode as DrawTool, owner);
                updatePreview(this, this.map.draft);
            }
            catch (error) {
                this.hint = errorText(error); this.tool = "select";
            }
        }
        if (["node", "edge", "fork", "door", "via"].includes(mode)) this.layers.network = true;
        this.map.linkPreview = null;
        this.map.draw();
    }
    changeTab(tab: Tab) {
        if (this.map) this.setTool("select");
        this.tab = tab;
        if (tab === "issues") this.candidates = null;
        if (this.panel) this.panel.scrollTop = 0;
    }
    layer(key: Layer, value: boolean) {
        this.layers[key] = value;
        this.map.draw();
    }
    flush() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        if (this.pendingLevels.size) {
            this.pendingLevels = new Set();
            timed("terrain-editor:level-preview", () => {
                this.island.variables();
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
            this.sections();
        }
    }
    schedule() {
        this.frame ||= requestAnimationFrame(() => this.flush());
    }
    flushPending() {
        if (this.frame) this.flush();
    }
    async working(label: string | null, fn: () => void) {
        if (this.busy) return;
        try {
            if (label) {
                this.busy = label;
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }
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
    terrainWork(design: Design, fn: () => void) {
        const missing = this.terrainCache.missing(design);
        return this.working(missing === "base" ? "正在生成地形…" : missing === "natural" ? "正在更新地件…" : null, fn);
    }
    replace(design: Design, reset = false) {
        if (reset) {
            this.terrainCache.clear();
            this.displayField = "height"; this.viewport = null;
            if (this.properties) this.properties.scrollTop = 0;
            if (this.panel) this.panel.scrollTop = 0;
        }
        this.geoSelection = []; this.hoverRefs = []; this.map.highlights = [];
        this.island = new Island(design, this.terrainCache);
        this.selection = this.issue = this.candidates = null;
        this.map.clearIssue();
        this.setTool("select");
        this.refresh(reset);
    }
    rebuild() {
        const design = this.island.design;
        return this.terrainWork(design, () => {
            this.island = new Island(design, this.terrainCache);
            this.refresh();
            this.record();
        });
    }
    navigate(forward: boolean) {
        if (this.busy || this.gesture || !(forward ? this.canRedo : this.canUndo)) return;
        const target = this.history.promptStep(forward);
        if (target) {
            const restored = this.history.step(forward)!;
            const owner = promptOwner(this.island.design, target), value = promptOwner(restored, target).prompt;
            if (value === undefined) delete owner.prompt;
            else owner.prompt = value;
            this.revision++;
            this.syncHistory(true);
            return;
        }
        return this.terrainWork(this.history.peek(forward)!, () => {
            this.replace(this.history.step(forward)!);
            this.syncHistory(true);
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
    edit(fn: (d: Design) => Selection | null | void) {
        if (this.busy) return;
        try {
            const d = structuredClone(this.island.design), selected = fn(d);
            parseDesign(d, true);
            return this.terrainWork(d, () => {
                const next = new Island(d, this.terrainCache);
                this.island = next;
                if (selected !== undefined) this.select(selected);
                this.refresh();
                this.record();
            });
        }
        catch (error) {
            this.message(errorText(error)); this.revision++;
        }
    }
    editNode(id: string, fn: (n: GeoNode) => void) {
        return this.edit(d => {
            fn(geoAt(d, id));
        });
    }
    completeDrawing() {
        const draft = this.map.draft;
        if (!draft) return;
        return this.edit(d => {
            const n = finishDraft(d, this.map.island.terrain, draft);
            this.setTool("select");
            return { kind: "geoNode", id: n.id };
        });
    }
    geoCenter(id: string): Point {
        const c = geoAt(this.island.design, id).construction;
        if (c.type === "free" && c.paths.length === 1) return pathCenter(c.paths[0], this.island.design.grid.step / 8);
        const region = this.island.terrain.regions.get(id);
        if (region?.cells.length) {
            const sum: Point = [0, 0];
            for (const k of region.cells) {
                const p = this.island.terrain.grid.point(k); sum[0] += p[0]; sum[1] += p[1];
            }
            return [sum[0] / region.cells.length, sum[1] / region.cells.length];
        }
        const b = region?.shape.box;
        return b?.every(Number.isFinite) ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
    }
    switchFunction(n: GeoNode, type: GeoFunction["type"]) {
        this.map.vertex = undefined;
        if (type === "coast" || type === "slope") {
            this.setTool(type === "coast" ? "shore" : "slopeLine", n.id); this.revision++; return;
        }
        const value = tenth(sampleField(this.map.island.terrain, n.field ?? "height", this.geoCenter(n.id)));
        this.editNode(n.id, node => node.function = defaultFunction(type, value)!);
    }
    hover(ids: string[]) {
        this.hoverRefs = ids; this.map.highlights = ids; this.map.draw();
    }
    showField(field: string) {
        this.displayField = this.map.displayField = field; this.map.draw();
    }
    showThrough(id: string | null) {
        this.viewport = id; this.map.clearIssue(); this.refresh();
    }
    locateGeo(id: string) {
        const b = this.island.terrain.regions.get(id)?.shape.box;
        if (b?.every(Number.isFinite)) {
            this.map.focusBounds(b); this.hover([id]);
        }
    }
    duplicate(id: string) {
        this.edit(d => ({ kind: "geoNode", id: copyGeo(d, geoAt(d, id)).id }));
    }
    toggle(id: string) {
        this.editNode(id, n => enableGeo(n, !!n.disabled));
    }
    addDeclaration(kind: "variable" | "field") {
        this.edit(d => ({ kind, id: kind === "variable" ? addVariable(d) : addField(d) }));
    }
    removeGeo(id: string, vertex?: GeoControl) {
        const d = this.island.design, n = geoAt(d, id);
        if (vertex?.role === "parameter") {
            this.map.vertex = undefined;
            this.editNode(id, v => removeParameterPoint(v, vertex)); return;
        }
        if (vertex?.role === "vertex") {
            const path = geometryPath(n, vertex.path)!;
            const remaining = path.nodes.filter((_, i) => i !== vertex.index);
            if (remaining.length < (remaining.some(v => v.next === "arc") ? 2 : 3)) {
                this.message("路径需要保留足够的节点"); return;
            }
            const refs = vertex.path < 0 ? [] : rangeUsers(d, id, [path.nodes[vertex.index].id]);
            const perform = () => {
                this.map.vertex = undefined; this.editNode(id, v => geometryPath(v, vertex.path)!.nodes.splice(vertex.index, 1));
            };
            if (refs.length) this.removal = { title: "删除路径节点？", detail: "以下条带的范围将报告找不到节点。", action: "删除节点", items: refs.map(r => r.name), perform };
            else perform();
            return;
        }
        const refs = dependentStrips(d, id);
        const perform = () => {
            this.edit(d => {
                deleteGeo(d, id, true); return null;
            });
        };
        if (refs.length) this.removal = { title: "删除「" + n.name + "」？", detail: "以下条带引用了这个地件。", action: "一并删除这些条带", items: refs.map(r => r.name), perform };
        else perform();
    }
    segment(type: "line" | "curve" | "arc" | "tangent") {
        const h = this.menu?.segment, id = this.selection?.id;
        if (h && id) this.editNode(id, n => setSegment(geometryPath(n, h.path)!, h.index, type));
    }
    focus(kind: string, id: string) {
        const d = this.island.design, h = { kind, id };
        if (kind === "geoNode") this.setTool("select");
        this.select(h);
        if (kind === "edge") this.map.focusBounds(bounds(this.island.routes.find(r => r.id === id)!.points));
        else if (kind === "node") this.map.focus(nodePose(d, id).point, 2.3);
        else if (kind === "building") this.map.focus(d.buildings.find(b => b.id === id)!.center, 3);
        else if (kind === "geoNode") {
            const box = this.island.terrain.regions.get(id)!.shape.box;
            if (box.every(Number.isFinite)) this.map.focusBounds(box);
        }

    }
    issueAt(issue: Issue) {
        this.layers.issues = true;
        if (!objectIssues(this.island, this.selection).includes(issue)) {
            this.selection = issue.node ? { kind: "node", id: issue.node } : issue.building ? { kind: "building", id: issue.building }
                : issue.geoNode ? { kind: "geoNode", id: issue.geoNode } : issue.road ? { kind: "edge", id: issue.road } : null;
        }
        this.geoSelection = this.selection?.kind === "geoNode" ? [this.selection.id] : [];
        this.map.geoSelection = this.geoSelection;
        this.map.vertex = undefined;
        this.map.selection = this.selection;
        this.revision++;
        this.issue = issue;
        void tick().then(() => this.panel.querySelector(`[data-issue="${this.island.issues.indexOf(issue)}"]`)?.scrollIntoView({ block: "nearest" }));
        this.map.focusIssue(issue);
    }
    pickMarkers(hits: Issue[]) {
        this.tab = "issues";
        this.select(null, false);
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
        this.removal = { title: "删除" + (door ? door.name ?? door.id : b.name) + "？", items: edges.map(e => e.name), perform };
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
        if (h.kind === "geoNode") {
            this.removeGeo(h.id, this.map.vertex); return;
        }
        if (h.kind === "variable" || h.kind === "field") {
            const kind = h.kind, uses = declarationUses(d, kind, h.id);
            if (uses.length) {
                this.removal = { title: "仍有引用，无法删除", detail: "请先修改以下引用。", items: uses }; return;
            }
            this.edit(d => {
                removeDeclaration(d, kind, h.id); return null;
            }); return;
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
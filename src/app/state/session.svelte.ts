import { tick } from "svelte";
import { Island } from "../../core/island.ts";
import { TerrainCache } from "../../core/terrain/cache.ts";
import { History, promptOwner } from "../../core/edit/history.ts";
import { descriptionOwner, type DescriptionTarget } from "./descriptions.ts";
import { readDisplaySettings, saveDisplaySettings, type GridDisplay } from "./layers.ts";
import { nodePose } from "../../core/design/model.ts";
import { bounds } from "../../core/math/geometry.ts";
import { addDoor, doorNode, doorRoads, nearbyWall, openDoorAt, removeBuildingPart } from "../../core/edit/buildings.ts";
import { removeVia, removeLinks } from "../../core/edit/topology.ts";
import { type Expression, type GeoNode, type GeoFunction, markPoint } from "../../core/design/v5.ts";
import { randomFunctions, referenceUses, type Owner } from "../../core/design/parameters.ts";
import { parseDesign } from "../../core/design/model.ts";
import { type GeoControl, type GeometryTarget, geometryPath, removeParameterPoint } from "../../core/edit/geoControls.ts";
import { addInput, addField, copyGeo, defaultFunction, deleteGeo, dependentStrips, enableGeo, nextId, pathCenter, declarationUses, rangeUsers, removeDeclaration } from "../../core/edit/geoNodes.ts";
import { setSegment } from "../../core/edit/paths.ts";
import { drawingTools, finishDraft, geoAt, startDrawing, updatePreview, type DrawTool } from "./geoTools.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { propertyTabs, tabForSelection, type PropertyTab, type SubitemGroup } from "./inspector.ts";
import { drawSections } from "../../render/sections.ts";
import { IslandMap } from "../../render/map.ts";
import { DesignFiles, type FileAction, type SaveState } from "./files.ts";
import { errorText, type Building, type Design, type Door, type Gesture, type IslandModel, type Issue, type Layer, type Mark, type MapView, type Point, type RoadNode, type Selection, type Tab, type Tool } from "../types.ts";

export const hints: Record<Tool, string> = {
    pen: "单击放点，拖出控制柄，回车或单击首点闭合", rect: "拖动到矩形的对角", circle: "从圆心拖出半径",
    sector: "从圆心拖出半径，再单击确定终止角", strip: "点选起止节点，Tab 交换，回车确认，Esc 放弃",
    addPath: "绘制闭合路径，回车完成", shore: "绘制海岸线，回车闭合，Esc 放弃",
    ridge: "单击添加山脊顶点，回车完成", peak: "单击放置山峰，回车完成，Esc 放弃", slopeLine: "单击添加坡线顶点，回车完成", center: "单击选择圆心，回车完成，Esc 放弃",
    door: "单击建筑外墙开门", select: "左键选择与编辑，中键拖动平移，滚轮缩放",
    node: "单击空地放置节点，或单击建筑外墙开门", edge: "单击起点节点或建筑外墙",
    fork: "单击道路插入分岔，或从建筑外墙起步",
    textMark: "单击放置文字标记，Esc 返回选择", scaleMark: "单击放置比例尺，Esc 返回选择",
    building: "单击空地放置建筑，Esc 返回选择", via: "单击道路插入途经点，可连续添加，Esc 返回选择"
};

export function timed<T>(name: string, work: () => T): T {
    const start = performance.now(), result = work();
    performance.clearMeasures(name);
    performance.measure(name, { start, end: performance.now() });
    return result;
}

type Wall = NonNullable<ReturnType<typeof nearbyWall>>;

export class Editor {
    // The engine mutates large grids in place. Publish an inspector revision only after a completed edit.
    island = $state.raw<IslandModel>(null!);
    tab = $state<Tab>("terrain");
    tool = $state<Tool>("select");
    selection = $state.raw<Selection | null>(null);
    propertyTab = $state<PropertyTab>("general");
    private openSubitems = $state.raw<Record<string, readonly (string | number)[]>>({});
    issue = $state.raw<Issue | null>(null);
    candidates = $state.raw<Issue[] | null>(null);
    private readonly display = readDisplaySettings();
    layers = $state(this.display.layers);
    displayGrid = $state(this.display.grid);
    filter = $state("");
    buildingFilter = $state("");
    terrainFilter = $state("");
    geoSelection = $state.raw<string[]>([]);
    hoverRefs = $state.raw<string[]>([]);
    displayField = $state("height");
    viewport = $state<string | null>(null);
    bottomTab = $state<"sections" | "profile">("sections");
    pathIndex = $state(0);
    menu = $state.raw<{ x: number; y: number; map?: boolean; segment?: GeoControl } | null>(null);
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
        this.map = new IslandMap(canvas, this.layers, this.displayGrid);
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
    describe(target: DescriptionTarget, value: string) {
        const owner = descriptionOwner(this.island.design, target);
        if ((owner.prompt ?? "") === value) return;
        if (value === "") delete owner.prompt;
        else owner.prompt = value;
        this.syncHistory(this.history.record(this.island.design, target.group === "sections" ? undefined : target));
    }
    changePropertyTab(tab: PropertyTab) {
        if (tab === this.propertyTab || !propertyTabs(this.selection).some(([id]) => id === tab)) return;
        this.propertyTab = tab;
        if (this.properties) this.properties.scrollTop = 0;
    }
    setSelection(selection: Selection | null) {
        this.propertyTab = tabForSelection(selection, this.propertyTab);
        this.selection = selection;
    }
    subitemOpen(owner: string, group: SubitemGroup, item: string | number) {
        return this.openSubitems[group + ":" + owner]?.includes(item) ?? false;
    }
    toggleSubitem(owner: string, group: SubitemGroup, item: string | number, open = !this.subitemOpen(owner, group, item)) {
        const key = group + ":" + owner, items = this.openSubitems[key] ?? [];
        this.openSubitems = { ...this.openSubitems, [key]: open ? [...new Set([...items, item])] : items.filter(value => value !== item) };
    }
    removeSubitem(owner: string, group: "ridges" | "peaks", index: number) {
        const key = group + ":" + owner, items = (this.openSubitems[key] ?? []) as readonly number[];
        this.openSubitems = { ...this.openSubitems, [key]: items.filter(value => value !== index).map(value => value > index ? value - 1 : value) };
    }
    private clearSubitems(owner: string, kind: "geoNode" | "building") {
        const next = { ...this.openSubitems };
        for (const group of kind === "geoNode" ? ["ridges", "peaks"] : ["doors"]) delete next[group + ":" + owner];
        this.openSubitems = next;
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
        if (h?.kind !== this.selection?.kind || h?.id !== this.selection?.id) this.map.geometry = undefined;
        const focus = this.map.objectGeometry;
        if (focus && (focus.kind !== h?.kind || focus.id !== h.id || focus.kind === "via" && focus.index !== h.index)) this.map.objectGeometry = undefined;
        this.map.geoSelection = this.geoSelection;
        this.setSelection(h);
        this.map.selection = h;
        this.issue = this.candidates = null;
        this.map.clearIssue();
        if (open && h) {
            if (h.kind === "geoNode") this.tab = "terrain";
            if (["edge", "node", "via"].includes(h.kind)) this.tab = "network";
            if (h.kind === "building") this.tab = "buildings";
            if (h.kind === "mark") this.tab = "marks";
            if (["input", "field"].includes(h.kind)) this.tab = "inputs";
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
        this.map.setIsland(this.viewport ? this.island.viewBelow(this.viewport) : this.island.view(), reset, this.island.terrain, this.island.resolved);
        this.map.draw();
        this.sections();
        if (sidebar) this.revision++;
    }
    sections() {
        if (this.plots && this.map?.island) drawSections(this.plots, this.map.island);
    }
    focusObjectGeometry(target: Selection) {
        this.setTool("select");
        this.select(target);
        this.map.objectGeometry = target;
        this.map.draw();
    }
    focusGeometry(target?: GeometryTarget) {
        this.setTool("select"); this.map.geometry = target;
        this.map.draw(); this.revision++;
    }
    setTool(mode: Tool, owner?: string) {
        this.map.objectGeometry = undefined;
        this.menu = null;
        this.map.draft = undefined;
        this.map.vertex = undefined;
        this.linkFrom = null;
        this.forkFromDoor = false;
        this.tool = mode;
        this.hint = hints[mode];
        if (drawingTools.includes(mode as DrawTool)) {
            if (owner && (this.selection?.kind !== "geoNode" || this.selection.id !== owner)) this.select({ kind: "geoNode", id: owner });
            try {
                this.map.draft = startDrawing(this, mode as DrawTool, owner);
                updatePreview(this, this.map.draft);
            }
            catch (error) {
                this.hint = errorText(error); this.tool = "select";
            }
        }
        if (["node", "edge", "fork", "door", "via"].includes(mode)) this.layers.network = true;
        if (mode === "textMark" || mode === "scaleMark") this.layer("marks", true);
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
        if (this.layers[key] === value) return;
        this.layers[key] = value;
        saveDisplaySettings(this.layers, this.displayGrid);
        this.map.draw();
    }
    setGrid(key: keyof GridDisplay, value: string) {
        if (key === "mode") {
            if (value !== "meters" && value !== "pixels") return false;
            this.displayGrid.mode = value;
        }
        else {
            const spacing = Number(value);
            if (!Number.isFinite(spacing) || spacing <= 0) return false;
            this.displayGrid[key] = spacing;
        }
        saveDisplaySettings(this.layers, this.displayGrid);
        this.map.draw();
        return true;
    }
    flush() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        if (this.pendingLevels.size) {
            this.pendingLevels = new Set();
            timed("terrain-editor:level-preview", () => {
                this.island.inputs();
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
        this.geoSelection = []; this.hoverRefs = []; this.map.highlights = []; this.map.geometry = undefined;
        this.island = new Island(design, this.terrainCache);
        this.setSelection(null);
        this.issue = this.candidates = null;
        this.openSubitems = {};
        this.map.clearIssue();
        this.setTool("select");
        this.refresh(reset);
    }
    previewNumber(design: Design) {
        this.island.design = design;
        this.pendingLevels.add("number"); this.schedule();
    }
    commitNumber(design: Design) {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0; this.pendingLevels.clear();
        this.island.design = design;
        this.island.inputs(true); this.refresh(); this.record();
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
    edit(fn: (d: Design) => Selection | null | void, after?: () => void) {
        if (this.busy) return;
        try {
            const d = structuredClone(this.island.design), selected = fn(d);
            if (!d.inputs.seed && d.geoNodes.some(n => randomFunctions.includes(n.function.type) && n.function.seed === "{input:seed}"))
                d.inputs.seed = { label: "种子", value: 1 };
            parseDesign(d, true);
            return this.terrainWork(d, () => {
                const next = new Island(d, this.terrainCache);
                this.island = next;
                if (selected !== undefined) this.select(selected);
                after?.();
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
            return { kind: "geoNode", id: n.id };
        }, () => {
            this.setTool("select");
            const n = geoAt(this.island.design, this.selection!.id), f = n.function;
            if (draft.tool === "ridge" && f.type === "mountain") {
                this.map.geometry = { kind: "parameter", index: f.ridges.length - 1 };
                this.toggleSubitem(n.id, "ridges", f.ridges.length - 1, true);
            }
            else if (draft.tool === "peak" && f.type === "mountain") {
                this.map.geometry = { kind: "parameter", index: f.ridges.length + f.peaks.length - 1 };
                this.toggleSubitem(n.id, "peaks", f.peaks.length - 1, true);
            }
            else if (draft.tool === "center" || draft.tool === "slopeLine") this.map.geometry = { kind: "parameter", index: 0 };
            else if (draft.tool === "shore") this.map.geometry = { kind: "path", index: -1 };
            else if (n.construction.type === "free") this.map.geometry = { kind: "path", index: n.construction.paths.length - 1 };
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
        this.edit(d => {
            geoAt(d, n.id).function = defaultFunction(type)!;
        }, () => {
            this.clearSubitems(n.id, "geoNode");
            this.map.geometry = undefined;
        });
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
    addDeclaration(kind: "input" | "field") {
        this.edit(d => ({ kind, id: kind === "input" ? addInput(d) : addField(d) }));
    }
    blockRemoval(targets: [Owner, string][], name: string) {
        const items = [...new Set(targets.flatMap(([kind, id]) => referenceUses(this.island.design, kind, id)))];
        if (!items.length) return false;
        this.removal = { title: "无法删除“" + name + "”", detail: "请先修改以下表达式。", items };
        return true;
    }
    removePath(id: string, index: number) {
        const d = this.island.design, c = geoAt(d, id).construction;
        if (c.type !== "free" || c.paths.length < 2 || !c.paths[index]) return;
        const affected = rangeUsers(d, id, c.paths[index].nodes.map(v => v.id));
        const perform = () => {
            this.pathIndex = 0; this.map.vertex = undefined;
            this.editNode(id, v => {
                if (v.construction.type === "free") v.construction.paths.splice(index, 1);
            });
        };
        if (affected.length) this.removal = { title: "删除这条路径？", detail: "以下条带将找不到范围节点。", items: affected.map(v => v.label), action: "删除路径", perform };
        else perform();
    }
    removeGeo(id: string, vertex?: GeoControl) {
        const d = this.island.design, n = geoAt(d, id);
        if (vertex?.role === "parameter") {
            this.edit(d => {
                removeParameterPoint(d, geoAt(d, id), vertex);
            }, () => {
                this.map.vertex = undefined;
                if (n.function.type === "mountain" && vertex.path >= n.function.ridges.length) {
                    this.removeSubitem(id, "peaks", vertex.path - n.function.ridges.length);
                    this.map.geometry = undefined;
                }
            });
            return;
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
            if (refs.length) this.removal = { title: "删除路径节点？", detail: "以下条带的范围将报告找不到节点。", action: "删除节点", items: refs.map(r => r.label), perform };
            else perform();
            return;
        }
        const refs = dependentStrips(d, id);
        if (this.blockRemoval([["geo", id], ...refs.map((r): [Owner, string] => ["geo", r.id])], n.label)) return;
        const perform = () => {
            this.edit(d => {
                deleteGeo(d, id, true); return null;
            }, () => {
                this.clearSubitems(id, "geoNode");
                for (const ref of refs) this.clearSubitems(ref.id, "geoNode");
            });
        };
        if (refs.length) this.removal = { title: "删除“" + n.label + "”？", detail: "以下条带引用了这个地件。", action: "一并删除", items: refs.map(r => r.label), perform };
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
        else if (kind === "node") this.map.focus(nodePose(this.island.resolved, id).point, 2.3);
        else if (kind === "building") this.map.focus(d.buildings.find(b => b.id === id)!.center, 3);
        else if (kind === "mark") {
            const point = markPoint(d.marks.find(m => m.id === id)!, d.buildings);
            const [x, y] = this.map.screen(point);
            if (x < 0 || y < 0 || x > this.map.width || y > this.map.height) this.map.focus(point, this.map.zoomFactor());
        }
        else if (kind === "geoNode") {
            const box = this.island.terrain.regions.get(id)!.shape.box;
            if (box.every(Number.isFinite)) this.map.focusBounds(box);
        }

    }
    issueAt(issue: Issue) {
        this.layers.issues = true;
        if (!objectIssues(this.island, this.selection).includes(issue)) {
            this.setSelection(issue.node ? { kind: "node", id: issue.node } : issue.building ? { kind: "building", id: issue.building }
                : issue.geoNode ? { kind: "geoNode", id: issue.geoNode } : issue.road ? { kind: "edge", id: issue.road } : null);
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
    addMark(kind: Mark["kind"], point: Point) {
        return this.edit(d => {
            const id = nextId(d.marks.map(m => m.id), "mark-"), p: Point = [+point[0].toFixed(2), +point[1].toFixed(2)];
            d.marks.push(kind === "scale" ? { id, kind, label: "比例尺", point: p, length: 10 }
                : { id, kind, label: "文字标记 " + id.slice(5), point: p });
            return { kind: "mark", id };
        }, () => this.setTool("select"));
    }
    copyMark(id: string) {
        return this.edit(d => {
            const copy = structuredClone(d.marks.find(m => m.id === id)!);
            copy.id = nextId(d.marks.map(m => m.id), "mark-");
            copy.label += " 副本";
            d.marks.push(copy);
            return { kind: "mark", id: copy.id };
        });
    }
    openWallDoor(design: Design, wall: Wall, node?: RoadNode<Expression>) {
        const building = design.buildings.find(item => item.id === wall.building.id)!;
        const count = building.doors.length;
        const result = openDoorAt(design, wall, node);
        if (building.doors.length > count) this.toggleSubitem(building.id, "doors", building.doors[count].id, true);
        return result;
    }
    addDoor(building: Building<Expression>, wall: number) {
        addDoor(this.island.design, building, wall);
        this.toggleSubitem(building.id, "doors", building.doors.at(-1)!.id, true);
        this.select({ kind: "building", id: building.id });
        this.island.reroute(new Set());
        this.refresh();
        this.record();
    }
    connectDoor(building: Building<Expression>, door: Door<Expression>) {
        const node = doorNode(this.island.design, building, door);
        this.record();
        this.setTool("edge");
        this.linkFrom = node.id;
        this.select({ kind: "node", id: node.id });
        this.hint = "单击要连接的终点节点，Esc 取消";
    }
    removePart(b: Building<Expression>, door?: Door<Expression>) {
        const d = this.island.design, edges: EdgeLike[] = doorRoads(d, b, door);
        const affected: [Owner, string][] = door ? [] : [["building", b.id]];
        for (const n of d.nodes.filter(n => n.building === b.id && (!door || n.door === door.id))) {
            if (!d.edges.some(edge => edge.from === n.id || edge.to === n.id)) affected.push(["node", n.id]);
        }
        if (this.blockRemoval(affected, door?.label ?? b.label)) return;
        const perform = () => this.edit(draft => {
            const target = draft.buildings.find(item => item.id === b.id)!;
            removeBuildingPart(draft, target, door && target.doors.find(v => v.id === door.id));
            return door ? { kind: "building", id: b.id } : null;
        }, () => {
            if (door) this.toggleSubitem(b.id, "doors", door.id, false);
            else this.clearSubitems(b.id, "building");
        });
        if (!edges.length) {
            perform();
            return;
        }
        this.removal = { title: "删除“" + (door ? door.label ?? door.id : b.label) + "”？", items: edges.map(e => e.label), perform };
    }
    offerConversion(node: RoadNode<Expression>, wall: Wall, edges: EdgeLike[]) {
        this.conversion = {
            text: "将“" + node.label + "”吸附到“" + wall.building.label + "”外墙。连接此节点的 " + edges.length + " 条道路会保留。",
            finish: (convert) => {
                if (convert) {
                    this.openWallDoor(this.island.design, wall, node);
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
        if (h.kind === "input" || h.kind === "field") {
            const kind = h.kind, uses = declarationUses(d, kind, h.id);
            if (uses.length) {
                this.removal = { title: "无法删除“" + ((kind === "input" ? d.inputs : d.fields)[h.id]?.label ?? h.id) + "”", detail: "请先修改以下引用位置。", items: uses }; return;
            }
            this.edit(d => {
                removeDeclaration(d, kind, h.id); return null;
            }); return;
        }
        if (h.kind === "mark") return this.edit(d => {
            d.marks = d.marks.filter(mark => mark.id !== h.id);
            return null;
        });
        if (h.kind === "building") {
            this.removePart(d.buildings.find(b => b.id === h.id)!);
            return;
        }
        const node = h.kind === "node" && d.nodes.find(n => n.id === h.id);
        if (node && this.blockRemoval([["node", node.id], ...d.edges.filter(e => node.type !== "door" && (e.from === node.id || e.to === node.id)).map((e): [Owner, string] => ["edge", e.id])], node.label)) return;
        if (h.kind === "edge" && this.blockRemoval([["edge", h.id]], d.edges.find(e => e.id === h.id)!.label)) return;
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
        this.setSelection(null);
        this.reroute(ids);
    }
}
type EdgeLike = { id: string; label: string };
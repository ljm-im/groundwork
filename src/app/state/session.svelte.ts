import { tick } from "svelte";
import { Project } from "../../core/project.ts";
import { TerrainCache } from "../../core/terrain/cache.ts";
import { History, promptOwner, type PromptTarget } from "../../core/edit/history.ts";
import { readDisplaySettings, saveDisplaySettings, type GridDisplay } from "./layers.ts";
import { constructionCenter } from "../../core/design/regions.ts";
import { seedId } from "../../core/design/defaults.ts";
import { type SelectionState } from "../../core/edit/types.ts";
import { defaultFollow, type GeoNode, type GeoFunction, type PathNode } from "../../core/design/v5.ts";
import { referenceSlots, slotName, type Slot } from "../../core/design/parameters.ts";
import { parseDesign } from "../../core/design/model.ts";
import { type GeoControl, type GeometryTarget, geometryPath, removeParameterPoint } from "../../core/edit/geoControls.ts";
import { addInput, addField, copyGeo, defaultFunction, deleteGeo, stripUsers, enableGeo, nextId, rangeUsers, removeDeclaration } from "../../core/edit/geoNodes.ts";
import { setNodeMode, setSegment } from "../../core/edit/paths.ts";
import { drawingTools, finishDraft, geoAt, startDrawing, updatePreview, type DrawTool, type GeoDraft } from "./geoTools.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { advancedErosion, propertyTabs, tabForSelection, type PropertyTab, type SubitemGroup } from "./inspector.ts";
import { drawSections } from "../../render/sections.ts";
import { ProjectMap } from "../../render/map.ts";
import { DesignFiles, type FileAction, type SaveState } from "./files.ts";
import { errorText, type Design, type Gesture, type ProjectModel, type Issue, type Layer, type Mark, type MapView, type Point, type Selection, type Tab, type Tool } from "../types.ts";

const hints: Record<Tool, string> = {
    select: "单击选择，中键平移，滚轮缩放",
    pen: "单击放尖角，拖出控制柄，回车、双击或单击首点闭合",
    rect: "拖动或单击矩形的两个对角",
    circle: "拖出半径或单击圆心和圆周",
    sector: "拖出半径或单击圆心和圆周，再单击确定终止角",
    strip: "单击起止节点，Tab 交换，回车确认，Esc 放弃",
    addPath: "单击放尖角，拖出控制柄，回车、双击或单击首点闭合",
    shore: "单击放点，回车、双击或单击首点闭合海岸线",
    ridge: "单击放置山脊顶点，回车或双击完成",
    slopeLine: "单击放置坡线顶点，回车或双击完成",
    peak: "单击放置山峰，回车完成",
    center: "单击选择圆心，回车完成",
    harbor: "单击选择港湾圆心，回车完成",
    textMark: "单击放置文字标记，Esc 返回选择",
    scaleMark: "单击放置比例尺，Esc 返回选择"
};

type RemovalItem = { text: string; locate: () => void };
const emptySelection: SelectionState = { selection: null, geoSelection: [] };

export function timed<T>(name: string, work: () => T): T {
    const start = performance.now(), result = work();
    performance.clearMeasures(name);
    performance.measure(name, { start, end: performance.now() });
    return result;
}

export class Editor {
    // The engine mutates large grids in place. Publish an inspector revision only after a completed edit.
    project = $state.raw<ProjectModel>(null!);
    tab = $state<Tab>("terrain");
    tool = $state<Tool>("select");
    selection = $state.raw<Selection | null>(null);
    propertyTab = $state<PropertyTab>("general");
    private openSubitems = $state.raw<Record<string, readonly (string | number)[]>>({});
    issue = $state.raw<Issue | null>(null);
    selectedIssues = $state.raw<Issue[]>([]);
    private readonly display = readDisplaySettings();
    layers = $state(this.display.layers);
    displayGrid = $state(this.display.grid);
    variableFilter = $state("");
    markFilter = $state("");
    terrainFilter = $state("");
    geoSelection = $state.raw<string[]>([]);
    hoverRefs = $state.raw<string[]>([]);
    displayField = $state("height");
    viewport = $state<string | null>(null);
    pathIndex = $state(0);
    menu = $state.raw<{ x: number; y: number; map?: boolean; control?: GeoControl } | null>(null);
    revision = $state(0);
    hint = $state(hints.select);
    position = $state("");
    busy = $state<string | null>(null);
    toast = $state.raw<{ text: string; point?: Point } | null>(null);
    removal = $state.raw<{ title: string; items?: RemovalItem[]; detail: string; action?: string; perform?: () => void } | null>(null);
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
    revealProperties?: () => void;
    plots!: HTMLElement;
    gesture: Gesture | null = null;
    private numberPreview = false;
    private readonly terrainCache = new TerrainCache();
    private frame = 0;
    private toastTimer?: ReturnType<typeof setTimeout>;

    attach(canvas: HTMLCanvasElement) {
        this.map = new ProjectMap(canvas, this.layers, this.displayGrid);
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
    private selectionState(): SelectionState {
        return { selection: this.selection, geoSelection: this.geoSelection };
    }
    record(before = this.selectionState()) {
        this.syncHistory(this.history.record(this.project.design, { before, after: this.selectionState() }));
    }
    private exists(h: Selection) {
        const d = this.project.design, exists = (items: { id: string }[]) => items.some(n => n.id === h.id);
        switch (h.kind) {
            case "geoNode": return exists(d.geoNodes);
            case "mark": return exists(d.marks);
            case "section": return exists(d.sections);
            case "input": return h.id !== seedId && Object.hasOwn(d.inputs, h.id);
            case "field": return h.id === "height" || Object.hasOwn(d.fields, h.id);
        }
    }
    private restoreSelection(state: SelectionState) {
        const h = state.selection && this.exists(state.selection) ? state.selection : null;
        this.geoSelection = h?.kind === "geoNode" ? state.geoSelection.filter(id => this.exists({ kind: "geoNode", id })) : [];
        this.map.geoSelection = this.geoSelection;
        this.map.selection = h;
        this.setSelection(h);
        this.map.vertex = this.map.geometry = this.map.objectGeometry = undefined;
    }
    describe(target: PromptTarget, value: string) {
        const owner = promptOwner(this.project.design, target);
        if ((owner.prompt ?? "") === value) return;
        if (value === "") delete owner.prompt;
        else owner.prompt = value;
        const selection = this.selectionState();
        this.syncHistory(this.history.record(this.project.design, { before: selection, after: selection, prompt: target }));
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
    private clearSubitems(owner: string) {
        const next = { ...this.openSubitems };
        for (const group of ["ridges", "peaks", "advanced"]) delete next[group + ":" + owner];
        this.openSubitems = next;
    }
    select(h: Selection | null, open = true, extend = false) {
        this.menu = null;
        this.map.vertex = undefined;
        if (this.properties && (h?.id !== this.selection?.id || h?.kind !== this.selection?.kind)) this.properties.scrollTop = 0;
        this.pathIndex = 0;
        if (this.map.draft && h?.id !== this.selection?.id) this.setTool("select");
        const selected = h?.kind === "geoNode" ? h.id : undefined;
        this.geoSelection = selected ? extend ? this.geoSelection.includes(selected) ? this.geoSelection.filter(id => id !== selected) : [selected, ...this.geoSelection] : [selected] : [];
        if (selected) h = this.geoSelection.length ? { kind: "geoNode", id: this.geoSelection[0] } : null;
        if (h?.kind !== this.selection?.kind || h?.id !== this.selection?.id) this.map.geometry = undefined;
        const focus = this.map.objectGeometry;
        if (focus && (focus.kind !== h?.kind || focus.id !== h.id || (focus.index !== undefined && focus.index !== h.index))) this.map.objectGeometry = undefined;
        this.map.geoSelection = this.geoSelection;
        this.setSelection(h);
        this.map.selection = h;
        this.issue = null;
        this.selectedIssues = [];
        this.map.clearIssue();
        if (open && h) {
            if (h.kind === "geoNode") this.tab = "terrain";
            if (h.kind === "mark") this.tab = "marks";
            if (["input", "field"].includes(h.kind)) this.tab = "inputs";
        }
        this.revision++;
        this.map.draw();
    }
    refresh(reset = false, sidebar = true) {
        if (this.issue && !this.project.issues.includes(this.issue)) {
            this.issue = null;
            this.map.clearIssue();
        }
        if (this.selectedIssues.some(i => !this.project.issues.includes(i))) this.selectedIssues = [];
        this.map.selection = this.selection;
        if (!this.project.design.geoNodes.some(n => n.id === this.viewport)) this.viewport = null;
        if (this.displayField !== "height" && !Object.hasOwn(this.project.design.fields, this.displayField)) this.displayField = "height";
        this.map.displayField = this.displayField;
        this.map.geoSelection = this.geoSelection;
        this.map.setProject(this.viewport ? this.project.viewBelow(this.viewport) : this.project.view(), reset, this.project.terrain);
        this.map.draw();
        this.sections();
        if (sidebar) this.revision++;
    }
    sections() {
        if (this.plots && this.map?.project) drawSections(this.plots, this.map.project);
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
    setTool(mode: Tool, owner?: string, member?: number, sources?: string[]) {
        this.map.objectGeometry = undefined;
        this.menu = null;
        this.map.draft = undefined;
        this.map.vertex = undefined;
        this.tool = mode;
        this.hint = hints[mode];
        if (drawingTools.includes(mode as DrawTool)) {
            if (owner && (this.selection?.kind !== "geoNode" || this.selection.id !== owner)) this.select({ kind: "geoNode", id: owner });
            try {
                this.map.draft = startDrawing(this, mode as DrawTool, owner, member, sources);
                updatePreview(this, this.map.draft);
            }
            catch (error) {
                this.hint = errorText(error); this.tool = "select";
            }
        }
        if (mode === "textMark" || mode === "scaleMark") this.layer("marks", true);
        this.map.draw();
    }
    cancelDrawing() {
        const draft = this.map.draft;
        if (draft && (draft.down || draft.start || draft.nodes.length || draft.anchors.length))
            this.setTool(draft.tool, draft.owner, draft.member, draft.ids);
        else this.setTool("select");
    }
    changeTab(tab: Tab) {
        if (tab === this.tab) return;
        this.menu = null;
        this.tab = tab;
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
        if (this.numberPreview) {
            this.numberPreview = false;
            timed("terrain-editor:level-preview", () => {
                this.project.update();
                this.refresh(false, false);
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
    replace(design: Design, reset = false, state = reset ? emptySelection : this.selectionState()) {
        const draft = this.map.draft;
        if (reset) {
            this.terrainCache.clear();
            this.displayField = "height"; this.viewport = null;
            if (this.properties) this.properties.scrollTop = 0;
            if (this.panel) this.panel.scrollTop = 0;
        }
        this.hoverRefs = []; this.map.highlights = []; this.map.geometry = undefined;
        this.project = new Project(design, this.terrainCache);
        this.restoreSelection(state);
        this.issue = null;
        this.selectedIssues = [];
        this.openSubitems = {};
        this.map.clearIssue();
        this.refresh(reset);
        if (reset || draft?.owner && draft.owner !== this.selection?.id) this.setTool("select");
        else if (draft) this.setTool(draft.tool, draft.owner, draft.member, draft.ids);
    }
    previewNumber(design: Design) {
        this.project.design = design;
        this.numberPreview = true; this.schedule();
    }
    commitNumber(design: Design) {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0; this.numberPreview = false;
        this.project.design = design;
        this.project.update(); this.refresh(); this.record();
    }
    navigate(forward: boolean) {
        if (this.busy || this.gesture || !(forward ? this.canRedo : this.canUndo)) return;
        const step = this.history.editStep(forward), state = (forward ? step?.after : step?.before) ?? this.selectionState();
        if (step?.prompt) {
            const restored = this.history.step(forward)!;
            const owner = promptOwner(this.project.design, step.prompt), value = promptOwner(restored, step.prompt).prompt;
            if (value === undefined) delete owner.prompt;
            else owner.prompt = value;
            this.restoreSelection(state);
            this.map.draw();
            this.revision++;
            this.syncHistory(true);
            return;
        }
        return this.terrainWork(this.history.peek(forward)!, () => {
            this.replace(this.history.step(forward)!, false, state);
            this.syncHistory(true);
        });
    }
    edit(fn: (d: Design) => Selection | null | void, after?: () => void) {
        if (this.busy) return;
        try {
            const before = this.selectionState(), draft = structuredClone(this.project.design), selected = fn(draft);
            const d = parseDesign(draft, true);
            return this.terrainWork(d, () => {
                const next = new Project(d, this.terrainCache);
                this.project = next;
                if (selected !== undefined) this.select(selected);
                after?.();
                this.refresh();
                this.record(before);
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
    completeDrawing(keepTool = false) {
        const draft = this.map.draft;
        if (!draft) return;
        return this.edit(d => {
            const n = finishDraft(d, this.map.project.terrain, draft);
            return { kind: "geoNode", id: n.id };
        }, () => {
            this.finishTool(keepTool, draft);
            const n = geoAt(this.project.design, this.selection!.id), f = n.function;
            if (keepTool) return;
            if (draft.tool === "ridge" && f.type === "mountain") {
                const index = draft.member ?? f.ridges.length - 1;
                this.map.geometry = { kind: "parameter", index };
                this.toggleSubitem(n.id, "ridges", index, true);
            }
            else if (draft.tool === "peak" && f.type === "mountain") {
                const index = draft.member ?? f.peaks.length - 1;
                this.map.geometry = { kind: "parameter", index: f.ridges.length + index };
                this.toggleSubitem(n.id, "peaks", index, true);
            }
            else if (["center", "slopeLine", "harbor"].includes(draft.tool)) this.map.geometry = { kind: "parameter", index: 0 };
            else if (draft.tool === "shore") this.map.geometry = { kind: "path", index: -1 };
            else if (n.construction.type === "free") this.map.geometry = { kind: "path", index: n.construction.paths.length - 1 };
        });
    }
    private finishTool(keep: boolean, draft?: GeoDraft) {
        if (!keep) this.setTool("select");
        else if (draft) this.setTool(draft.tool, draft.owner, draft.member, draft.tool === "strip" ? draft.ids : undefined);
    }
    geoCenter(id: string): Point {
        const { design, terrain } = this.project;
        return constructionCenter(geoAt(design, id).construction, design.grid.step, terrain.grid, terrain.regions.get(id));
    }
    switchFunction(n: GeoNode, type: GeoFunction["type"]) {
        this.map.vertex = undefined;
        if (type === "coast" || type === "slope") {
            this.setTool(type === "coast" ? "shore" : "slopeLine", n.id); this.revision++; return;
        }
        this.edit(d => {
            geoAt(d, n.id).function = defaultFunction(type)!;
        }, () => {
            this.clearSubitems(n.id);
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
        const b = this.project.terrain.regions.get(id)?.shape.box;
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
        return this.edit(d => ({ kind, id: kind === "input" ? addInput(d) : addField(d) }), () => {
            this.revealProperties?.();
            void tick().then(() => {
                const label = this.properties?.previousElementSibling?.querySelector("input");
                label?.focus({ preventScroll: true }); label?.select();
            });
        });
    }
    openMenu(h: Selection, x: number, y: number, map = false, control?: GeoControl) {
        this.select(h);
        if (control?.role === "vertex") this.pickVertex(control);
        this.menu = { x, y, map, control };
    }
    pickVertex(control: GeoControl) {
        this.map.vertex = control;
        if (control.role === "vertex" && control.path >= 0) {
            this.pathIndex = control.path;
            this.changePropertyTab("region");
        }
        this.revision++;
        this.map.draw();
    }
    private referenceItem(slot: Slot): RemovalItem {
        return { text: slotName(slot), locate: () => {
            const address = slot.path.join(".");
            if (slot.owner === "geo") {
                this.select({ kind: "geoNode", id: slot.id });
                this.changePropertyTab(slot.path[2] === "construction" ? "region" : "function");
                const group = slot.path[3];
                if ((group === "ridges" || group === "peaks") && typeof slot.path[4] === "number")
                    this.toggleSubitem(slot.id, group, slot.path[4], true);
                if (group === "line" || group === "ridges" || group === "peaks") {
                    const n = geoAt(this.project.design, slot.id), point = slot.path.indexOf("points");
                    if (point >= 0 || group === "peaks" && slot.path[5] === "at") {
                        const path = group === "ridges" ? Number(slot.path[4]) :
                            group === "peaks" && n.function.type === "mountain" ? n.function.ridges.length + Number(slot.path[4]) : 0;
                        const index = point >= 0 ? Number(slot.path[point + 1]) : 0;
                        this.map.geometry = { kind: "parameter", index: path };
                        this.pickVertex({ role: "parameter", path, index, point: this.geoCenter(slot.id) });
                    }
                }
                if (geoAt(this.project.design, slot.id).function.type === "erosion" &&
                    advancedErosion.some(([key]) => key === group)) this.toggleSubitem(slot.id, "advanced", 0, true);
            }
            else if (slot.owner === "input") this.select(slot.id === seedId ? null : { kind: "input", id: slot.id });
            else if (slot.owner === "mark") this.select({ kind: "mark", id: slot.id });
            else this.select({ kind: "field", id: String(slot.path[1]) });
            this.revealProperties?.();
            void tick().then(() => {
                const field = Array.from(this.properties?.querySelectorAll<HTMLElement>("[data-parameter]") ?? [])
                    .find(el => el.dataset.parameter === address);
                field?.scrollIntoView({ block: "nearest" });
            });
        } };
    }
    private geoReference(id: string, label: string, parameter: string, tab: PropertyTab): RemovalItem {
        return { text: "“" + label + "”." + parameter, locate: () => {
            this.select({ kind: "geoNode", id });
            this.changePropertyTab(tab);
            this.revealProperties?.();
        } };
    }
    private blockRemoval(name: string, items: RemovalItem[], detail = "请先修改以下引用位置。") {
        this.removal = { title: "无法删除“" + name + "”", detail, items };
    }
    removePath(id: string, index: number) {
        const d = this.project.design, c = geoAt(d, id).construction;
        if (c.type !== "free" || c.paths.length < 2 || !c.paths[index]) return;
        const affected = rangeUsers(d, id, c.paths[index].nodes.map(v => v.id));
        const perform = () => {
            this.pathIndex = 0; this.map.vertex = undefined;
            this.editNode(id, v => {
                if (v.construction.type === "free") v.construction.paths.splice(index, 1);
            });
        };
        if (affected.length) this.removal = { title: "删除这条路径？", detail: "以下条带将找不到范围节点。", items: affected.map(v => this.geoReference(v.id, v.label, "边", "region")), action: "删除路径", perform };
        else perform();
    }
    removeGeo(id: string, vertex?: GeoControl) {
        const d = this.project.design, n = geoAt(d, id);
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
            if (refs.length) this.removal = { title: "删除路径节点？", detail: "以下条带的范围将报告找不到节点。", action: "删除节点", items: refs.map(r => this.geoReference(r.id, r.label, "边", "region")), perform };
            else perform();
            return;
        }
        const items = referenceSlots(d, "geo", id).map(slot => this.referenceItem(slot));
        items.push(...stripUsers(d, id).map(ref => this.geoReference(ref.id, ref.label, "边", "region")));
        if (n.function.type === "ground" && !d.geoNodes.some(other => other.id !== id && other.function.type === "ground"))
            return this.blockRemoval(n.label, items, "设计必须保留至少一个使用 ground 的地件。");
        if (items.length) return this.blockRemoval(n.label, items);
        this.edit(d => {
            deleteGeo(d, id);
            if (this.selection?.kind === "geoNode" && this.selection.id === id) return null;
        }, () => this.clearSubitems(id));
    }
    pathNodeMode(control: GeoControl, mode: PathNode["mode"]) {
        const id = this.selection?.id;
        if (id) this.editNode(id, n => setNodeMode(geometryPath(n, control.path)!, control.index, mode));
    }
    segment(control: GeoControl, type: "line" | "curve" | "arc" | "tangent") {
        const id = this.selection?.id;
        if (id) this.editNode(id, n => setSegment(geometryPath(n, control.path)!, control.index, type));
    }
    focus(kind: Selection["kind"], id: string) {
        this.select({ kind, id });
        if (kind === "mark") {
            const mark = this.project.design.marks.find(m => m.id === id)!;
            const [x, y] = this.map.markScreen(mark);
            if (mark.follow === "ground" && (x < 0 || y < 0 || x > this.map.width || y > this.map.height))
                this.map.focus(mark.point, this.map.zoomFactor());
        }
        else if (kind === "geoNode") {
            const box = this.project.terrain.regions.get(id)!.shape.box;
            if (box.every(Number.isFinite)) this.map.focusBounds(box);
        }
    }
    private scrollToIssues(issues: Issue[]) {
        void tick().then(() => {
            const indices = new Set(issues.map(issue => this.project.issues.indexOf(issue)));
            const row = Array.from(this.panel?.querySelectorAll<HTMLElement>("[data-issue]") ?? [])
                .find(el => indices.has(Number(el.dataset.issue)));
            row?.scrollIntoView({ block: "nearest" });
        });
    }
    issueAt(issue: Issue) {
        this.layer("issues", true);
        if (!objectIssues(this.project, this.selection).includes(issue))
            this.select(issue.geoNode ? { kind: "geoNode", id: issue.geoNode } : null, false);
        this.selectedIssues = [issue];
        this.issue = issue;
        this.map.focusIssue(issue);
        this.scrollToIssues([issue]);
    }
    pickMarkers(hits: Issue[]) {
        this.changeTab("issues");
        this.issueAt(hits[0]);
        this.selectedIssues = hits;
        this.scrollToIssues(hits);
    }
    addMark(kind: Mark["kind"], point: Point, keepTool = false) {
        return this.edit(d => {
            const id = nextId(d.marks.map(m => m.id), "mark-"), p: Point = [+point[0].toFixed(2), +point[1].toFixed(2)];
            const follow = defaultFollow(kind);
            d.marks.push(kind === "scale" ? { id, kind, label: "比例尺", point: p, follow, length: 10 }
                : { id, kind, label: "文字标记 " + id.slice(5), point: p, follow });
            return { kind: "mark", id };
        }, () => this.finishTool(keepTool));
    }
    setMarkFollow(id: string, follow: Mark["follow"]) {
        return this.edit(d => {
            const mark = d.marks.find(m => m.id === id)!;
            if (mark.follow === follow) return;
            mark.point = this.map.markCoordinate(this.map.markScreen(mark), follow);
            mark.follow = follow;
        });
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
    canRemove(h: Selection) {
        return !(h.kind === "input" && h.id === seedId || h.kind === "field" && h.id === "height");
    }
    removeSelected() {
        const h = this.selection;
        if (!h) return;
        if (h.kind === "geoNode" && this.map.vertex) this.removeGeo(h.id, this.map.vertex);
        else this.removeElement(h);
    }
    removeElement(h: Selection) {
        if (!this.canRemove(h) || !this.exists(h)) return;
        if (h.kind === "geoNode") return this.removeGeo(h.id);
        if (h.kind === "input" || h.kind === "field") {
            const kind = h.kind, d = this.project.design;
            const items = referenceSlots(d, kind, h.id).map(slot => this.referenceItem(slot));
            if (kind === "field") items.push(...d.geoNodes.filter(n => n.field === h.id)
                .map(n => this.geoReference(n.id, n.label, "输出到", "function")));
            const item = (kind === "input" ? d.inputs : d.fields)[h.id];
            if (items.length) return this.blockRemoval(item.label ?? h.id, items);
            return this.edit(d => {
                removeDeclaration(d, kind, h.id);
                if (this.selection?.kind === h.kind && this.selection.id === h.id) return null;
            });
        }
        return this.edit(d => {
            const group = h.kind === "mark" ? "marks" : "sections";
            d[group].splice(d[group].findIndex(item => item.id === h.id), 1);
            if (this.selection?.kind === h.kind && this.selection.id === h.id) return null;
        });
    }
}
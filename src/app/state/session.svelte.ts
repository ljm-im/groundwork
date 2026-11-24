import { tick } from "svelte";
import { Project } from "../../core/project.ts";
import { TerrainCache } from "../../core/terrain/cache.ts";
import { History } from "../../core/edit/history.ts";
import { readAt, writeAt, type Address } from "../../core/design/address.ts";
import { readDisplaySettings, saveDisplaySettings, type GridDisplay } from "./layers.ts";
import { constructionCenter } from "../../core/design/regions.ts";
import { fieldPrecision, heightId, isBuiltin } from "../../core/design/defaults.ts";
import { defaultFollow, type GeoNode, type GeoFunction, type PathNode } from "../../core/design/v5.ts";
import { geoParameter, slotName, type Slot } from "../../core/design/parameters.ts";
import { parseDesign } from "../../core/design/model.ts";
import { type GeoControl, type GeometryTarget, copyGeometryItem, geometryPath, insertPathNode, removeGeometryItem, removeParameterPoint } from "../../core/edit/geoControls.ts";
import { addInput, addField, copyGeo, defaultFunction, deleteGeo, enableGeo, isLastInitializer, nextId, nodeIds, rangeUsers,
    removalUses, removeDeclaration, requiredInitializer, type RemovalUse } from "../../core/edit/geoNodes.ts";
import { setNodeMode, setSegment } from "../../core/edit/paths.ts";
import { drawingTools, finishDraft, geoAt, startDrawing, updatePreview, type DrawTool } from "./geoTools.ts";
import { displaySteps, markParameters } from "../../core/design/functionTable.ts";
import { functionGeometry } from "../../core/edit/functionGeometry.ts";
import { sampleField } from "../../core/design/results.ts";
import { designErrorText } from "./designMessages.ts";
import { quotedLocation } from "../../core/design/problems.ts";
import { displayReading } from "./numbers.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { propertyTabs, tabForSelection, type PropertyTab, type SubitemGroup } from "./inspector.ts";
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
    strip: "单击一个或两个地件，再单击起止节点，Tab 交换，回车确认",
    addPath: "单击放尖角，拖出控制柄，回车、双击或单击首点闭合",
    shore: "单击放点，回车、双击或单击首点闭合海岸线",
    ridge: "单击放置山脊顶点，回车或双击完成",
    slopeLine: "单击放置坡线顶点，回车或双击完成",
    peak: "单击放置山峰",
    center: "单击选择圆心",
    harbor: "单击选择港湾圆心",
    textMark: "单击放置文字标记",
    scaleMark: "单击放置比例尺",
    section: "单击起点和终点"
};

function drawingStatus(mode: Exclude<Tool, "select">, name: string, owner?: string, member?: number) {
    const label = "“" + name + "”", pen = "回车、双击或单击首点结束", line = "回车或双击结束", point = "单击地图放置";
    const text = {
        pen: ["新建地件（钢笔）", pen, true],
        rect: ["新建地件（矩形）", "单击或拖出两个对角", false],
        circle: ["新建地件（圆）", "单击或拖出圆心和半径", false],
        sector: ["新建地件（扇形）", "单击圆心和圆周，再单击终止角", false],
        strip: owner ? ["重选" + label + "的边", "单击起止节点，Tab 交换，回车确认", true] :
            ["新建地件（条带）", "单击一个或两个地件，再单击起止节点，回车确认", true],
        addPath: ["给" + label + "添加路径", pen, true],
        shore: ["重画" + label + "的海岸线", pen, true],
        ridge: [member === undefined ? "给" + label + "添加山脊" : "重画" + label + "的山脊线", line, true],
        peak: [member === undefined ? "给" + label + "添加山峰" : "移动" + label + "的山峰", point, false],
        slopeLine: ["重画" + label + "的坡线", line, true],
        center: ["选择" + label + "的圆心", point, false],
        harbor: ["选择" + label + "的港湾圆心", point, false],
        textMark: ["新建文字标记", point, false],
        scaleMark: ["新建比例尺", point, false],
        section: ["新建剖面线", "单击起点和终点", false]
    } as const;
    const [title, end, finish] = text[mode];
    return { title, end, finish, owner, member };
}

type RemovalItem = { text: string; locate: () => void };
export type DescriptionTarget = { group: "design" } | { group: "geoNodes" | "sections"; id: string };

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
    drawing = $state.raw<ReturnType<typeof drawingStatus>>();
    drawingReady = $state(false);
    selection = $state.raw<Selection | null>(null);
    propertyTab = $state<PropertyTab>("general");
    private openSubitems = $state.raw(new Set<string | number>());
    private memberKeys = new Map<string, number[]>();
    private nextMemberKey = 0;
    selectedIssues = $state.raw<Issue[]>([]);
    private readonly display = readDisplaySettings();
    layers = $state(this.display.layers);
    displayGrid = $state(this.display.grid);
    variableFilter = $state("");
    markFilter = $state("");
    terrainFilter = $state("");
    hoverRefs = $state.raw<string[]>([]);
    displayField = $state(heightId);
    viewport = $state<string | null>(null);
    menu = $state.raw<{ x: number; y: number; map?: boolean; control?: GeoControl } | null>(null);
    revision = $state(0);
    hint = $state(hints.select);
    position = $state("");
    private pointerPosition?: Point;
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
    revealSections?: () => void;
    plots!: HTMLElement;
    gesture: Gesture | null = null;
    private numberPreview = false;
    private readonly terrainCache = new TerrainCache();
    private frame = 0;
    private toastTimer?: ReturnType<typeof setTimeout>;

    attach(canvas: HTMLCanvasElement) {
        this.map = new ProjectMap(canvas, this.layers, this.displayGrid);
        this.map.referencedGeo = () => this.hoverRefs;
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
    record(before = this.selection) {
        this.syncHistory(this.history.record(this.project.design, { before, after: this.selection }));
    }
    private exists(h: Selection) {
        const d = this.project.design, exists = (items: { id: string }[]) => items.some(n => n.id === h.id);
        switch (h.kind) {
            case "geoNode": return exists(d.geoNodes);
            case "mark": return exists(d.marks);
            case "section": return exists(d.sections);
            case "input": return Object.hasOwn(d.inputs, h.id);
            case "field": return Object.hasOwn(d.fields, h.id);
        }
    }
    private restoreSelection(state: Selection | null) {
        const h = state && this.exists(state) ? state : null;
        this.map.selection = h;
        this.setSelection(h);
        this.map.vertex = this.map.geometry = this.map.objectGeometry = undefined;
    }
    private descriptionAddress(target: DescriptionTarget): Address {
        return target.group === "design" ? ["prompt"] :
            [target.group, this.project.design[target.group].findIndex(item => item.id === target.id), "prompt"];
    }
    description(target: DescriptionTarget) {
        return readAt(this.project.design, this.descriptionAddress(target)) as string | undefined ?? "";
    }
    describe(target: DescriptionTarget, value: string, group?: symbol) {
        const address = this.descriptionAddress(target);
        if (address[1] === -1) return;
        this.editMetadata(address, value || undefined, group);
    }
    private editMetadata(address: Address, value: unknown, group?: symbol) {
        const design = this.project.design;
        if (readAt(design, address) === value) return;
        writeAt(design, address, value);
        const selection = this.selection;
        this.syncHistory(this.history.record(design, { before: selection, after: selection, metadata: address, group }));
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
    private memberGroup(owner: string, group: "ridges" | "peaks") {
        const key = group + ":" + owner;
        let keys = this.memberKeys.get(key);
        if (!keys) this.memberKeys.set(key, keys = []);
        return keys;
    }
    subitemKey(owner: string, group: SubitemGroup, index?: number) {
        if (group === "advanced") return "advanced:" + owner;
        const keys = this.memberGroup(owner, group);
        return keys[index!] ??= ++this.nextMemberKey;
    }
    subitemOpen(owner: string, group: SubitemGroup, index?: number) {
        return this.openSubitems.has(this.subitemKey(owner, group, index));
    }
    toggleSubitem(owner: string, group: SubitemGroup, index?: number, open = !this.subitemOpen(owner, group, index)) {
        const key = this.subitemKey(owner, group, index), next = new Set(this.openSubitems);
        if (open) next.add(key);
        else next.delete(key);
        this.openSubitems = next;
    }
    private discardSubitem(owner: string, group: "ridges" | "peaks", index: number) {
        this.toggleSubitem(owner, group, index, false);
        this.memberGroup(owner, group).splice(index, 1);
    }
    private clearSubitems(owner: string) {
        this.toggleSubitem(owner, "advanced", undefined, false);
        const next = new Set(this.openSubitems);
        for (const group of ["ridges", "peaks"]) {
            const key = group + ":" + owner;
            for (const id of this.memberKeys.get(key) ?? []) next.delete(id);
            this.memberKeys.delete(key);
        }
        this.openSubitems = next;
    }
    changeMember(owner: string, group: "ridges" | "peaks", index: number, copy: boolean) {
        return this.edit(d => {
            const change = copy ? copyGeometryItem : removeGeometryItem;
            change(d, geoAt(d, owner), [group], index);
        }, () => {
            if (copy) {
                const keys = this.memberGroup(owner, group), after = index + 1;
                keys.length = Math.max(keys.length, after);
                keys.splice(after, 0, ++this.nextMemberKey);
                this.toggleSubitem(owner, group, after, true);
            }
            else this.discardSubitem(owner, group, index);
            this.map.geometry = this.map.vertex = undefined;
        });
    }
    select(h: Selection | null, open = true) {
        const sectionChanged = this.selection?.kind === "section" || h?.kind === "section";
        if (this.tool !== "select") this.cancelDrawing();
        this.menu = null;
        this.map.vertex = undefined;
        if (this.properties && (h?.id !== this.selection?.id || h?.kind !== this.selection?.kind)) this.properties.scrollTop = 0;
        if (h?.kind !== this.selection?.kind || h?.id !== this.selection?.id) this.map.geometry = undefined;
        const focus = this.map.objectGeometry;
        if (focus && (focus.kind !== h?.kind || focus.id !== h.id || (focus.index !== undefined && focus.index !== h.index))) this.map.objectGeometry = undefined;
        this.setSelection(h);
        this.map.selection = h;
        this.selectedIssues = [];
        this.map.clearIssue();
        if (open && h) {
            if (h.kind === "geoNode") this.tab = "terrain";
            if (h.kind === "mark" || h.kind === "section") this.tab = "marks";
            if (["input", "field"].includes(h.kind)) this.tab = "inputs";
        }
        this.revision++;
        this.map.draw();
        if (sectionChanged) this.sections();
    }
    refresh(reset = false, sidebar = true) {
        if (this.selectedIssues.some(i => !this.project.issues.includes(i))) {
            this.selectedIssues = [];
            this.map.clearIssue();
        }
        this.map.selection = this.selection;
        if (!this.project.design.geoNodes.some(n => n.id === this.viewport)) this.viewport = null;
        if (!Object.hasOwn(this.project.design.fields, this.displayField)) this.displayField = heightId;
        this.map.displayField = this.displayField;
        this.map.setProject(this.viewport ? this.project.viewBelow(this.viewport) : this.project.view(), reset, this.project.terrain);
        this.map.draw();
        if (this.pointerPosition) this.readPosition(this.pointerPosition);
        this.sections();
        if (sidebar) this.revision++;
    }
    sections() {
        if (this.plots && this.map?.project)
            drawSections(this.plots, this.map.project, this.selection?.kind === "section" ? this.selection.id : undefined);
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
    toolActive(mode: Tool, owner?: string, member?: number) {
        return this.tool === mode && this.drawing?.owner === owner && this.drawing?.member === member;
    }
    setTool(mode: Tool, owner?: string, member?: number) {
        if (owner && (this.selection?.kind !== "geoNode" || this.selection.id !== owner)) this.select({ kind: "geoNode", id: owner });
        this.map.objectGeometry = undefined;
        this.menu = null;
        this.map.draft = undefined;
        this.map.vertex = undefined;
        this.tool = mode;
        this.drawing = mode === "select" ? undefined : drawingStatus(mode, owner ? geoAt(this.project.design, owner).label : "", owner, member);
        this.drawingReady = false;
        this.hint = mode === "select" ? hints.select :
            (mode === "strip" && owner ? this.drawing!.end : hints[mode]) + "，Esc 取消";
        if (drawingTools.includes(mode as DrawTool)) {
            this.map.draft = startDrawing(this, mode as DrawTool, owner, member);
            updatePreview(this, this.map.draft);
        }
        if (mode === "textMark" || mode === "scaleMark") this.layer("marks", true);
        if (mode === "section") this.layer("sections", true);
        this.map.draw();
    }
    cancelDrawing() {
        this.setTool("select");
    }
    changeTab(tab: Tab) {
        if (this.tool !== "select") this.cancelDrawing();
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
    setGrid(key: keyof GridDisplay, value: string | number) {
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
    replace(design: Design, reset = false, state = reset ? null : this.selection) {
        if (reset) {
            this.terrainCache.clear();
            this.displayField = heightId; this.viewport = null;
            this.pointerPosition = undefined; this.position = "";
            if (this.properties) this.properties.scrollTop = 0;
            if (this.panel) this.panel.scrollTop = 0;
        }
        this.hoverRefs = []; this.map.geometry = undefined;
        this.project = new Project(design, this.terrainCache);
        this.restoreSelection(state);
        this.selectedIssues = [];
        this.openSubitems = new Set();
        this.memberKeys.clear();
        this.map.clearIssue();
        this.refresh(reset);
        if (reset) this.setTool("select");
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
        if (this.busy || this.gesture) return;
        if (this.tool !== "select") this.cancelDrawing();
        if (!(forward ? this.canRedo : this.canUndo)) return;
        const step = this.history.editStep(forward), selected = forward ? step?.after : step?.before;
        const state = selected === undefined ? this.selection : selected;
        if (step?.metadata) {
            const restored = this.history.step(forward)!;
            writeAt(this.project.design, step.metadata, readAt(restored, step.metadata));
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
            const before = this.selection, draft = structuredClone(this.project.design), selected = fn(draft);
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
            this.message(designErrorText(error, this.project.design)); this.revision++;
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
        if (draft.tool === "strip" && !this.drawingReady && !(draft.owner && draft.ids.length && !draft.anchors.length)) {
            this.message(draft.ids.length ? "请选择起止节点" : "请先在地图上选择地件");
            return;
        }
        if (draft.tool === "section") return this.edit(d => {
            const ids = new Set(d.sections.map(section => section.id));
            const id = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find(id => !ids.has(id)) ?? nextId(ids, "S");
            const label = nextId(d.sections.map(section => section.label), "剖面线 ");
            d.sections.push({ id, label, points: [draft.nodes[0].p, draft.nodes[1].p] });
            return { kind: "section", id };
        }, () => this.revealSections?.());
        return this.edit(d => {
            const n = finishDraft(d, this.map.project.terrain, draft);
            return { kind: "geoNode", id: n.id };
        }, () => {
            const n = geoAt(this.project.design, this.selection!.id), f = n.function;
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
    geoCenter(id: string): Point {
        const { design, terrain } = this.project;
        return constructionCenter(geoAt(design, id).construction, design.grid.step, terrain.grid, terrain.regions.get(id));
    }
    switchFunction(n: GeoNode, type: GeoFunction["type"], slope: "path" | "radial" = "path") {
        return this.edit(d => {
            const node = geoAt(d, n.id);
            if (type !== "coast" && type !== "slope") {
                node.function = defaultFunction(type);
                return;
            }
            const shape = this.project.terrain.regions.get(n.id)!.shape;
            const geometry = functionGeometry(node.construction, shape, d.grid.step, nodeIds(d));
            node.function = defaultFunction(type, { center: geometry.center, slope,
                shore: type === "coast" ? geometry.shore() : undefined,
                line: type === "slope" && slope === "path" ? geometry.line() : undefined });
        }, () => {
            this.clearSubitems(n.id);
            this.map.vertex = undefined;
            this.map.geometry = type === "coast" ? { kind: "path", index: -1 } : type === "slope" ? { kind: "parameter", index: 0 } : undefined;
        });
    }
    hover(ids: string[]) {
        this.hoverRefs = ids; this.map.draw();
    }
    showField(field: string) {
        this.displayField = this.map.displayField = field; this.map.draw();
        if (this.pointerPosition) this.readPosition(this.pointerPosition);
    }
    showThrough(id: string | null) {
        if (this.tool !== "select") this.cancelDrawing();
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
            this.changePropertyTab("region");
        }
        this.revision++;
        this.map.draw();
    }
    readPosition(p: Point) {
        const { design } = this.project, field = design.fields[this.displayField];
        const sample = sampleField(this.map.project.terrain, this.displayField, p);
        this.pointerPosition = p;
        const coordinate = (value: number) => displayReading(value, displaySteps.coordinates, displaySteps.coordinateUnit);
        this.position = "X " + coordinate(p[0]) + "  Y " + coordinate(p[1]) + "  " + field.label + " " +
            displayReading(sample, fieldPrecision(field), field.unit);
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
                if (geoParameter(geoAt(this.project.design, slot.id), slot.path.slice(2))?.advanced) this.toggleSubitem(slot.id, "advanced", undefined, true);
            }
            else if (slot.owner === "input") this.select({ kind: "input", id: slot.id });
            else if (slot.owner === "mark") this.select({ kind: "mark", id: slot.id });
            this.revealProperties?.();
            void tick().then(() => {
                const field = Array.from(this.properties?.querySelectorAll<HTMLElement>("[data-parameter]") ?? [])
                    .find(el => el.dataset.parameter === address);
                field?.scrollIntoView({ block: "nearest" });
            });
        } };
    }
    private geoReference(id: string, label: string, parameter: string, tab: PropertyTab): RemovalItem {
        return { text: quotedLocation(label, parameter), locate: () => {
            this.select({ kind: "geoNode", id });
            this.changePropertyTab(tab);
            this.revealProperties?.();
        } };
    }
    private removalItem(use: RemovalUse) {
        if (use.kind === "parameter") return this.referenceItem(use.slot);
        const { id, label } = use.node;
        return use.kind === "strip" ? this.geoReference(id, label, "边", "region") : this.geoReference(id, label, "输出到", "function");
    }
    private blockRemoval(name: string, items: RemovalItem[], detail = "请先修改以下引用位置。") {
        this.removal = { title: "无法删除“" + name + "”", detail, items };
    }
    removePath(id: string, index: number) {
        const d = this.project.design, c = geoAt(d, id).construction;
        if (c.type !== "free" || c.paths.length < 2 || !c.paths[index]) return;
        const affected = rangeUsers(d, id, c.paths[index].nodes.map(v => v.id));
        const perform = () => {
            this.map.vertex = undefined;
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
                    this.discardSubitem(id, "peaks", vertex.path - n.function.ridges.length);
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
        const items = removalUses(d, "geo", id).map(use => this.removalItem(use));
        if (isLastInitializer(d, id)) return this.blockRemoval(n.label, items, requiredInitializer + "。");
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
    insertNode(id: string, control: GeoControl) {
        this.edit(d => {
            insertPathNode(geometryPath(geoAt(d, id), control.path)!, control.index, control.point, nodeIds(d)());
        });
    }
    focus(kind: Selection["kind"], id: string) {
        this.select({ kind, id });
        if (kind === "mark") {
            const mark = this.project.design.marks.find(m => m.id === id)!;
            const [x, y] = this.map.markScreen(mark);
            if (mark.follow === "map" && (x < 0 || y < 0 || x > this.map.width || y > this.map.height))
                this.map.revealBounds([...mark.point, ...mark.point]);
        }
        else if (kind === "geoNode") {
            const box = this.project.terrain.regions.get(id)?.shape.box;
            if (box) this.map.revealBounds(box);
        }
        else if (kind === "section") {
            const [a, b] = this.project.design.sections.find(section => section.id === id)!.points;
            this.map.revealBounds([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
            this.revealSections?.();
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
    issueAt(issue: Issue, fit = true) {
        if (this.tool !== "select") this.cancelDrawing();
        this.layer("issues", true);
        if (!objectIssues(this.project, this.selection).includes(issue))
            this.select(issue.geoNode ? { kind: "geoNode", id: issue.geoNode } : null, false);
        this.selectedIssues = [issue];
        this.map.focusIssue(issue, fit);
        this.scrollToIssues([issue]);
    }
    pickMarkers(hits: Issue[]) {
        this.changeTab("issues");
        this.issueAt(hits[0]);
        this.selectedIssues = hits;
        this.scrollToIssues(hits);
    }
    addMark(kind: Mark["kind"], point: Point) {
        return this.edit(d => {
            const id = nextId(d.marks.map(m => m.id), "mark-"), p: Point = [+point[0].toFixed(2), +point[1].toFixed(2)];
            const follow = defaultFollow(kind);
            d.marks.push(kind === "scale" ? { id, kind, label: "比例尺", point: p, follow, length: markParameters.scale.default }
                : { id, kind, label: "文字标记 " + id.slice(5), point: p, follow });
            return { kind: "mark", id };
        });
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
        return h.kind !== "input" && h.kind !== "field" || !isBuiltin(h.kind, h.id);
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
            const items = removalUses(d, kind, h.id).map(use => this.removalItem(use));
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
import { tick } from "svelte";
import { Project, type ProjectView } from "../../core/project.ts";
import { TerrainCache } from "../../core/terrain/cache.ts";
import { History, type EditSelection } from "../../core/edit/history.ts";
import { copyAt, readAt, writeAt, type Address } from "../../core/design/address.ts";
import { readDisplaySettings, saveDisplaySettings } from "./layers.ts";
import { type GridDisplay } from "../../core/edit/display.ts";
import { constructionCenter } from "../../core/design/regions.ts";
import { bounds, type Box } from "../../core/math/geometry.ts";
import { heightId, isBuiltin } from "../../core/design/defaults.ts";
import { defaultFollow, type GeoNode, type GeoFunction, type CurveNode, type Section } from "../../core/design/v5.ts";
import { geoParameter, slotName, type Slot } from "../../core/design/parameters.ts";
import { numberEdits, type NumberChange } from "../../core/design/numberEdit.ts";
import { parseDesign } from "../../core/design/model.ts";
import { type GeoControl, type GeometryHover, type GeometryPart, type GeometrySelection, type GeometryTarget, controlOwner, copyGeometryItem,
    geometryHover, geometryPath, geometrySelection, insertCurveNode, parameterTarget, removeCurveNode, removeCurveSegment, removeGeometryItem,
    removeParameterPoint, resolveGeometrySelection } from "../../core/edit/geoControls.ts";
import { addInput, addField, copyGeo, defaultFunction, deleteGeo, enableGeo, isLastInitializer, nextId, nodeIds, rangeUsers,
    removalUses, removeDeclaration, requiredInitializer, type RemovalUse } from "../../core/edit/geoNodes.ts";
import { canRemoveNode, cleanHandles, editWholeCurve, segmentRemovalIndex, setNodeMode, setSegment } from "../../core/edit/paths.ts";
import { drawingReady, drawingTools, finishDraft, geoAt, startDrawing, updatePreview } from "./geoTools.ts";
import { type DrawTool, type GeoDraft } from "../../core/edit/types.ts";
import { markParameters } from "../../core/design/functionTable.ts";
import { functionGeometry } from "../../core/edit/functionGeometry.ts";
import { neighbor, segmentNeighbor, type SegmentType } from "../../core/design/path.ts";
import { sampleField } from "../../core/design/results.ts";
import { designErrorText } from "./designMessages.ts";
import { quotedLocation } from "../../core/design/problems.ts";
import { drawingStatus } from "./mapText.ts";
import { penNodeGroup, readPenNodes, savePenNodes, type PenNodeMode } from "./penNodes.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { propertyTabs, tabForSelection, type PropertyTab, type SubitemGroup } from "./inspector.ts";
import { ProjectMap, type LabelPreview, type LabelTarget, type MapView } from "../../render/map.ts";
import { DesignFiles, type FileAction, type SaveState } from "./files.ts";
import { errorText, type Design, type Expression, type Gesture, type ProjectModel, type Issue, type Layer, type Mark, type Point, type Selection, type Tab, type Tool } from "../types.ts";

type RemovalItem = { text: string; locate: () => void };
export type DescriptionTarget = { group: "design" } | { group: "geoNodes" | "sections"; id: string };

export function timed<T>(name: string, work: () => T): T {
    const start = performance.now(), result = work();
    performance.clearMeasures(name);
    performance.measure(name, { start, end: performance.now() });
    return result;
}

export class Editor {
    project = $state.raw<ProjectModel>(null!);
    tab = $state<Tab>("terrain");
    tool = $state<Tool>("select");
    geoDraft = $state<GeoDraft>();
    private penNodes = $state.raw(readPenNodes());
    private penGroup = $derived(penNodeGroup(this.geoDraft?.tool));
    penNodeMode = $derived(this.penGroup && this.penNodes[this.penGroup]);
    drawing = $derived.by(() => {
        if (this.tool === "select") return;
        const { owner, member } = this.geoDraft ?? {};
        const d = this.project.design, names = this.tool === "strip" ? this.geoDraft?.ids.map(id => geoAt(d, id).label) : undefined;
        return drawingStatus(this.tool, owner ? geoAt(d, owner).label : "", owner, member, names);
    });
    drawingReady = $derived(this.geoDraft ? drawingReady(this.geoDraft) : false);
    selection = $state.raw<Selection | null>(null);
    propertyTab = $state<PropertyTab>("general");
    private subitemStates = $state.raw(new Map<string | number, boolean>());
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
    hovered = $state.raw<Selection>();
    private hoveredPart = $state.raw<GeometryHover>();
    geometry = $state.raw<GeometryTarget>();
    objectGeometry = $state.raw<Selection>();
    private selectedPart = $state.raw<GeometrySelection>();
    private resolvedPart = $derived(this.resolvePart(this.selection, this.selectedPart));
    outline = $derived(this.resolvedPart?.role === "outline" ? this.resolvedPart.path : undefined);
    vertex = $derived(this.resolvedPart?.role === "outline" || this.resolvedPart?.role === "curve" ? undefined : this.resolvedPart);
    dragNode = $state.raw<GeoNode>();
    dragCurve = $state<number>();
    dragCommitting = $state(false);
    dragMark = $state.raw<{ id: string; point: Point }>();
    dragLabel = $state.raw<LabelPreview>();
    dragSection = $state.raw<{ id: string; points: Section["points"] }>();
    private issueStart = $state<number>();
    viewport = $state<string | null>(null);
    menu = $state.raw<{ x: number; y: number; map?: boolean; control?: GeoControl; issue?: Issue } | null>(null);
    private pointerPosition = $state.raw<Point>();
    cursor = $derived.by(() => {
        const point = this.pointerPosition, project = this.mapProject;
        if (point && project) return { point, sample: sampleField(project.terrain, this.displayField, point) };
    });
    busy = $state<string | null>(null);
    toast = $state.raw<{ text: string; point?: Point } | null>(null);
    removal = $state.raw<{ title: string; items?: RemovalItem[]; detail: string; action?: string; perform?: () => void } | null>(null);
    fileRequest = $state<FileAction | null>(null);
    filename = $state("未打开文件");
    saveState = $state<SaveState>("已保存");
    dirty = $state(false);
    canUndo = $state(false);
    canRedo = $state(false);
    history!: History;
    readonly files = new DesignFiles(this);
    map!: ProjectMap;
    panel!: HTMLElement;
    properties?: HTMLElement;
    revealProperties?: () => void;
    revealSections?: () => void;
    gesture: Gesture | null = null;
    numberEdits = $derived(numberEdits(this.project.design, this.project.resolved));
    private pendingNumber?: { source: ProjectModel; change: NumberChange };
    private numberPreview = $state.raw<{ source: ProjectModel; project: ProjectModel }>();
    private previewCache?: TerrainCache;
    mapProject = $derived.by((): ProjectView => {
        const preview = this.numberPreview;
        const project = preview?.source === this.project ? preview.project : this.project;
        return project && (this.viewport ? project.viewBelow(this.viewport) : project.view());
    });
    mapDesign = $derived.by(() => {
        const design = this.mapProject?.design, drag = this.dragSection;
        if (!design || !drag) return design;
        const sections = design.sections.map(section => section.id === drag.id ? { ...section, points: drag.points } : section);
        return { ...design, sections };
    });
    mapView = $derived.by((): MapView | null => {
        if (!this.mapProject) return null;
        const draft = this.geoDraft;
        return {
            project: { ...this.mapProject, design: this.mapDesign! }, selection: this.selection, hovered: this.hovered,
            geometry: this.geometry, objectGeometry: this.objectGeometry, vertex: this.vertex, outline: this.outline,
            hoverPart: this.resolvePart(this.hovered, this.hoveredPart),
            draft: draft && { ...draft, nodes: [...draft.nodes], ids: [...draft.ids], anchors: [...draft.anchors] },
            dragNode: this.dragNode, dragCurve: this.dragCurve, dragCommitting: this.dragCommitting, dragMark: this.dragMark, dragLabel: this.dragLabel,
            displayField: this.displayField,
            layers: { ...this.layers }, grid: { ...this.displayGrid }, referencedGeo: this.hoverRefs,
            selectedIssues: this.selectedIssues, issueStart: this.issueStart
        };
    });
    private readonly terrainCache = new TerrainCache();
    private frame = 0;
    private toastTimer?: ReturnType<typeof setTimeout>;

    attach(canvas: HTMLCanvasElement, cameraChanged: () => void) {
        this.map = new ProjectMap(canvas, cameraChanged);
    }
    dispose() {
        cancelAnimationFrame(this.frame);
        this.issueStart = undefined;
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
    private resolvePart(selection: Selection | null | undefined, part?: GeometryHover) {
        if (!part || selection?.kind !== "geoNode") return;
        const owner = geoAt(this.project.design, selection.id);
        if (owner) return resolveGeometrySelection(owner, part);
    }
    private editSelection(): EditSelection | null {
        return this.selection && (this.selectedPart && this.resolvedPart ? { ...this.selection, part: this.selectedPart } : this.selection);
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
    private restoreSelection(state: EditSelection | null) {
        this.clearControl();
        this.geometry = this.objectGeometry = undefined;
        if (!state || !this.exists(state)) {
            this.setSelection(null);
            return;
        }
        const { part, ...selection } = state;
        this.setSelection(selection);
        if (selection.kind === "geoNode" && part) this.selectPart(selection.id, part);
    }
    private clearControl() {
        this.selectedPart = undefined;
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
    private editMetadata(address: Address, value: string | undefined, group?: symbol) {
        if (readAt(this.project.design, address) === value) return;
        this.project = this.project.withPrompt(address, value);
        const selection = this.editSelection();
        this.syncHistory(this.history.record(this.project.design, { before: selection, after: selection, metadata: address, group }));
    }
    changePropertyTab(tab: PropertyTab) {
        if (tab === this.propertyTab || !propertyTabs(this.selection).some(([id]) => id === tab)) return;
        this.propertyTab = tab;
        this.hoverSelection();
        if (this.properties) this.properties.scrollTop = 0;
    }
    setSelection(selection: Selection | null) {
        this.propertyTab = tabForSelection(selection, this.propertyTab);
        this.selection = selection;
    }
    private memberGroup(owner: string, group: Exclude<SubitemGroup, "advanced">) {
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
        const open = this.subitemStates.get(this.subitemKey(owner, group, index));
        if (open !== undefined) return open;
        const construction = group === "paths" ? geoAt(this.project.design, owner)?.construction : undefined;
        return construction?.type === "free" && construction.paths.length === 1;
    }
    toggleSubitem(owner: string, group: SubitemGroup, index?: number, open = !this.subitemOpen(owner, group, index)) {
        this.subitemStates = new Map(this.subitemStates).set(this.subitemKey(owner, group, index), open);
    }
    private discardSubitem(owner: string, group: Exclude<SubitemGroup, "advanced">, index: number) {
        const next = new Map(this.subitemStates);
        next.delete(this.subitemKey(owner, group, index));
        this.memberGroup(owner, group).splice(index, 1);
        this.subitemStates = next;
    }
    private clearSubitems(owner: string, includePaths = false) {
        const next = new Map(this.subitemStates);
        next.delete(this.subitemKey(owner, "advanced"));
        for (const group of includePaths ? ["ridges", "peaks", "paths"] : ["ridges", "peaks"]) {
            const key = group + ":" + owner;
            for (const id of this.memberKeys.get(key) ?? []) next.delete(id);
            this.memberKeys.delete(key);
        }
        this.subitemStates = next;
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
            this.geometry = undefined;
            this.clearControl();
        });
    }
    select(h: Selection | null, open = true) {
        if (this.tool !== "select") this.cancelDrawing();
        this.menu = null;
        this.clearControl();
        if (this.properties && (h?.id !== this.selection?.id || h?.kind !== this.selection?.kind)) this.properties.scrollTop = 0;
        if (h?.kind !== this.selection?.kind || h?.id !== this.selection?.id) this.geometry = undefined;
        const focus = this.objectGeometry;
        if (focus && (focus.kind !== h?.kind || focus.id !== h.id || (focus.index !== undefined && focus.index !== h.index))) this.objectGeometry = undefined;
        this.setSelection(h);
        this.selectedIssues = [];
        this.issueStart = undefined;
        if (open && h) {
            if (h.kind === "geoNode") this.tab = "terrain";
            if (h.kind === "mark" || h.kind === "section") this.tab = "marks";
            if (["input", "field"].includes(h.kind)) this.tab = "inputs";
        }
    }
    reconcileProject(reset = false) {
        if (this.selectedPart && !this.resolvedPart) this.clearControl();
        if (this.selectedIssues.some(i => !this.project.issues.includes(i))) {
            this.selectedIssues = [];
            this.issueStart = undefined;
        }
        if (this.viewport && !this.project.design.geoNodes.some(n => n.id === this.viewport)) this.viewport = null;
        if (!Object.hasOwn(this.project.design.fields, this.displayField)) this.displayField = heightId;
        this.hoverSelection();
        this.map.frame(this.project.terrain, reset);
    }
    focusObjectGeometry(target: Selection) {
        this.setTool("select");
        this.select(target);
        this.objectGeometry = target;
    }
    private activateGeometry(target?: GeometryTarget) {
        this.setTool("select");
        this.geometry = target;
    }
    focusGeometry(target: GeometryTarget) {
        const h = this.selection;
        const node = h?.kind === "geoNode" ? geoAt(this.project.design, h.id) : undefined;
        const first = target.kind === "path" && node ? geometryPath(node, target.index)?.nodes[0] : undefined;
        if (first) this.selectControl({ role: target.index < 0 ? "curve" : "outline", path: target.index, index: 0, point: first.p });
        else this.activateGeometry(target);
    }
    selectControl(control: GeoControl) {
        const h = this.selection;
        if (h?.kind !== "geoNode") return;
        if (control.role === "body") {
            this.activateGeometry();
            return;
        }
        const node = geoAt(this.project.design, h.id), target = parameterTarget(control), part = geometrySelection(node, control);
        if (target) {
            this.changePropertyTab("function");
            const f = node.function;
            if (f.type === "mountain") {
                if (target.kind === "path") this.toggleSubitem(node.id, "ridges", -1 - control.path, true);
                else this.toggleSubitem(node.id, "peaks", control.path - f.ridges.length, true);
            }
            this.activateGeometry(target);
        }
        else if (part) {
            this.changePropertyTab("region");
            this.toggleSubitem(node.id, "paths", control.path, true);
            if (part.role === "outline" || this.geometry && (this.geometry.kind !== "path" || this.geometry.index !== control.path))
                this.activateGeometry({ kind: "path", index: control.path });
        }
        this.selectedPart = part;
        if (target || part) this.revealGeometry(node.id);
    }
    private revealGeometry(owner: string) {
        const { geometry, selectedPart, propertyTab } = this;
        this.revealProperties?.();
        void tick().then(() => {
            const pane = this.properties;
            if (!pane || this.geometry !== geometry || this.selectedPart !== selectedPart || this.selection?.id !== owner || this.propertyTab !== propertyTab) return;
            if (selectedPart?.role === "outline") {
                const outline = [...pane.querySelectorAll<HTMLElement>("[data-outline]")].find(row => row.dataset.outline === selectedPart.nodeId);
                outline?.querySelector(".subitem-heading")?.scrollIntoView({ block: "nearest" });
                return;
            }
            const row = selectedPart?.role === "vertex" ? pane.querySelector<HTMLElement>("[data-curve-node]") :
                selectedPart?.role === "segment" ? pane.querySelector<HTMLElement>("[data-curve-segment]") : undefined;
            const visible = row && row.offsetHeight > pane.clientHeight ? row.querySelector(".subitem-heading") : row;
            (visible ?? pane.querySelector(".geometry-box[aria-pressed=true]"))?.scrollIntoView({ block: "nearest" });
        });
    }
    toolActive(mode: Tool, owner?: string, member?: number) {
        return this.tool === mode && this.drawing?.owner === owner && this.drawing?.member === member;
    }
    choosePenNode(mode: PenNodeMode) {
        const group = this.penGroup, draft = this.geoDraft;
        if (!group || !draft || this.penNodes[group] === mode) return;
        this.penNodes = { ...this.penNodes, [group]: mode };
        savePenNodes(this.penNodes);
        updatePreview(this, draft);
    }
    setTool(mode: Tool, owner?: string, member?: number) {
        if (owner && (this.selection?.kind !== "geoNode" || this.selection.id !== owner)) this.select({ kind: "geoNode", id: owner });
        this.objectGeometry = undefined;
        this.menu = null;
        this.geoDraft = undefined;
        this.clearControl();
        this.tool = mode;
        if (mode !== "select") this.hoverSelection();
        if (drawingTools.includes(mode as DrawTool)) {
            this.geoDraft = startDrawing(this, mode as DrawTool, owner, member);
            updatePreview(this, this.geoDraft);
        }
        if (mode === "textMark" || mode === "scaleMark") this.layer("marks", true);
        if (mode === "section") this.layer("sections", true);
    }
    cancelDrawing() {
        this.setTool("select");
    }
    changeTab(tab: Tab) {
        if (this.tool !== "select") this.cancelDrawing();
        if (tab === this.tab) return;
        this.menu = null;
        this.hoverSelection();
        this.tab = tab;
        if (this.panel) this.panel.scrollTop = 0;
    }
    layer(key: Layer, value: boolean) {
        if (this.layers[key] === value) return;
        this.layers[key] = value;
        saveDisplaySettings(this.layers, this.displayGrid);
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
        return true;
    }
    private scheduleNumber() {
        this.frame ||= requestAnimationFrame(() => {
            this.frame = 0;
            const pending = this.pendingNumber;
            this.pendingNumber = undefined;
            if (pending?.source !== this.project) return;
            const { source, change } = pending;
            timed("terrain-editor:level-preview", () => {
                if (this.numberPreview?.source !== source) this.previewCache = this.terrainCache.fork();
                const design = copyAt(source.design, change.address, change.value);
                const resolved = change.resolved.reduce((d, { address, value }) => copyAt(d, address, value), source.resolved);
                this.numberPreview = { source, project: new Project(design, this.previewCache, resolved) };
            });
        });
    }
    clearNumberPreview() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.pendingNumber = this.numberPreview = undefined;
        this.previewCache = undefined;
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
    replace(design: Design, reset = false, state = reset ? null : this.editSelection()) {
        this.clearNumberPreview();
        if (reset) {
            this.terrainCache.clear();
            this.displayField = heightId; this.viewport = null;
            this.pointerPosition = undefined;
            if (this.properties) this.properties.scrollTop = 0;
            if (this.panel) this.panel.scrollTop = 0;
        }
        this.hoverRefs = []; this.geometry = undefined;
        this.project = new Project(design, this.terrainCache);
        this.selectedIssues = [];
        this.subitemStates = new Map();
        this.memberKeys.clear();
        this.restoreSelection(state);
        this.issueStart = undefined;
        this.reconcileProject(reset);
        if (reset) this.setTool("select");
    }
    previewNumber(change: NumberChange) {
        this.pendingNumber = { source: this.project, change };
        this.scheduleNumber();
    }
    commitNumber(address: Address, value: Expression) {
        this.clearNumberPreview();
        if (readAt(this.project.design, address) !== value) return this.edit(d => {
            writeAt(d, address, value);
        }, undefined, true);
    }
    navigate(forward: boolean) {
        if (this.busy || this.gesture) return;
        if (this.tool !== "select") this.cancelDrawing();
        if (!(forward ? this.canRedo : this.canUndo)) return;
        const step = this.history.editStep(forward), selected = forward ? step?.after : step?.before;
        const state = selected === undefined ? this.editSelection() : selected;
        if (step?.metadata) {
            const restored = this.history.step(forward)!;
            this.project = this.project.withPrompt(step.metadata, readAt(restored, step.metadata) as string | undefined);
            this.restoreSelection(state);
            this.syncHistory(true);
            return;
        }
        return this.terrainWork(this.history.peek(forward)!, () => {
            this.replace(this.history.step(forward)!, false, state);
            this.syncHistory(true);
        });
    }
    edit(fn: (d: Design) => Selection | null | void, after?: () => void, immediate = false) {
        if (this.busy) return;
        try {
            const before = this.editSelection(), draft = structuredClone(this.project.design), selected = fn(draft);
            const d = parseDesign(draft, true);
            const commit = () => {
                this.project = new Project(d, this.terrainCache);
                if (selected !== undefined) this.select(selected);
                after?.();
                this.reconcileProject();
                this.syncHistory(this.history.record(this.project.design, { before, after: this.editSelection() }));
            };
            if (immediate) commit();
            else return this.terrainWork(d, commit);
        }
        catch (error) {
            this.message(designErrorText(error, this.project.design));
        }
    }
    editNode(id: string, fn: (n: GeoNode) => void) {
        return this.edit(d => {
            fn(geoAt(d, id));
        });
    }
    completeDrawing() {
        if (!this.geoDraft) return;
        const draft = $state.snapshot(this.geoDraft);
        if (draft.tool === "strip" && !this.drawingReady) {
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
            const n = finishDraft(d, this.mapProject.terrain, draft);
            return { kind: "geoNode", id: n.id };
        }, () => {
            const n = geoAt(this.project.design, this.selection!.id), f = n.function;
            if (draft.tool === "ridge" && f.type === "mountain") {
                const index = draft.member ?? f.ridges.length - 1;
                this.geometry = { kind: "path", index: -1 - index };
                this.toggleSubitem(n.id, "ridges", index, true);
            }
            else if (draft.tool === "peak" && f.type === "mountain") {
                const index = draft.member ?? f.peaks.length - 1;
                this.geometry = { kind: "parameter", index: f.ridges.length + index };
                this.toggleSubitem(n.id, "peaks", index, true);
            }
            else if (draft.tool === "center" || draft.tool === "harbor") this.geometry = { kind: "parameter", index: 0 };
            else if (draft.tool === "shore" || draft.tool === "slopeLine") this.geometry = { kind: "path", index: -1 };
            else if (n.construction.type === "free") {
                const index = n.construction.paths.length - 1;
                this.geometry = { kind: "path", index };
                if (draft.tool === "addPath") this.toggleSubitem(n.id, "paths", index, true);
            }
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
            this.clearControl();
            this.geometry = type === "coast" || type === "slope" && slope === "path" ? { kind: "path", index: -1 } :
                type === "slope" ? { kind: "parameter", index: 0 } : undefined;
        });
    }
    hoverSelection(selection?: Selection, control?: GeometryPart) {
        if (selection && (this.tool !== "select" || this.gesture || this.busy)) return;
        const part = selection?.kind === "geoNode" && control ? geometryHover(geoAt(this.project.design, selection.id), control) : undefined;
        const previous = this.hoveredPart, hovered = this.hovered;
        const key = (p?: GeometryHover) => p && ("nodeId" in p ? p.nodeId : p.path);
        if (part?.role !== previous?.role || key(part) !== key(previous)) this.hoveredPart = part;
        if (selection?.kind !== hovered?.kind || selection?.id !== hovered?.id ||
            selection?.role !== hovered?.role || selection?.index !== hovered?.index) this.hovered = selection;
    }
    hover(ids: string[]) {
        this.hoverRefs = ids;
    }
    showField(field: string) {
        this.displayField = field;
    }
    showThrough(id: string | null) {
        if (this.tool !== "select") this.cancelDrawing();
        this.viewport = id; this.issueStart = undefined; this.reconcileProject();
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
    openMenu(h: Selection, x: number, y: number, map = false, hit?: GeoControl) {
        this.select(h);
        const control = controlOwner(hit);
        if (control) this.selectControl(control);
        this.menu = { x, y, map, control };
    }
    openIssueMenu(issue: Issue, x: number, y: number) {
        this.menu = { x, y, issue };
    }
    private selectPart(id: string, part: GeometrySelection) {
        const selection = { kind: "geoNode", id } as const;
        const control = this.resolvePart(selection, part);
        if (!control) return;
        if (this.selection?.kind !== "geoNode" || this.selection.id !== id) this.select(selection);
        this.selectControl(control);
    }
    stepCurvePart(direction: -1 | 1) {
        const control = this.vertex, selection = this.selection;
        if (selection?.kind !== "geoNode" || control?.role !== "vertex" && control?.role !== "segment") return;
        const curve = geometryPath(geoAt(this.project.design, selection.id), control.path);
        const step = control.role === "segment" ? segmentNeighbor : neighbor;
        const index = curve && step(curve, control.index, direction);
        if (curve && index !== undefined) this.selectControl({ ...control, index, point: curve.nodes[index].p });
    }
    readPosition(point?: Point) {
        this.pointerPosition = point;
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
                const n = geoAt(this.project.design, slot.id), nodes = slot.path.indexOf("nodes");
                if (nodes >= 0) {
                    const path = group === "ridges" ? -1 - Number(slot.path[4]) : -1, index = Number(slot.path[nodes + 1]);
                    const vertex = geometryPath(n, path)?.nodes[index];
                    if (vertex) this.selectControl({ role: "vertex", path, index, point: vertex.p });
                }
                else if (group === "peaks" && n.function.type === "mountain" && slot.path[5] === "at") {
                    const index = Number(slot.path[4]);
                    this.selectControl({ role: "parameter", path: n.function.ridges.length + index, index: 0, point: n.function.peaks[index].at.p });
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
            this.edit(draft => {
                const construction = geoAt(draft, id).construction;
                if (construction.type === "free") construction.paths.splice(index, 1);
            }, () => {
                this.discardSubitem(id, "paths", index);
                if (this.selection?.id !== id || this.geometry?.kind !== "path" || this.geometry.index < index) return;
                this.geometry = this.geometry.index === index ? undefined : { kind: "path", index: this.geometry.index - 1 };
            });
        };
        this.removal = { title: "删除这条轮廓？", detail: affected.length ? "以下条带将找不到范围节点。" : "",
            items: affected.map(v => this.geoReference(v.id, v.label, "边", "region")), action: "删除轮廓", perform };
    }
    removeGeo(id: string, vertex?: GeoControl) {
        const d = this.project.design, n = geoAt(d, id);
        if (vertex?.role === "parameter") {
            this.edit(d => {
                removeParameterPoint(d, geoAt(d, id), vertex);
            }, () => {
                this.clearControl();
                if (n.function.type === "mountain" && vertex.path >= n.function.ridges.length) {
                    this.discardSubitem(id, "peaks", vertex.path - n.function.ridges.length);
                    this.geometry = undefined;
                }
            });
            return;
        }
        if (vertex?.role === "vertex" || vertex?.role === "segment") {
            const path = geometryPath(n, vertex.path), segment = vertex.role === "segment";
            if (!path || !canRemoveNode(path)) return;
            const index = segment ? segmentRemovalIndex(path, vertex.index) : vertex.index;
            if (index === undefined || !path.nodes[index]) return;
            const refs = vertex.path < 0 ? [] : rangeUsers(d, id, [path.nodes[index].id]);
            const perform = () => {
                let next: CurveNode | undefined;
                return this.edit(draft => {
                    const owner = geoAt(draft, id);
                    if (segment) next = removeCurveSegment(draft, owner, vertex);
                    else removeCurveNode(draft, owner, vertex);
                }, () => {
                    if (next) this.selectPart(id, { role: "vertex", nodeId: next.id });
                });
            };
            const action = segment ? "删除线段" : "删除节点";
            if (refs.length) this.removal = { title: action + "？", detail: "以下条带的范围将报告找不到节点。",
                action, items: refs.map(r => this.geoReference(r.id, r.label, "边", "region")), perform };
            else perform();
            return;
        }
        const items = removalUses(d, "geo", id).map(use => this.removalItem(use));
        if (isLastInitializer(d, id)) return this.blockRemoval(n.label, items, requiredInitializer + "。");
        if (items.length) return this.blockRemoval(n.label, items);
        this.edit(d => {
            deleteGeo(d, id);
            if (this.selection?.kind === "geoNode" && this.selection.id === id) return null;
        }, () => this.clearSubitems(id, true));
    }
    setCurveClosed(id: string, index: number, closed: boolean) {
        return this.editNode(id, n => {
            const path = geometryPath(n, index);
            if (!path || index >= 0 || n.function.type === "coast" || closed && path.nodes.length < 3) return;
            path.closed = closed;
            cleanHandles(path);
        });
    }
    pathNodeMode(control: GeoControl, mode: CurveNode["mode"]) {
        const id = this.selection?.id;
        if (id) this.editNode(id, n => setNodeMode(geometryPath(n, control.path)!, control.index, mode));
    }
    segment(control: GeoControl, type: SegmentType | "tangent") {
        const id = this.selection?.id;
        if (id) this.editNode(id, n => setSegment(geometryPath(n, control.path)!, control.index, type));
    }
    wholeCurve(control: GeoControl, action: "auto" | "line") {
        if (this.selection?.kind !== "geoNode") return;
        const id = this.selection.id, curve = geometryPath(geoAt(this.project.design, id), control.path);
        if (!curve) return;
        const next = structuredClone(curve);
        if (editWholeCurve(next, action)) return this.editNode(id, n => geometryPath(n, control.path)!.nodes = next.nodes);
    }
    insertNode(id: string, control: GeoControl) {
        let node: CurveNode | undefined;
        return this.edit(d => {
            node = insertCurveNode(d, geoAt(d, id), control);
        }, () => {
            if (node) this.selectPart(id, { role: "vertex", nodeId: node.id });
        });
    }
    moveLabel(target: LabelTarget, offset: Point) {
        return this.edit(d => {
            const item = target.kind === "geoNode" ? geoAt(d, target.id) : d.sections.find(section => section.id === target.id)!;
            if (offset[0] || offset[1]) item.labelOffset = offset;
            else delete item.labelOffset;
            return target;
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
            this.map.revealBounds(bounds(this.project.design.sections.find(section => section.id === id)!.points));
            this.revealSections?.();
        }
    }
    showInView({ kind, id }: Selection) {
        const offsets: Box = [-5, -5, 5, 5];
        if (kind === "geoNode") {
            const box = this.project.terrain.regions.get(id)?.shape.box;
            if (box) this.map.revealBounds(box, offsets);
        }
        else if (kind === "section") {
            const section = this.project.design.sections.find(s => s.id === id)!;
            this.map.revealBounds(bounds(section.points), offsets);
        }
        else if (kind === "mark") {
            const mark = this.project.resolved.marks.find(m => m.id === id)!;
            if (mark.follow === "map") this.map.revealMark(mark);
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
    private selectIssues(issues: Issue[]) {
        const [issue] = issues;
        if (!issue) return;
        if (this.tool !== "select") this.cancelDrawing();
        this.layer("issues", true);
        if (!objectIssues(this.project, this.selection).includes(issue))
            this.select(issue.geoNode ? { kind: "geoNode", id: issue.geoNode } : null, false);
        this.selectedIssues = issues;
        this.issueStart = performance.now();
        this.scrollToIssues(issues);
    }
    issueAt(issue: Issue) {
        this.selectIssues([issue]);
        this.map.revealBounds([...issue.point, ...issue.point]);
    }
    pickMarkers(hits: Issue[]) {
        this.changeTab("issues");
        this.selectIssues(hits);
    }
    addMark(kind: Mark["kind"], point: Point) {
        return this.edit(d => {
            const id = nextId(d.marks.map(m => m.id), "mark-");
            const follow = defaultFollow(kind);
            const mark: Mark<number> = kind === "scale" ? { id, kind, label: "比例尺", point, follow }
                : { id, kind, label: "文字标记 " + id.slice(5), point, follow };
            const [x, y] = follow === "screen" ? this.map.visibleMarkPoint(mark) : point;
            const p: Point = [+x.toFixed(2), +y.toFixed(2)];
            d.marks.push({ ...mark, point: p, ...(mark.kind === "scale" && { length: markParameters.scale.default }) });
            return { kind: "mark", id };
        });
    }
    setMarkFollow(id: string, follow: Mark["follow"]) {
        return this.edit(d => {
            const mark = d.marks.find(m => m.id === id)!;
            if (mark.follow === follow) return;
            const resolved = this.project.resolved.marks.find(m => m.id === id)!;
            const point = this.map.markCoordinate(this.map.visibleMarkPoint(resolved), follow);
            mark.point = follow === "screen" ? this.map.visibleMarkPoint({ ...resolved, follow, point }) : point;
            mark.follow = follow;
        });
    }
    copyMark(id: string) {
        return this.edit(d => {
            const copy = structuredClone(d.marks.find(m => m.id === id)!);
            copy.id = nextId(d.marks.map(m => m.id), "mark-");
            copy.label += " 副本";
            if (copy.follow === "screen") {
                const mark = this.project.resolved.marks.find(m => m.id === id)!;
                copy.point = this.map.visibleMarkPoint({ ...mark, label: copy.label });
            }
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
        if (h.kind === "geoNode" && this.outline !== undefined) this.removePath(h.id, this.outline);
        else if (h.kind === "geoNode" && this.vertex) this.removeGeo(h.id, this.vertex);
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
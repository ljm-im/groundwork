import { tick } from "svelte";
import { type ProjectView } from "../../core/project.ts";
import { TerrainClient, type ProjectModel } from "./terrainClient.ts";
import { History, type EditSelection } from "../../core/edit/history.ts";
import { copyAt, readAt, writeAt, type Address } from "../../core/design/address.ts";
import { readDisplaySettings, saveDisplaySettings } from "./layers.ts";
import { type GridDisplay } from "../../core/edit/display.ts";
import { bounds, type Box } from "../../core/math/geometry.ts";
import { heightId, isBuiltin } from "../../core/design/defaults.ts";
import { defaultFollow, type Curve, type GeoNode, type GeoFunction, type PlacedGeoNode, type CurveNode, type NodeQuantity, type Section, type CurveGeometry } from "../../core/design/v5.ts";
import { geoParameter, slotName, type Slot } from "../../core/design/parameters.ts";
import { numberEdits, type NumberChange } from "../../core/design/numberEdit.ts";
import { curveGraph, curveKey, curveSlotName, geometryAt, geometryIndex, geometrySlot, geometryUsers, isHolderRef, memberLabel, offsetPoint, profileGroupForTool, profileIndex, type CurveSlot, type FunctionMember, type ProfileGroup } from "../../core/design/curveReferences.ts";
import { curveNodeUsers, editCurve, setCurveOverride, setCurveReference } from "../../core/edit/curveEdits.ts";
import { type ControlPreview, type GeoControl, type GeometryHover, type GeometryPart, type GeometrySelection, type GeometryTarget, controlOwner, copyGeometryItem, curveMember,
    geometryHover, geometryItemCurveUses, geometryPath, geometrySelection, insertCurveNode, parameterPoints, parameterTarget, removeCurveNode, removeCurveSegment, removeGeometryItem,
    removeParameterPoint, resolveGeometrySelection } from "../../core/edit/geoControls.ts";
import { addInput, addField, copyGeo, copyGeometry, copyHeldGeometry, defaultFunction, deleteGeo, enableGeo, holdPoint, isLastInitializer, nextId, nodeIds, rangeUsers, removeUnusedGeometry,
    parameterRemovalUses, removalUses, removeDeclaration, requiredInitializer, setGeometryIndependent, type RemovalUse } from "../../core/edit/geoNodes.ts";
import { movePointGeometry } from "../../core/edit/controls.ts";
import { canRemoveNode, cleanHandles, editWholeCurve, isEndpoint, retractHandle, segmentRemovalIndex, setNodeMode, setSegment } from "../../core/edit/paths.ts";
import { drawingReady, drawingTools, finishCurveDraft, finishDraft, geoAt, startCurveDrawing, startDrawing, updatePreview } from "./geoTools.ts";
import { type DrawTool, type GeoDraft } from "../../core/edit/types.ts";
import { markParameters } from "../../core/design/functionTable.ts";
import { revealInPanel } from "./layout.ts";
import { type SnapGuide } from "../../core/edit/snapping.ts";
import { functionGeometry } from "../../core/edit/functionGeometry.ts";
import { bulgeFromDegrees, neighbor, segmentNeighbor, type SegmentType } from "../../core/design/path.ts";
import { sampleField } from "../../core/design/results.ts";
import { designErrorText } from "./designMessages.ts";
import { DesignError, quotedLocation } from "../../core/design/problems.ts";
import { drawingStatus } from "./mapText.ts";
import { numberPreviewFactor } from "./numbers.ts";
import { contextMenuPoint } from "./popup.ts";
import { penNodeGroup, readPenNodes, savePenNodes, type PenNodeMode } from "./penNodes.ts";
import { objectIssues } from "../../core/checks/issues.ts";
import { propertyTabs, tabForSelection, type PropertyTab, type SubitemGroup } from "./inspector.ts";
import { ProjectMap, type LabelPreview, type LabelTarget, type MapView } from "../../render/map.ts";
import { DesignFiles, type FileAction, type SaveState } from "./files.ts";
import { errorText, type Design, type Expression, type Gesture, type Issue, type Layer, type Mark, type Point, type Selection, type Tab, type Tool } from "../types.ts";

const unavailableParameters = "切换后不再使用的参数仍被引用，请先修改以下引用位置。";
const deletionTitle = (name: string) => "无法删除“" + name + "”";
function nextSectionId(d: Design) {
    const ids = new Set(d.sections.map(section => section.id));
    return [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find(id => !ids.has(id)) ?? nextId(ids, "S");
}

interface HolderGeometry { id: string; target?: GeometryTarget; index?: number }

type RemovalItem = { text: string; locate: () => void };
export type DescriptionTarget = { group: "design" } | { group: "geoNodes" | "sections"; id: string };

export async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
        return await work();
    }
    finally {
        performance.clearMeasures(name);
        performance.measure(name, { start, end: performance.now() });
    }
}

export class Editor {
    project = $state.raw<ProjectModel>(null!);
    tab = $state<Tab>("terrain");
    tool = $state<Tool>("select");
    geoDraft = $state<GeoDraft>();
    private penNodes = $state.raw(readPenNodes());
    private penGroup = $derived(this.geoDraft?.curve?.pen ?? penNodeGroup(this.geoDraft?.tool));
    penNodeMode = $derived(this.penGroup && this.penNodes[this.penGroup]);
    drawing = $derived.by(() => {
        if (this.tool === "select") return;
        const { owner, member } = this.geoDraft ?? {};
        const d = this.project.design, names = this.tool === "strip" ? this.geoDraft?.ids.map(id => geoAt(d, id).label) : undefined;
        return drawingStatus(this.tool, this.geoDraft?.curve?.name ?? (owner ? geoAt(d, owner).label : ""), owner, member, names, this.geoDraft?.curve);
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
    holderGeometry = $state.raw<HolderGeometry>();
    geometryPage = $derived.by(() => {
        const focus = this.holderGeometry, id = focus?.id ?? (this.selection?.kind === "geometry" ? this.selection.id : undefined);
        const item = id !== undefined && geometryAt(this.project.design, id);
        if (id !== undefined && item) return { id, item, target: focus?.target, index: focus?.index };
    });
    geometryUses = $derived(geometryUsers(this.project.design));
    private hoveredCurveReference = $state<string>();
    private referenceCurves = $derived.by(() => {
        const key = this.hoveredCurveReference;
        if (!key) return [];
        const graph = this.curves, holder = graph.holders.get(key);
        if (holder) return [graph.materialize(graph.ofHolder(holder))];
        const slot = graph.slots.get(key);
        if (!slot || slot.holder) return [];
        const places = graph.curvePlacements(slot.id);
        return places.length ? places.map(place => graph.materialize(graph.ofHolder(place))) : [slot.value];
    });
    private selectedPart = $state.raw<GeometrySelection>();
    private resolvedPart = $derived(this.resolvePart(this.selection, this.selectedPart));
    outline = $derived(this.resolvedPart?.role === "outline" ? this.resolvedPart.path : undefined);
    vertex = $derived(this.resolvedPart?.role === "outline" || this.resolvedPart?.role === "curve" ? undefined : this.resolvedPart);
    dragPreview = $state.raw<ControlPreview>();
    dragNode = $derived(this.selection?.kind === "geoNode" ? this.dragPreview?.nodes.get(this.selection.id)?.node : undefined);
    dragGeometry = $derived(this.dragPreview?.geometry);
    dragCurve = $state<number>();
    snapGuides = $state.raw<readonly SnapGuide[]>();
    dragCommitting = $state(false);
    dragMark = $state.raw<{ id: string; point: Point }>();
    dragLabel = $state.raw<LabelPreview>();
    dragSection = $state.raw<{ id: string; points: Section<"resolved">["points"] }>();
    private issueStart = $state<number>();
    viewport = $state<string | null>(null);
    menu = $state.raw<(ReturnType<typeof contextMenuPoint> & { map?: boolean; control?: GeoControl; issue?: Issue }) | null>(null);
    private pointerPosition = $state.raw<Point>();
    cursor = $derived.by(() => {
        const point = this.pointerPosition, project = this.mapProject;
        if (point && project) return { point, sample: sampleField(project.terrain, this.displayField, point) };
    });
    busy = $state(false);
    busyText = $state<string | null>(null);
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
    curves = $derived(curveGraph(this.project.design));
    numberEdits = $derived(numberEdits(this.project.design, this.project.resolved));
    private pendingNumber?: { source: ProjectModel; change: NumberChange; version: number };
    private numberVersion = 0;
    private previewRunning = false;
    private numberPreview = $state.raw<{ source: ProjectModel; project: ProjectModel; step?: number }>();
    numberPreviewStep = $derived(this.numberPreview?.source.id === this.project?.id ? this.numberPreview?.step : undefined);
    private displayProject = $derived(this.numberPreview?.source.id === this.project?.id ? this.numberPreview?.project ?? this.project : this.project);
    private belowView = $state.raw<{ source: number; through: string | null; view: ProjectView }>();
    private pendingView?: { source: number; through: string };
    mapCurrent = $derived(!this.viewport || !this.belowView || this.belowView.source === this.displayProject?.id);
    private readonly readings = new WeakMap<ProjectModel["terrain"], Map<string, { value?: number }>>();
    private readingVersion = $state(0);

    mapProject = $derived.by((): ProjectView => {
        const project = this.displayProject, view = this.belowView;
        if (!project || !this.viewport || !view) return project?.view();
        if (view.source !== project.id || view.through !== this.viewport) return view.view;
        const design = project.resolved;
        return { ...view.view, design: { ...design, geoNodes: design.geoNodes.slice(0, design.geoNodes.findIndex(n => n.id === this.viewport)) } };
    });
    mapDesign = $derived.by(() => {
        const design = this.mapProject?.design, drag = this.dragSection, preview = this.dragPreview?.point;
        if (!design || !drag && !preview) return design;
        const authored = this.project.design;
        const sections = design.sections.map(section => {
            if (preview) {
                const holders = authored.sections.find(s => s.id === section.id)!.points;
                if (holders.some(holder => holder.point === preview.id))
                    return { ...section, points: holders.map((holder, i) => holder.point === preview.id ?
                        offsetPoint(preview.point, holder.offset ?? [0, 0]) : section.points[i]) as typeof section.points };
            }
            return section.id === drag?.id ? { ...section, points: drag.points } : section;
        });
        if (!preview) return { ...design, sections };
        const marks = design.marks.map((mark, i) => {
            const holder = authored.marks[i].point;
            return mark.follow === "map" && holder.point === preview.id ?
                { ...mark, point: offsetPoint(preview.point, holder.offset ?? [0, 0]) } : mark;
        });
        return { ...design, sections, marks };
    });
    mapView = $derived.by((): MapView | null => {
        if (!this.mapProject) return null;
        const draft = this.geoDraft;
        return {
            project: { ...this.mapProject, design: this.mapDesign! }, selection: this.selection, hovered: this.hovered,
            geometry: this.geometry, objectGeometry: this.objectGeometry, holderGeometry: this.holderGeometry, vertex: this.vertex, outline: this.outline,
            hoverPart: this.resolvePart(this.hovered, this.hoveredPart),
            draft: draft && { ...draft, nodes: [...draft.nodes], ids: [...draft.ids], anchors: [...draft.anchors] },
            dragNode: this.dragNode, dragGeometry: this.dragGeometry, dragNodes: this.dragPreview?.nodes, dragCurve: this.dragCurve,
            snapGuides: this.snapGuides, dragCommitting: this.dragCommitting, dragMark: this.dragMark, dragLabel: this.dragLabel,
            displayField: this.displayField,
            layers: { ...this.layers }, grid: { ...this.displayGrid }, referencedGeo: this.hoverRefs,
            selectedIssues: this.selectedIssues, issueStart: this.issueStart, referenceCurves: this.referenceCurves
        };
    });
    private readonly compute: TerrainClient;
    private activeWork?: Promise<void>;
    private pendingDesign?: Design | string;
    private wrotePendingDraft = false;
    private frame = 0;
    private toastTimer?: ReturnType<typeof setTimeout>;

    constructor(compute = new TerrainClient()) {
        this.compute = compute;
    }

    attach(canvas: HTMLCanvasElement, cameraChanged: () => void) {
        this.map = new ProjectMap(canvas, cameraChanged);
    }
    dispose() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.compute.close();
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
    geometryOwner(selection: Selection | null | undefined): PlacedGeoNode | CurveGeometry | undefined {
        const d = this.project.resolved;
        if (selection?.kind === "geoNode") return geoAt(d, selection.id);
        if (selection?.kind === "geometry") {
            const item = geometryAt(d, selection.id);
            if (item && "curve" in item) return item;
        }
    }
    private resolvePart(selection: Selection | null | undefined, part?: GeometryHover) {
        const owner = part && this.geometryOwner(selection);
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
            case "geometry": return Object.hasOwn(d.geometry, h.id);
        }
    }
    private restoreSelection(state: EditSelection | null) {
        this.clearControl();
        this.holderGeometry = this.geometry = this.objectGeometry = undefined;
        if (!state || !this.exists(state)) {
            this.setSelection(null);
            return;
        }
        const { part, ...selection } = state;
        this.setSelection(selection);
        if (part) this.selectPart(selection, part);
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
        if (this.busy || readAt(this.project.design, address) === value) return;
        this.project = this.project.withPrompt(address, value);
        const selection = this.editSelection();
        this.syncHistory(this.history.record(this.project.design, { before: selection, after: selection, metadata: address, group }));
    }
    changePropertyTab(tab: PropertyTab, keepGeometry = false) {
        if (!propertyTabs(this.selection).some(([id]) => id === tab)) return;
        const back = !keepGeometry && !!this.holderGeometry;
        if (back) this.holderGeometry = undefined;
        if (!back && tab === this.propertyTab) return;
        this.propertyTab = tab;
        this.hoverSelection();
        if (this.properties) this.properties.scrollTop = 0;
        if (back && this.selection) this.revealGeometry(this.selection.id);
    }
    setSelection(selection: Selection | null) {
        if (selection?.id !== this.selection?.id || selection?.kind !== this.selection?.kind) this.holderGeometry = undefined;
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
        const construction = group === "outlines" ? geoAt(this.project.design, owner)?.construction : undefined;
        return construction?.type === "outline" && construction.outlines.length === 1;
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
    private clearSubitems(owner: string, includeOutlines = false) {
        const next = new Map(this.subitemStates);
        next.delete(this.subitemKey(owner, "advanced"));
        for (const group of includeOutlines ? ["ridges", "valleys", "lines", "peaks", "outlines"] : ["ridges", "valleys", "lines", "peaks"]) {
            const key = group + ":" + owner;
            for (const id of this.memberKeys.get(key) ?? []) next.delete(id);
            this.memberKeys.delete(key);
        }
        this.subitemStates = next;
    }
    changeMember(owner: string, group: FunctionMember, index: number, copy: boolean) {
        const d = this.project.design, path: [typeof group] = [group];
        if (!copy) {
            const uses = geometryItemCurveUses(d, owner, path, index);
            const label = memberLabel(group) + " " + (index + 1);
            if (uses.length) return this.blockRemoval(deletionTitle(label), uses.map(use => this.removalItem(use)));
        }
        return this.edit(d => {
            const change = copy ? copyGeometryItem : removeGeometryItem;
            change(d, geoAt(d, owner), path, index);
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
        if (focus && (focus.kind !== h?.kind || focus.id !== h.id || focus.index !== undefined && focus.index !== h.index)) {
            this.objectGeometry = undefined;
            if (!this.holderGeometry?.target) this.holderGeometry = undefined;
        }
        this.setSelection(h);
        this.selectedIssues = [];
        this.issueStart = undefined;
        if (open && h) {
            if (h.kind === "geoNode") this.tab = "terrain";
            if (h.kind === "mark" || h.kind === "section") this.tab = "marks";
            if (["input", "field", "geometry"].includes(h.kind)) this.tab = "inputs";
        }
    }
    reconcileProject(reset = false) {
        this.hoveredCurveReference = undefined;
        if (this.holderGeometry && !this.geometryPage) this.holderGeometry = undefined;
        if (this.selectedPart && !this.resolvedPart) this.clearControl();
        if (this.selectedIssues.some(i => !this.project.issues.includes(i))) {
            this.selectedIssues = [];
            this.issueStart = undefined;
        }
        if (this.viewport && !this.project.design.geoNodes.some(n => n.id === this.viewport)) this.viewport = null;
        if (!Object.hasOwn(this.project.design.fields, this.displayField)) this.displayField = heightId;
        this.hoverSelection();
        this.map.frame(this.project.terrain, reset);
        this.refreshViewport();
    }
    focusObjectGeometry(target: Selection) {
        this.setTool("select");
        this.select(target);
        this.objectGeometry = target;
    }
    openCurve(slot: CurveSlot) {
        const index = geometryIndex(slot), target = { kind: index < 0 ? "curve" : "outline", index } as const;
        this.focusGeometry(target);
        if (slot.holder && !isHolderRef(slot.holder.value))
            this.holderGeometry = { id: slot.holder.value.curve, target };
    }
    openPoint(id: string, target?: GeometryTarget, index?: number) {
        if (target) this.focusGeometry(target);
        else if (this.selection) this.focusObjectGeometry({ ...this.selection, index });
        this.holderGeometry = { id, target, index };
    }
    redrawGeometry(id: string) {
        const target = this.holderGeometry?.target, selection = this.selection;
        const slot = target && selection ? geometrySlot(this.project.design, selection.id, target.index) : undefined;
        this.drawCurve(slot?.key ?? curveKey(id), undefined, true);
    }
    duplicateGeometry(id: string) {
        return this.edit(d => ({ kind: "geometry", id: copyGeometry(d, id, true) }), () => this.focusNewDeclaration());
    }
    setGeometryIndependent(id: string, independent: boolean) {
        return this.edit(d => {
            setGeometryIndependent(d, id, independent);
            if (!independent && this.selection?.kind === "geometry" && this.selection.id === id && !this.geometryUses.has(id)) return null;
        });
    }
    addGeometry(tool: "geometryPoint" | "geometryCurve" | "geometryClosed") {
        this.setTool(tool);
        this.map.canvas.focus({ preventScroll: true });
    }
    hoverCurveReference(key?: string) {
        this.hoveredCurveReference = key;
    }
    private activateGeometry(target?: GeometryTarget) {
        this.setTool("select");
        this.geometry = target;
    }
    focusGeometry(target: GeometryTarget) {
        const h = this.selection;
        const node = this.geometryOwner(h);
        const first = target.kind !== "parameter" && node ? geometryPath(node, target.index)?.nodes[0] : undefined;
        if (first) this.selectControl({ role: target.index < 0 ? "curve" : "outline", path: target.index, index: 0, point: first.p });
        else this.activateGeometry(target);
    }
    selectControl(hit: GeoControl) {
        const control = controlOwner(hit)!;
        const h = this.selection;
        if (h?.kind === "geometry") {
            const owner = this.geometryOwner(h);
            if (owner) {
                this.activateGeometry({ kind: "curve", index: -1 });
                this.selectedPart = geometrySelection(owner, control);
                this.revealGeometry(h.id);
            }
            return;
        }
        if (h?.kind !== "geoNode") return;
        if (control.role === "body") {
            this.holderGeometry = undefined;
            this.activateGeometry();
            return;
        }
        const node = geoAt(this.project.resolved, h.id), target = parameterTarget(control), part = geometrySelection(node, control);
        const focus = this.holderGeometry?.target;
        const keep = !!focus && focus.index === control.path && (focus.kind === "parameter") === (control.role === "parameter");
        if (target) {
            this.changePropertyTab("function", keep);
            const f = node.function;
            const member = target.kind === "curve" ? curveMember(f, control.path) : undefined;
            if (member) this.toggleSubitem(node.id, member.group, member.index, true);
            else if (f.type === "mountain" && target.kind === "parameter") this.toggleSubitem(node.id, "peaks", control.path - f.ridges.length, true);
            this.activateGeometry(target);
        }
        else if (part) {
            this.changePropertyTab("region", keep);
            this.toggleSubitem(node.id, "outlines", control.path, true);
            if (part.role === "outline" || this.geometry && (this.geometry.kind !== "outline" || this.geometry.index !== control.path))
                this.activateGeometry({ kind: "outline", index: control.path });
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
                revealInPanel(pane, outline?.querySelector(".subitem-heading"));
                return;
            }
            const row = selectedPart?.role === "vertex" ? pane.querySelector<HTMLElement>("[data-curve-node]") :
                selectedPart?.role === "segment" ? pane.querySelector<HTMLElement>("[data-curve-segment]") : undefined;
            const visible = row && row.offsetHeight > pane.clientHeight ? row.querySelector(".subitem-heading") : row;
            revealInPanel(pane, visible ?? pane.querySelector(".geometry-box[aria-pressed=true]"));
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
        if (mode !== "select") this.objectGeometry = undefined;
        this.menu = null;
        this.geoDraft = undefined;
        this.snapGuides = undefined;
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
    curveToolActive(key: string) {
        return this.geoDraft?.tool === "redrawCurve" && this.geoDraft.curve?.key === key;
    }
    drawCurve(key: string, endpoint?: number, geometryPage = !!this.holderGeometry) {
        const slot = this.curves.slots.get(key);
        if (!slot) return;
        const mode = endpoint === undefined ? "redrawCurve" : "continueCurve";
        if (endpoint !== undefined && !isEndpoint(this.curves.source(slot).curve, endpoint)) return;
        const part = this.selectedPart;
        this.setTool(mode);
        if (mode === "continueCurve") this.selectedPart = part;
        this.geoDraft = startCurveDrawing(this, mode, key, endpoint, geometryPage);
        updatePreview(this, this.geoDraft);
        this.map.canvas.focus({ preventScroll: true });
    }
    continueCurve(control: GeoControl) {
        const h = this.selection, slot = h && geometrySlot(this.project.design, h.id, control.path, h.kind === "geometry");
        if (slot) this.drawCurve(slot.key, control.index);
    }
    changeCurveReference(slot: CurveSlot, target?: string) {
        return this.edit(d => {
            setCurveReference(d, slot.key, target);
        },
        () => this.focusGeometry({ kind: slot.closed && geometryIndex(slot) >= 0 ? "outline" : "curve", index: geometryIndex(slot) }));
    }
    cancelDrawing() {
        const part = this.geoDraft?.tool === "continueCurve" ? this.selectedPart : undefined;
        this.setTool("select");
        this.selectedPart = part;
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
    private refreshViewport() {
        const through = this.viewport, project = this.displayProject;
        if (!through || !project) {
            this.pendingView = this.belowView = undefined;
            return;
        }
        const source = project.id;
        if (this.pendingView?.source === source && this.pendingView.through === through) return;
        if (!this.belowView) this.belowView = { source, through: null, view: project.view() };
        const request = this.pendingView = { source, through };
        void project.viewBelow(through).then(view => {
            if (view && this.pendingView === request) this.belowView = { source, through, view };
        }).catch(error => {
            if (this.pendingView === request) this.message(errorText(error));
        });
    }
    fieldReading(owner: string, field: string) {
        const project = this.project;
        // This read subscribes every numeric expression to completed samples.
        void this.readingVersion;
        let readings = this.readings.get(project.terrain);
        if (!readings) this.readings.set(project.terrain, readings = new Map());
        const key = JSON.stringify([owner, field]), cached = readings.get(key);
        if (cached) return cached.value;
        const reading: { value?: number } = {};
        readings.set(key, reading);
        void project.inputAt(owner, field).then(value => {
            if (this.project.id !== project.id) return;
            reading.value = value;
            this.readingVersion++;
        }).catch(error => {
            if (this.project.id === project.id) this.message(errorText(error));
        });
    }
    private scheduleNumber() {
        if (this.frame || this.previewRunning || !this.pendingNumber) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            const pending = this.pendingNumber;
            this.pendingNumber = undefined;
            if (pending?.source.id !== this.project.id) return;
            this.previewRunning = true;
            void this.previewChange(pending).finally(() => {
                this.previewRunning = false;
                this.scheduleNumber();
            });
        });
    }
    private async previewChange({ source, change, version }: NonNullable<Editor["pendingNumber"]>) {
        try {
            let design = copyAt(source.design, change.address, change.value);
            let resolved = change.resolved.reduce((d, { address, value }) => copyAt(d, address, value), source.resolved);
            const grid = source.terrain.grid, step = design.grid.step;
            // A grid-spacing gesture also changes the dimensions before coarsening.
            const width = step === grid.step ? grid.width : Math.ceil(grid.xMax / step) - Math.floor(grid.xMin / step);
            const height = step === grid.step ? grid.height : Math.ceil(grid.yMax / step) - Math.floor(grid.yMin / step);
            if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return;
            const factor = numberPreviewFactor(width, height), coarse = factor !== 1;
            if (coarse) {
                const previewGrid = { step: step * factor };
                design = { ...design, grid: previewGrid };
                resolved = { ...resolved, grid: previewGrid };
            }
            const project = await timed("terrain-editor:level-preview", () => this.compute.preview(source.id, design, resolved, coarse));
            if (!project) return;
            if (version !== this.numberVersion || source.id !== this.project.id) return this.compute.release(project.id);
            const previous = this.numberPreview;
            this.numberPreview = { source, project, step: coarse ? design.grid.step : undefined };
            this.refreshViewport();
            if (previous) this.compute.release(previous.project.id);
        }
        catch (error) {
            if (version === this.numberVersion && source.id === this.project.id) this.message(errorText(error));
        }
    }
    clearNumberPreview(keepView = false) {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.numberVersion++;
        this.pendingNumber = undefined;
        if (!keepView && this.numberPreview) {
            this.compute.release(this.numberPreview.project.id);
            this.numberPreview = undefined;
            this.refreshViewport();
        }
        this.compute.clearPreviews();
    }
    working(label: string | null, fn: () => void | Promise<void>, report = (error: unknown) => {
        this.message(errorText(error));
        console.error(error);
    }) {
        if (this.busy) return;
        this.busy = true;
        this.busyText = label;
        const work = (async () => {
            try {
                await fn();
            }
            catch (error) {
                report(error);
            }
            finally {
                this.busy = false;
                this.busyText = null;
                this.activeWork = this.pendingDesign = undefined;
                if (this.wrotePendingDraft) {
                    this.wrotePendingDraft = false;
                    this.files.remember();
                }
            }
        })();
        if (this.busy) this.activeWork = work;
        return work;
    }
    finishWork() {
        return this.activeWork;
    }
    workPending() {
        return this.busy || !!this.frame || this.previewRunning || this.compute.hasPendingRequests();
    }
    rememberPendingEdit() {
        if (this.pendingDesign === undefined) return;
        this.files.remember(this.pendingDesign);
        this.wrotePendingDraft = true;
    }
    private generate(design: Design | string, reset = false, immediate = false) {
        return this.compute.generate(design, reset, missing => {
            if (immediate) return;
            this.busyText = missing === "base" ? "正在生成地形…" : missing === "natural" ? "正在更新地件…" : null;
        });
    }
    async replace(design: Design | string, reset = false, state = reset ? null : this.editSelection()) {
        const ownsBusy = !this.busy;
        if (ownsBusy) this.busy = true;
        try {
            const project = await this.generate(design, reset);
            if (reset) {
                this.displayField = heightId; this.viewport = null;
                this.pointerPosition = undefined;
                if (this.properties) this.properties.scrollTop = 0;
                if (this.panel) this.panel.scrollTop = 0;
            }
            this.hoverRefs = []; this.geometry = undefined;
            this.project = project;
            this.clearNumberPreview();
            this.selectedIssues = [];
            this.subitemStates = new Map();
            this.memberKeys.clear();
            this.restoreSelection(state);
            this.issueStart = undefined;
            this.reconcileProject(reset);
            if (reset) this.setTool("select");
            return project;
        }
        finally {
            if (ownsBusy) {
                this.busy = false;
                this.busyText = null;
            }
        }
    }
    previewNumber(change: NumberChange) {
        if (this.busy) return;
        this.pendingNumber = { source: this.project, change, version: ++this.numberVersion };
        this.scheduleNumber();
    }
    commitNumber(address: Address, value: Expression) {
        if (this.busy) return;
        const changed = readAt(this.project.design, address) !== value;
        this.clearNumberPreview(changed);
        if (!changed) return;
        const focus = typeof document === "undefined" ? undefined : document.activeElement;
        return this.edit(d => {
            writeAt(d, address, value);
        }, undefined, true)?.then(async () => {
            await tick();
            if (focus && focus instanceof HTMLElement && focus.isConnected && document.activeElement === document.body)
                focus.focus({ preventScroll: true });
        });
    }
    navigate(forward: boolean) {
        if (this.busy || this.gesture) return;
        if (this.tool !== "select") this.cancelDrawing();
        const target = this.history.target(forward);
        if (!target) return;
        const step = this.history.editStep(forward), selected = forward ? step?.after : step?.before;
        const state = selected === undefined ? this.editSelection() : selected;
        if (step?.metadata) {
            this.project = this.project.withPrompt(step.metadata, readAt(JSON.parse(target), step.metadata) as string | undefined);
            this.history.advance(forward);
            this.restoreSelection(state);
            this.syncHistory(true);
            return;
        }
        return this.working(null, async () => {
            this.pendingDesign = target;
            await this.replace(target, false, state);
            this.history.advance(forward);
            this.syncHistory(true);
        });
    }
    edit(fn: (d: Design) => Selection | null | void, after?: () => void, immediate = false) {
        if (this.busy) return;
        return this.working(null, async () => {
            const before = this.editSelection(), draft = structuredClone(this.project.design), selected = fn(draft);
            removeUnusedGeometry(this.project.design, draft);
            this.pendingDesign = draft;
            this.project = await this.generate(draft, false, immediate);
            if (immediate) this.clearNumberPreview();
            if (selected !== undefined) this.select(selected);
            after?.();
            this.reconcileProject();
            this.syncHistory(this.history.record(this.project.design, { before, after: this.editSelection() }));
        }, error => {
            if (immediate) this.clearNumberPreview();
            this.message(designErrorText(error, this.project.design));
            if (!(error instanceof DesignError)) console.error(error);
        });
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
        if (draft.tool === "continueCurve" && !this.drawingReady) {
            this.cancelDrawing();
            return;
        }
        if (draft.tool === "geometryPoint" || draft.tool === "geometryCurve" || draft.tool === "geometryClosed" || draft.curve) {
            if (!this.drawingReady) {
                this.message(draft.tool === "geometryClosed" || draft.curve?.requiredClosed || draft.closed ? "闭合曲线至少需要三个节点" : "曲线至少需要两个节点");
                return;
            }
            const info = draft.curve;
            if (!info) return this.edit(d => ({ kind: "geometry", id: finishCurveDraft(d, draft)! }), () => this.focusNewDeclaration());
            const h = this.selection!;
            const slot = this.curves.slots.get(info.key)!, path = geometryIndex(slot);
            let nodeId: string | undefined;
            return this.edit(d => {
                nodeId = finishCurveDraft(d, draft, this.mapProject.terrain);
                return h;
            }, () => {
                const owner = this.geometryOwner(h)!;
                if (draft.tool === "continueCurve") {
                    const curve = geometryPath(owner, path)!, index = nodeId ? curve.nodes.findIndex(node => node.id === nodeId) : info.endpoint!;
                    if (index >= 0) this.selectControl({ role: "vertex", path, index, point: curve.nodes[index].p });
                }
                else this.focusGeometry({ kind: path >= 0 ? "outline" : "curve", index: path });
            });
        }
        if (draft.tool === "section") return this.edit(d => {
            const id = nextSectionId(d);
            const label = nextId(d.sections.map(section => section.label), "剖面线 ");
            d.sections.push({ id, label, points: [holdPoint(d, draft.nodes[0].p), holdPoint(d, draft.nodes[1].p)] });
            return { kind: "section", id };
        }, () => this.revealSections?.());
        return this.edit(d => {
            const n = finishDraft(d, this.mapProject.terrain, draft);
            return { kind: "geoNode", id: n.id };
        }, () => {
            const n = geoAt(this.project.design, this.selection!.id), f = n.function;
            const group = profileGroupForTool(draft.tool);
            const members = group && readAt(f, [group]);
            if (group && Array.isArray(members)) {
                const index = draft.member ?? members.length - 1;
                this.focusGeometry({ kind: "curve", index: profileIndex(f, group, index) });
            }
            else if (draft.tool === "peak" && f.type === "mountain") {
                const index = draft.member ?? f.peaks.length - 1;
                this.geometry = { kind: "parameter", index: f.ridges.length + index };
                this.toggleSubitem(n.id, "peaks", index, true);
            }
            else if (draft.tool === "center" || draft.tool === "harbor") this.geometry = { kind: "parameter", index: 0 };
            else if (draft.tool === "shore") this.geometry = { kind: "curve", index: -1 };
            else if (n.construction.type === "outline") {
                const index = n.construction.outlines.length - 1;
                this.geometry = { kind: "outline", index };
                if (draft.tool === "addOutline") this.toggleSubitem(n.id, "outlines", index, true);
            }
        });
    }
    switchFunction(n: GeoNode, type: GeoFunction["type"], slope: "path" | "radial" = "path") {
        const f = geoAt(this.project.design, n.id).function, form = type === "slope" && f.type === "slope";
        if (type === f.type && (!form || f.kind === slope)) return;
        const uses = parameterRemovalUses(this.project.design, at => at.kind === "geo" && at.id === n.id && at.path[0] === "function" &&
            (!form || (f.kind === "path" ? at.path[1] === "lines" : at.path[1] !== "lines")));
        if (uses.length) return this.blockRemoval(form ? "无法切换坡面形式" : "无法切换函数", uses.map(use => this.removalItem(use)), unavailableParameters);
        return this.edit(d => {
            const node = geoAt(d, n.id);
            if (form && node.function.type === "slope") {
                node.function.kind = slope;
                return;
            }
            if (type !== "coast" && type !== "slope") {
                node.function = defaultFunction(d, type, { id: n.id });
                return;
            }
            const shape = this.project.terrain.regions.get(n.id)!.shape;
            const geometry = functionGeometry(geoAt(this.project.resolved, n.id).construction, shape, d.grid.step, nodeIds(d));
            node.function = defaultFunction(d, type, { center: geometry.center, slope, shore: type === "coast" ? geometry.shore() : undefined });
        }, () => {
            if (!form) this.clearSubitems(n.id);
            this.clearControl();
            this.geometry = type === "coast" ? { kind: "curve", index: -1 } :
                type === "slope" && slope === "radial" ? { kind: "parameter", index: 0 } : undefined;
        });
    }
    hoverSelection(selection?: Selection, control?: GeometryPart) {
        if (selection && (this.tool !== "select" || this.gesture || this.busy)) return;
        const owner = control && this.geometryOwner(selection);
        const part = owner ? geometryHover(owner, control) : undefined;
        const previous = this.hoveredPart, hovered = this.hovered;
        const key = (p?: GeometryHover) => p && ("nodeId" in p ? p.nodeId + ":" + p.path : p.path);
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
        return this.edit(d => ({ kind, id: kind === "input" ? addInput(d) : addField(d) }), () => this.focusNewDeclaration());
    }
    private focusNewDeclaration() {
        const selection = this.selection, work = this.finishWork() ?? Promise.resolve();
        this.revealProperties?.();
        void work.then(tick).then(() => {
            if (this.busy || this.selection !== selection) return;
            const label = this.properties?.previousElementSibling?.querySelector("input");
            label?.focus({ preventScroll: true }); label?.select();
        });
    }
    openMenu(h: Selection, event: MouseEvent, map = false, hit?: GeoControl) {
        this.select(h);
        if (hit) this.selectControl(hit);
        this.menu = { ...contextMenuPoint(event), map, control: hit };
    }
    openIssueMenu(issue: Issue, event: MouseEvent) {
        this.menu = { ...contextMenuPoint(event), issue };
    }
    private selectPart(selection: Selection, part: GeometrySelection) {
        const control = this.resolvePart(selection, part);
        if (!control) return;
        if (this.selection?.kind !== selection.kind || this.selection.id !== selection.id) this.select(selection);
        this.selectControl(control);
    }
    stepCurvePart(direction: -1 | 1) {
        const control = this.vertex, selection = this.selection;
        const owner = this.geometryOwner(selection);
        if (!owner || control?.role !== "vertex" && control?.role !== "segment") return;
        const curve = geometryPath(owner, control.path);
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
                if ((group === "ridges" || group === "valleys" || group === "lines" || group === "peaks") && typeof slot.path[4] === "number")
                    this.toggleSubitem(slot.id, group, slot.path[4], true);
                const n = geoAt(this.project.resolved, slot.id), nodes = slot.resolvedPath.indexOf("nodes");
                if (nodes >= 0) {
                    const path = profileIndex(n.function, group as ProfileGroup, Number(slot.path[4])), index = Number(slot.resolvedPath[nodes + 1]);
                    const vertex = geometryPath(n, path)?.nodes[index];
                    if (vertex) this.selectControl({ role: "vertex", path, index, point: vertex.p });
                }
                else if (group === "peaks" && n.function.type === "mountain" && slot.path[5] === "at") {
                    const index = Number(slot.path[4]);
                    this.selectControl({ role: "parameter", path: n.function.ridges.length + index, index: 0, point: n.function.peaks[index].at });
                }
                if (geoParameter(geoAt(this.project.design, slot.id), slot.path.slice(2))?.advanced) this.toggleSubitem(slot.id, "advanced", undefined, true);
            }
            else if (slot.owner === "input") this.select({ kind: "input", id: slot.id });
            else if (slot.owner === "mark") this.select({ kind: "mark", id: slot.id });
            this.revealProperties?.();
            void tick().then(() => {
                const field = Array.from(this.properties?.querySelectorAll<HTMLElement>("[data-parameter]") ?? [])
                    .find(el => el.dataset.parameter === address);
                revealInPanel(this.properties, field);
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
        if (use.kind === "curve") {
            const slot = use.slot, index = geometryIndex(slot);
            return { text: quotedLocation(curveSlotName(slot)), locate: () => {
                if (slot.location.kind !== "geo") return;
                this.focus("geoNode", slot.location.id);
                this.focusGeometry({ kind: index < 0 ? "curve" : "outline", index });
            } };
        }
        if (use.kind === "geometry") {
            const slot = use.slot, at = slot.location;
            return { text: quotedLocation(slot.name, slot.label), locate: () => {
                if (at.kind === "geo") {
                    this.focus("geoNode", at.id);
                    if ("kind" in slot) {
                        const index = geometryIndex(slot);
                        if (slot.active) this.focusGeometry({ kind: index < 0 ? "curve" : "outline", index });
                        else this.changePropertyTab("function");
                    }
                    else {
                        this.changePropertyTab("function");
                        const f = geoAt(this.project.design, at.id).function;
                        if (f.type !== "slope" || f.kind === "radial") {
                            const index = f.type === "mountain" ? f.ridges.length + Number(at.path[2]) : 0;
                            const n = geoAt(this.project.resolved, at.id);
                            const p = parameterPoints(n).find(([i]) => i === index)?.[1];
                            if (p) this.selectControl({ role: "parameter", path: index, index: 0, point: p });
                        }
                    }
                }
                if (at.kind === "section" || at.kind === "mark") {
                    this.focus(at.kind, at.id);
                    if (at.kind === "section") this.changePropertyTab("section");
                    this.focusObjectGeometry({ kind: at.kind, id: at.id, ...(at.kind === "section" && { index: Number(at.path[1]) }) });
                }
                this.revealProperties?.();
            } };
        }
        const { id, label } = use.node;
        return use.kind === "strip" ? this.geoReference(id, label, "边", "region") : this.geoReference(id, label, "输出到", "function");
    }
    private blockRemoval(title: string, items: RemovalItem[], detail = "请先修改以下引用位置。") {
        this.removal = { title, detail, items };
    }
    removeOutline(id: string, index: number) {
        const d = this.project.design, c = geoAt(d, id).construction;
        if (c.type !== "outline" || c.outlines.length < 2 || !c.outlines[index]) return;
        const uses = geometryItemCurveUses(d, id, ["construction", "outlines"], index);
        if (uses.length) return this.blockRemoval(deletionTitle("轮廓 " + (index + 1)), uses.map(use => this.removalItem(use)));
        const affected = rangeUsers(d, id, geometryPath(geoAt(this.project.resolved, id), index)!.nodes.map(v => v.id));
        const perform = () => {
            this.edit(draft => {
                removeGeometryItem(draft, geoAt(draft, id), ["construction", "outlines"], index);
            }, () => {
                this.discardSubitem(id, "outlines", index);
                if (this.selection?.id !== id || this.geometry?.kind !== "outline" || this.geometry.index < index) return;
                this.geometry = this.geometry.index === index ? undefined : { kind: "outline", index: this.geometry.index - 1 };
            });
        };
        this.removal = { title: "删除这条轮廓？", detail: affected.length ? "以下条带将找不到范围节点。" : "",
            items: affected.map(v => this.geoReference(v.id, v.label, "边", "region")), action: "删除轮廓", perform };
    }
    removeGeo(id: string, vertex?: GeoControl) {
        const d = this.project.design, n = geoAt(d, id);
        if (vertex?.role === "parameter") {
            return this.edit(d => {
                removeParameterPoint(d, geoAt(d, id), vertex);
            }, () => {
                this.clearControl();
                if (n.function.type === "mountain" && vertex.path >= n.function.ridges.length) {
                    this.discardSubitem(id, "peaks", vertex.path - n.function.ridges.length);
                    this.geometry = undefined;
                }
            });
        }
        if (vertex?.role === "vertex" || vertex?.role === "segment") return this.removeCurvePart({ kind: "geoNode", id }, vertex);
        const items = removalUses(d, "geo", id).map(use => this.removalItem(use));
        if (isLastInitializer(d, id)) return this.blockRemoval(deletionTitle(n.label), items, requiredInitializer + "。");
        if (items.length) return this.blockRemoval(deletionTitle(n.label), items);
        return this.edit(d => {
            deleteGeo(d, id);
            if (this.selection?.kind === "geoNode" && this.selection.id === id) return null;
        }, () => this.clearSubitems(id, true));
    }
    removeCurvePart(h: Selection, control: GeoControl) {
        const owner = this.geometryOwner(h), curve = owner && geometryPath(owner, control.path), segment = control.role === "segment";
        if (!curve || !canRemoveNode(curve)) return;
        const index = segment ? segmentRemovalIndex(curve, control.index) : control.index;
        if (index === undefined || !curve.nodes[index]) return;
        const d = this.project.design, graph = this.curves, slot = geometrySlot(d, h.id, control.path, h.kind === "geometry")!;
        const uses = curveNodeUsers(d, slot, index, graph);
        if (uses.length) return this.blockRemoval(deletionTitle((segment ? "线段 " : "节点 ") + (control.index + 1)), uses.map(use => this.referenceItem(use)));
        const source = graph.source(slot).slot.key, affected = new Map<string, GeoNode>();
        for (const candidate of graph.slots.values()) if (candidate.location.kind === "geo" && candidate.location.path[0] === "construction" &&
            graph.source(candidate).slot.key === source)
            for (const n of rangeUsers(d, candidate.location.id, [curve.nodes[index].id])) affected.set(n.id, n);
        const perform = () => {
            let next: CurveNode | undefined;
            return this.edit(draft => {
                if (segment) next = removeCurveSegment(draft, h, control);
                else removeCurveNode(draft, h, control);
            }, () => {
                if (next) this.selectPart(h, { role: "vertex", path: control.path, nodeId: next.id });
            });
        };
        const action = segment ? "删除线段" : "删除节点";
        if (affected.size) this.removal = { title: action + "？", detail: "以下条带的范围将报告找不到节点。",
            action, items: [...affected.values()].map(r => this.geoReference(r.id, r.label, "边", "region")), perform };
        else return perform();
    }
    setLineEase(key: string, ease: boolean) {
        return this.edit(d => {
            const graph = curveGraph(d), slot = graph.slots.get(key);
            if (slot?.holder?.kind !== "line") return;
            const { value } = graph.holder(slot.holder);
            if (ease) value.ease = true;
            else delete value.ease;
        });
    }
    setNodeOverride(key: string, index: number, quantity: NodeQuantity, override: boolean) {
        return this.edit(d => setCurveOverride(d, key, index, quantity, override));
    }
    setCurveClosed(id: string, index: number, closed: boolean) {
        const h = this.selection;
        if (!h || h.id !== id) return;
        return this.edit(d => {
            editCurve(d, h, index, path => {
                if (index >= 0 || closed && path.nodes.length < 3) return;
                path.closed = closed;
                cleanHandles(path);
            });
        });
    }
    private editSelectedCurve(control: GeoControl, change: (curve: Curve) => void) {
        const h = this.selection;
        if (h) return this.edit(d => {
            editCurve(d, h, control.path, change);
        });
    }
    pathNodeMode(control: GeoControl, mode?: CurveNode["mode"]) {
        return this.editSelectedCurve(control, path => setNodeMode(path, control.index, mode ?? (path.nodes[control.index].mode === "auto" ? "corner" : "auto")));
    }
    retractHandle(control: GeoControl, side: "in" | "out") {
        return this.editSelectedCurve(control, path => retractHandle(path, control.index, side));
    }
    segment(control: GeoControl, type: SegmentType | "tangent") {
        return this.editSelectedCurve(control, path => setSegment(path, control.index, type));
    }
    segmentAngle(control: GeoControl, angle: number) {
        return this.editSelectedCurve(control, path => {
            const node = path.nodes[control.index];
            if (node.bulge !== undefined) node.bulge = bulgeFromDegrees(angle);
        });
    }
    wholeCurve(control: GeoControl, action: "auto" | "line") {
        return this.editSelectedCurve(control, path => {
            editWholeCurve(path, action);
        });
    }
    insertNode(id: string, control: GeoControl) {
        const h = this.selection?.id === id ? this.selection : { kind: "geoNode" as const, id };
        let node: CurveNode | undefined;
        return this.edit(d => {
            node = insertCurveNode(d, h, control);
        }, () => {
            if (node) this.selectPart(h, { role: "vertex", path: control.path, nodeId: node.id });
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
        this.holderGeometry = undefined;
        this.select({ kind, id });
        if (kind === "mark") {
            const mark = this.project.resolved.marks.find(m => m.id === id)!;
            const [x, y] = this.map.markScreen(mark);
            if (mark.follow === "map" && (x < 0 || y < 0 || x > this.map.width || y > this.map.height))
                this.map.revealBounds([...mark.point, ...mark.point]);
        }
        else if (kind === "geoNode") {
            const box = this.project.terrain.regions.get(id)?.shape.box;
            if (box) this.map.revealBounds(box);
        }
        else if (kind === "geometry") {
            const geometry = geometryAt(this.project.design, id)!;
            this.map.revealBounds(bounds("point" in geometry ? [geometry.point] : geometry.curve.nodes.map(v => v.p)));
        }
        else if (kind === "section") {
            this.map.revealBounds(bounds(this.project.resolved.sections.find(section => section.id === id)!.points));
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
            const section = this.project.resolved.sections.find(s => s.id === id)!;
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
            revealInPanel(this.panel, row);
        });
    }
    private selectIssues(issues: Issue[]) {
        const [issue] = issues;
        if (!issue) return;
        if (this.tool !== "select") this.cancelDrawing();
        this.layer("issues", true);
        if (!objectIssues(this.project, this.selection).includes(issue))
            this.select(issue.location?.kind === "geometry" ? { kind: "geometry", id: issue.location.id } : issue.geoNode ? { kind: "geoNode", id: issue.geoNode } : null, false);
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
    addMark(kind: Mark["kind"], screen: Point) {
        return this.edit(d => {
            const id = nextId(d.marks.map(m => m.id), "mark-");
            const follow = defaultFollow(kind), [x, y] = this.map.world(...screen);
            const point = holdPoint(d, [+x.toFixed(2), +y.toFixed(2)]);
            d.marks.push(kind === "scale" ? { id, kind, label: "比例尺", point, screen, follow, length: markParameters.scale.default } :
                { id, kind, label: "文字标记 " + id.slice(5), point, screen, follow, elevation: markParameters.text.default });
            return { kind: "mark", id };
        });
    }
    setMarkFollow(id: string, follow: Mark["follow"]) {
        const design = this.project.design, current = design.marks.find(m => m.id === id);
        if (!current || current.follow === follow) return;
        if (current.kind === "scale" && follow === "screen") {
            const uses = parameterRemovalUses(design, at => at.kind === "mark" && at.id === id && at.path[0] === "length");
            if (uses.length) return this.blockRemoval("无法改为跟随屏幕", uses.map(use => this.removalItem(use)), unavailableParameters);
        }
        const resolved = this.project.resolved.marks.find(m => m.id === id)!;
        const point = this.map.visibleMarkPoint(resolved);
        return this.edit(d => {
            const mark = d.marks.find(m => m.id === id)!;
            if (follow === "screen") mark.screen = point;
            else movePointGeometry(d, mark.point, this.map.world(...point));
            mark.follow = follow;
        }, () => {
            if (follow === "screen") this.map.keepMarkScreenPosition?.(id, point);
        });
    }
    copyMark(id: string) {
        return this.edit(d => {
            const copy = structuredClone(d.marks.find(m => m.id === id)!);
            copy.id = nextId(d.marks.map(m => m.id), "mark-");
            copy.label += " 副本";
            copyHeldGeometry(d, [copy.point], at => at.kind === "mark" && at.id === id);
            d.marks.push(copy);
            return { kind: "mark", id: copy.id };
        });
    }
    copySection(id: string) {
        return this.edit(d => {
            const copy = structuredClone(d.sections.find(s => s.id === id)!);
            copy.id = nextSectionId(d);
            copy.label += " 副本";
            copyHeldGeometry(d, copy.points, at => at.kind === "section" && at.id === id);
            d.sections.push(copy);
            return { kind: "section", id: copy.id };
        }, () => this.revealSections?.());
    }
    canRemove(h: Selection) {
        return h.kind !== "input" && h.kind !== "field" || !isBuiltin(h.kind, h.id);
    }
    removeSelected() {
        const h = this.selection;
        if (!h) return;
        const part = this.resolvedPart;
        if (this.geometryPage) {
            if (this.vertex?.role === "vertex" || this.vertex?.role === "segment") return this.removeCurvePart(h, this.vertex);
            return this.removeElement({ kind: "geometry", id: this.geometryPage.id });
        }
        if (h.kind === "geoNode" && part?.role === "curve") {
            const member = curveMember(geoAt(this.project.design, h.id).function, part.path);
            if (member) return this.changeMember(h.id, member.group, member.index, false);
        }
        if (h.kind === "geoNode" && this.outline !== undefined) this.removeOutline(h.id, this.outline);
        else if (h.kind === "geoNode" && this.vertex) this.removeGeo(h.id, this.vertex);
        else this.removeElement(h);
    }
    removeElement(h: Selection) {
        if (!this.canRemove(h) || !this.exists(h)) return;
        if (h.kind === "geoNode") return this.removeGeo(h.id);
        if (h.kind === "input" || h.kind === "field" || h.kind === "geometry") {
            const kind = h.kind, d = this.project.design;
            const items = removalUses(d, kind, h.id).map(use => this.removalItem(use));
            const item = (kind === "input" ? d.inputs : kind === "field" ? d.fields : d.geometry)[h.id];
            if (items.length) return this.blockRemoval(deletionTitle(item.label ?? h.id), items,
                kind === "geometry" ? "以下位置仍在使用它，请先修改。" : undefined);
            if (kind === "geometry" && !d.geometry[h.id].independent)
                return this.blockRemoval(deletionTitle(item.label ?? h.id), [], "只能删除独立的几何对象。");
            return this.edit(d => {
                removeDeclaration(d, kind, h.id);
                if (this.selection?.kind === h.kind && this.selection.id === h.id) return null;
            });
        }
        if (h.kind === "mark") {
            const d = this.project.design, items = removalUses(d, "mark", h.id).map(use => this.removalItem(use));
            if (items.length) return this.blockRemoval(deletionTitle(d.marks.find(mark => mark.id === h.id)!.label), items);
        }
        return this.edit(d => {
            const group = h.kind === "mark" ? "marks" : "sections";
            d[group].splice(d[group].findIndex(item => item.id === h.id), 1);
            if (this.selection?.kind === h.kind && this.selection.id === h.id) return null;
        });
    }
}
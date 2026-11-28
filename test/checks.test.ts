import { curveGraph } from "../src/core/design/curveReferences.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Project } from "../src/core/project.ts";
import { gridDefaults, layerDefaults } from "../src/core/edit/display.ts";
import { ProjectMap, type MapView } from "../src/render/map.ts";
import { mapColors, overlay } from "../src/render/palette.ts";
import { holderLayer, placementSelection, type HolderGroup, type SelectionPath } from "../src/core/edit/selection.ts";
import { type Point } from "../src/core/design/v5.ts";
import { type GeoDraft } from "../src/core/edit/types.ts";
import { addLayer, fixtureMark, fixtureSection, literalCurve, openCurve, rect, syntheticDesign, withNodeSlope } from "./scenarios.ts";

const view = (project: Project, layers: Partial<MapView["layers"]>): MapView => ({
    project: project.view(), layers: { ...layerDefaults, ...layers }, grid: gridDefaults,
    authored: project.design, curves: curveGraph(project.design), selectionPath: null, displayField: "height", referencedGeo: []
});

test("Text marks show the resolved authored elevation when enabled", () => {
    const d = syntheticDesign();
    d.marks.push(fixtureMark(d, { id: "A", label: "A", kind: "text", point: [1, 2], follow: "map", elevation: "{input:A}", showElevation: true }));
    d.inputs.A.value = 9;
    const project = new Project(d), mark = project.resolved.marks[0];
    assert(mark.kind === "text");
    const text: string[] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, strokeText() {}, measureText: () => ({ width: 15 }),
        fillText: (value: string) => text.push(value) } as unknown as CanvasRenderingContext2D;
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { markScreen: () => [0, 0] });
    function draw() {
        map["drawMarks"](ctx, view(project, { marks: true }), mapColors.light);
        return text.at(-1);
    }
    assert.equal(draw(), "A 9.0 m");
    d.inputs.A.value += 2;
    project.update();
    const changed = project.resolved.marks[0];
    assert(changed.kind === "text");
    assert.equal(draw(), "A 11.0 m");
    changed.showElevation = false;
    assert.equal(draw(), "A");
});

test("Groundwork names and section names follow separate map switches", () => {
    const d = syntheticDesign();
    d.geoNodes[0].showLabel = true;
    d.sections = [fixtureSection(d, { id: "A", label: "A", points: [[0, 0], [0, 5]] }),
        fixtureSection(d, { id: "B", label: "B", points: [[1, 0], [1, 5]], showLabel: false })];
    const project = new Project(d);
    const names: string[] = [];
    const ctx = { save() {}, restore() {}, strokeText() {}, measureText: () => ({ width: 8 }),
        fillText: (value: string) => names.push(value) } as unknown as CanvasRenderingContext2D;
    const map = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap, { screen: () => [0, 0] });
    for (const [labels, sections, expected] of [[true, true, ["G", "A"]], [false, true, ["A"]], [true, false, ["G"]], [false, false, []]] as const) {
        names.length = 0;
        map["drawLabels"](ctx, view(project, { labels, sections }), mapColors.light);
        assert.deepEqual(names, expected);
    }
});

test("Selection and hover use the same strokes at each map layer", t => {
    const design = syntheticDesign(), owner = design.geoNodes[1];
    assert(owner.construction.type === "outline" && "curve" in owner.construction.outlines[0]);
    const closedId = owner.construction.outlines[0].curve, closed = literalCurve(design, closedId);
    design.geometry[closedId].independent = true;
    const line = openCurve([{ p: [-30, 19], h: 8 }, { p: [-16, 19], h: 9 }], "corner", "ridge-");
    const independentCurve = rect(2, -12, 14, -2).outlines[0].curve;
    design.geometry.open = { label: "独立曲线", curve: line, independent: true };
    design.geometry.closed = { label: "独立闭合曲线", curve: independentCurve, independent: true };
    design.geometry.point = { label: "独立点", point: [15, -12], independent: true };
    design.geoNodes.push(
        addLayer(design, "M", rect(-42, 12, -10, 29), {
            type: "mountain", ridges: [{ curve: withNodeSlope(line, 2) }], valleys: [],
            peaks: [{ at: [-26, 22], height: 12, radius: 5, noise: 0, scale: 1 }]
        }),
        addLayer(design, "C", rect(13, 12, 36, 32), {
            type: "coast", shore: rect(18, 15, 33, 28).outlines[0], roughness: 0,
            harbor: { center: [18, 22], radius: 0, span: 4 }
        })
    );
    design.sections.push(fixtureSection(design, { id: "Q", label: "剖面线", points: [[-10, 9], [10, 9]], showLabel: false }));
    const endpointPoint = design.sections[0].points[0];
    assert("point" in endpointPoint);
    design.geometry[endpointPoint.point].independent = true;

    const project = new Project(design), base = view(project, { grid: false, labels: false, issues: false });
    const colors = mapColors.light, accent = colors.accent, hoverAlpha = overlay.segmentHoverOpacity;
    const geo = (id: string) => ({ kind: "geoNode", id } as const);
    const holder = (id: string, group: HolderGroup): SelectionPath => [geo(id), holderLayer(group)];
    const held = (id: string, group: HolderGroup) => placementSelection(design, base.curves, geo(id), holderLayer(group));
    const independent = (id: string): SelectionPath => [{ kind: "geometry", id }];
    const section = { kind: "section", id: "Q" } as const;
    const endpoint = holderLayer("endpoints");
    const outline = held(owner.id, "outlines"), ridge = held("M", "ridges"), shore = held("C", "shore");
    const seg = (path: SelectionPath, nodeId: string): SelectionPath => [...path, { kind: "segment", nodeId }];

    const source = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
    Object.defineProperty(globalThis, "Path2D", {
        configurable: true,
        value: class {
            moveTo() {}
            lineTo() {}
            closePath() {}
        }
    });
    t.after(() => {
        if (source) Object.defineProperty(globalThis, "Path2D", source);
        else Reflect.deleteProperty(globalThis, "Path2D");
    });
    const fills: number[] = [], dots: { color: string; alpha: number; center: Point }[] = [], strokes: {
        color: string; width: number; alpha: number; dash: number[]; radius?: number; center?: Point
    }[] = [];
    const stack: { globalAlpha: number; strokeStyle: string; lineWidth: number; dash: number[]; fillStyle: string }[] = [];
    const ctx = {
        globalAlpha: 1, strokeStyle: "", lineWidth: 0, dash: [] as number[], fillStyle: "",
        radius: undefined as number | undefined, center: undefined as Point | undefined,
        save() {
            const { globalAlpha, strokeStyle, lineWidth, dash, fillStyle } = this;
            stack.push({ globalAlpha, strokeStyle, lineWidth, dash, fillStyle });
        },
        restore() {
            Object.assign(this, stack.pop());
        },
        setTransform() {}, fillRect() {}, translate() {}, scale() {},
        beginPath() {
            this.radius = this.center = undefined;
        },
        moveTo() {}, lineTo() {}, closePath() {},
        setLineDash(dash: number[]) {
            this.dash = dash.slice();
        },
        arc(x: number, y: number, radius: number) {
            this.center = [x, y];
            this.radius = radius;
        },
        fill(rule?: Path2D | CanvasFillRule) {
            if (rule === "evenodd") fills.push(this.globalAlpha);
            else if (!rule && this.center) dots.push({ color: this.fillStyle, alpha: this.globalAlpha, center: this.center });
        },
        stroke(path?: Path2D) {
            strokes.push({ color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha,
                dash: this.dash, radius: path ? undefined : this.radius, center: path ? undefined : this.center });
        }
    };
    const map = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap,
        { ctx, screen: (p: number[]) => p, scale: 1, width: 160, height: 120, center: [0, 0], dpr: 1 });
    const draw = (patch: Partial<MapView>) => {
        fills.length = dots.length = strokes.length = 0;
        map.draw({ ...base, displayField: "", ...patch }, "light");
        assert.equal(ctx.globalAlpha, 1);
        assert.deepEqual(stack, []);
    };
    const highlights = () => strokes.filter(s => s.color === accent && s.width >= 2).map(s => [s.width, s.dash, s.alpha]);
    const dash = [...overlay.dash];
    const cases: { path: SelectionPath; width: number; dashes?: number[]; selectionFill?: number[]; segment?: boolean }[] = [
        { path: [geo(owner.id)], width: 2 },
        { path: [section], width: 2 },
        { path: holder(owner.id, "outlines"), width: 4 },
        { path: holder("M", "ridges"), width: 4, dashes: dash },
        { path: holder("C", "shore"), width: 4, dashes: dash },
        { path: outline, width: 4, selectionFill: [.1] },
        { path: shore, width: 4, selectionFill: [.1] },
        { path: ridge, width: 2 },
        { path: independent("open"), width: 2 },
        { path: independent(closedId), width: 4, selectionFill: [.1] },
        { path: seg(outline, closed.nodes[0].id), width: 4, selectionFill: [.1], segment: true },
        { path: seg(ridge, line.nodes[0].id), width: 4, dashes: dash, segment: true }
    ];
    for (const { path, width, dashes = [], selectionFill = [], segment } of cases) {
        draw({ hoverPath: path });
        assert.deepEqual(highlights(), [[width, dashes, hoverAlpha]], JSON.stringify(path));
        assert.deepEqual(fills, []);
        assert(strokes.filter(s => s.alpha === hoverAlpha).every(s => s.color === accent));
        if (path[0].kind === "section" && path.length === 1)
            assert.equal(dots.filter(dot => dot.color === accent && dot.alpha === hoverAlpha).length, 2);
        draw({ selectionPath: path });
        const selectedStroke = [width, dashes, 1];
        assert.deepEqual(highlights(), segment ? [[2, [], 1], selectedStroke] : [selectedStroke], JSON.stringify(path));
        assert.deepEqual(fills, selectionFill);
    }

    const peak = holder("M", "peaks"), shoreCenter = holder("C", "harbor");
    const endpointPath = placementSelection(design, base.curves, section, endpoint);
    const points: [SelectionPath, Point][] = [
        [independent("point"), [15, -12]],
        [peak, [-26, 22]],
        [held("M", "peaks"), [-26, 22]],
        [shoreCenter, [18, 22]],
        [held("C", "harbor"), [18, 22]],
        [[section, endpoint], [-10, 9]],
        [endpointPath, [-10, 9]]
    ];
    for (const [path, [x, y]] of points) for (const state of ["selected", "hovered"] as const) {
        draw(state === "selected" ? { selectionPath: path } : { hoverPath: path });
        const selected = state === "selected";
        const handleFills = dots.filter(dot => dot.center[0] === x && dot.center[1] === y).map(({ color, alpha }) => [color, alpha]);
        assert.deepEqual(handleFills, selected ? [[accent, 1]] : [[colors.bgPanel, 1], [accent, hoverAlpha]]);
        const handleStrokes = strokes.filter(s => s.center?.[0] === x && s.center[1] === y);
        assert.deepEqual(handleStrokes.map(s => [s.color, s.width, s.alpha, s.radius, s.dash]), [[accent, 1.5, 1, 4, []]]);
    }

    const vertex: SelectionPath = [...outline, { kind: "vertex", nodeId: closed.nodes[0].id }];
    const ridgeVertex: SelectionPath = [...ridge, { kind: "vertex", nodeId: line.nodes[0].id }];
    for (const [path, fill] of [[vertex, [.1]], [ridgeVertex, []]] as const) {
        draw({ selectionPath: path });
        assert.deepEqual(fills, fill);
        assert.deepEqual(highlights(), [[2, [], 1]]);
        assert.equal(dots.filter(dot => dot.color === accent && dot.alpha === 1).length, 1);
        draw({ hoverPath: path });
        assert.deepEqual(fills, []);
        assert.deepEqual(highlights(), []);
        assert.equal(dots.filter(dot => dot.color === accent && dot.alpha === hoverAlpha).length, 1);
    }

    draw({ hoverPath: shore, layers: { ...base.layers, geoNodes: true } });
    assert.equal(strokes.filter(s => s.color === colors.parameterGeometry).length, 1, "Only the idle ridge is purple");
    draw({ selectionPath: vertex, hoverPath: outline });
    assert.deepEqual(fills, [.1]);
    assert.deepEqual(highlights(), [[4, [], hoverAlpha], [2, [], 1]]);

    const layers = { ...base.layers, geometry: true };
    draw({ hoverPath: [section], layers });
    assert.equal(dots.length, 5, "Two hovered endpoints and one idle independent point");
    draw({ selectionPath: [section, endpoint], layers });
    assert.equal(dots.length, 3, "The selected endpoint replaces its idle independent point at the same location");

    const placed = { id: closedId, curve: closed, offset: [0, 0] as Point };
    const loose = { id: "closed", curve: independentCurve };
    const draft: GeoDraft = { tool: "redrawCurve", ids: [], nodes: [], anchors: [], reverse: false,
        curve: { key: "A", name: "A", original: closed, pen: "boundary", requiredClosed: true, pick: { label: "轮廓" } } };
    const choices = [{ key: "A", placements: [placed] }, { key: "B", placements: [loose] }];
    const displayed = { selectionPath: outline, layers: { ...layers, geoNodes: true } };
    draw(displayed);
    const before = { fills: fills.slice(), strokes: strokes.slice(), dots: dots.slice() };
    draw({ ...displayed, draft, curveChoices: choices });
    assert.deepEqual({ fills, strokes, dots }, before);
    for (const { key, placements: [placement] } of choices) {
        draw({ draft, curveChoices: choices, hoveredCurveChoice: key });
        assert.deepEqual(fills, []);
        assert.deepEqual(highlights(), [[4, [], hoverAlpha]]);
        draw({ referenceCurves: [placement] });
        assert.deepEqual(fills, []);
        assert.deepEqual(highlights(), [[4, [], hoverAlpha]]);
    }
});
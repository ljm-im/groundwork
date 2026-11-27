import { curveGraph } from "../src/core/design/curveReferences.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Project } from "../src/core/project.ts";
import { gridDefaults, layerDefaults } from "../src/core/edit/display.ts";
import { ProjectMap, type MapView } from "../src/render/map.ts";
import { baseMap, mapColors, overlay } from "../src/render/palette.ts";
import { drawGeoOverlay } from "../src/render/geoOverlay.ts";
import { holderLayer, placementSelection, type SelectionPath } from "../src/core/edit/selection.ts";
import { type GeoDraft } from "../src/core/edit/types.ts";
import { fixtureMark, fixtureSection, literalCurve, syntheticDesign } from "./scenarios.ts";

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

test("Closed curve fills distinguish hover and selection without repainting outlines purple", () => {
    const design = syntheticDesign(), owner = design.geoNodes[1];
    assert(owner.construction.type === "outline" && "curve" in owner.construction.outlines[0]);
    const id = owner.construction.outlines[0].curve;
    design.geometry[id].independent = true;
    const project = new Project(design), base = view(project, {}), colors = mapColors.light, boundary = baseMap.light.boundary;
    const root = { kind: "geoNode", id: owner.id } as const;
    const path = placementSelection(design, base.curves, root, holderLayer("outlines"));
    assert.equal(path.length, 3);

    const fills: number[] = [], strokes: [string, number][] = [], alpha: number[] = [];
    const ctx = {
        globalAlpha: 1, strokeStyle: "", lineWidth: 0,
        save() {
            alpha.push(this.globalAlpha);
        },
        restore() {
            this.globalAlpha = alpha.pop()!;
        },
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {}, arc() {},
        fill(rule?: CanvasFillRule) {
            if (rule === "evenodd") fills.push(this.globalAlpha);
        },
        stroke() {
            if (this.lineWidth !== overlay.handleOutline) strokes.push([this.strokeStyle, this.lineWidth]);
        }
    };
    const map = Object.assign(Object.create(ProjectMap.prototype) as ProjectMap, { ctx, screen: (p: number[]) => p, scale: 1 });
    const draw = (patch: Partial<MapView>) => {
        fills.length = strokes.length = 0;
        drawGeoOverlay(map, { ...base, ...patch }, colors, boundary);
    };
    draw({ hoverPath: path });
    assert.deepEqual(fills, [.06]);
    assert.deepEqual(strokes, []);
    draw({ selectionPath: path });
    assert.deepEqual(fills, [.1]);
    assert.deepEqual(strokes, [[colors.accent, 4]]);
    const node: SelectionPath = [...path, { kind: "vertex", nodeId: "0" }];
    draw({ selectionPath: node, hoverPath: path });
    assert.deepEqual(fills, [.1]);
    assert.deepEqual(strokes, [[boundary, .6]]);
    const segment: SelectionPath = [...path, { kind: "segment", nodeId: "0" }];
    draw({ selectionPath: segment });
    assert.deepEqual(fills, [.1]);
    assert.deepEqual(strokes, [[boundary, .6], [colors.accent, 4]]);
    draw({ layers: { ...base.layers, geometry: true } });
    assert.deepEqual(fills, []);
    assert.deepEqual(strokes, [[colors.parameterGeometry, 2]]);

    const curve = literalCurve(design, id);
    const draft: GeoDraft = { tool: "redrawCurve", ids: [], nodes: [], anchors: [], reverse: false,
        curve: { key: "A", name: "A", original: curve, pen: "boundary", requiredClosed: true, pick: { label: "轮廓" } } };
    const choices = [{ key: "A", placements: [curve] }, { key: "B", placements: [curve] }];
    draw({ draft, curveChoices: choices });
    assert.deepEqual(fills, []);
    assert.deepEqual(strokes, [[colors.parameterGeometry, 2], [colors.parameterGeometry, 2]]);
    draw({ draft, curveChoices: choices, hoveredCurveChoice: "B" });
    assert.deepEqual(fills, [.06]);
    assert.deepEqual(strokes, [[colors.parameterGeometry, 2], [colors.parameterGeometry, 2]]);
    draw({ referenceCurves: [curve] });
    assert.deepEqual(fills, [.06]);
    assert.deepEqual(strokes, []);
});
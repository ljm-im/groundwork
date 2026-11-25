import { test } from "node:test";
import assert from "node:assert/strict";
import { Project } from "../src/core/project.ts";
import { gridDefaults, layerDefaults } from "../src/core/edit/display.ts";
import { ProjectMap, type MapView } from "../src/render/map.ts";
import { mapColors } from "../src/render/palette.ts";
import { syntheticDesign } from "./scenarios.ts";

const view = (project: Project, layers: Partial<MapView["layers"]>): MapView => ({
    project: project.view(), layers: { ...layerDefaults, ...layers }, grid: gridDefaults,
    selection: null, displayField: "height", referencedGeo: []
});

test("Text marks show the resolved authored elevation when enabled", () => {
    const d = syntheticDesign();
    d.marks.push({ id: "A", label: "A", kind: "text", point: [1, 2], follow: "map", elevation: "{input:A}", showElevation: true });
    d.inputs.A.value = 9;
    const project = new Project(d), mark = project.resolved.marks[0];
    assert(mark.kind === "text");
    const text: string[] = [];
    const ctx = { save() {}, restore() {}, strokeText() {}, measureText: () => ({ width: 15 }),
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
    d.sections = [{ id: "A", label: "A", points: [[0, 0], [0, 5]] },
        { id: "B", label: "B", points: [[1, 0], [1, 5]], showLabel: false }];
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
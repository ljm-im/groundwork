import { test } from "node:test";
import assert from "node:assert/strict";
import { Project } from "../src/core/project.ts";
import { ProjectMap } from "../src/render/map.ts";
import { syntheticDesign } from "./scenarios.ts";

test("Text marks show the resolved authored elevation when enabled", () => {
    const d = syntheticDesign();
    d.marks.push({ id: "A", label: "A", kind: "text", point: [1, 2], follow: "map", elevation: "{input:A}", showElevation: true });
    d.inputs.A.value = 9;
    const project = new Project(d), mark = project.resolved.marks[0];
    assert(mark.kind === "text");
    const text: string[] = [];
    const ctx = { save() {}, restore() {}, strokeText() {}, measureText: () => ({ width: 15 }),
        fillText: (value: string) => text.push(value) } as unknown as CanvasRenderingContext2D;
    const map: ProjectMap = Object.assign(Object.create(ProjectMap.prototype), { layers: { marks: true },
        markScreen: () => [0, 0] });
    function draw() {
        map.project = project.view();
        map["drawMarks"](ctx);
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
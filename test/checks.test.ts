import { test } from "node:test";
import assert from "node:assert/strict";
import { Project } from "../src/core/project.ts";
import { markReading } from "../src/render/map.ts";
import { syntheticDesign } from "./scenarios.ts";

test("Text marks show the resolved authored elevation when enabled", () => {
    const d = syntheticDesign();
    d.marks.push({ id: "A", label: "A", kind: "text", point: [1, 2], follow: "ground", elevation: "{input:A}", showElevation: true });
    d.inputs.A.value = 9;
    const project = new Project(d), mark = project.resolved.marks[0];
    assert(mark.kind === "text");
    assert.equal(markReading(mark).text, "A 9.0 m");
    d.inputs.A.value += 2;
    project.update();
    const changed = project.resolved.marks[0];
    assert(changed.kind === "text");
    assert.equal(markReading(changed).text, "A 11.0 m");
    assert.equal(markReading({ ...changed, showElevation: false }).text, "A");
});
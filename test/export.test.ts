import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { type Point } from "../src/core/design/v5.ts";
import { gradient } from "../src/core/math/geometry.ts";
import { Project } from "../src/core/project.ts";
import { syntheticDesign, rect, layer, polygon } from "./scenarios.ts";
import { exportProject, serializeExport } from "../src/core/export.ts";

const prompt = "  外观保留原样。\n[\n  1,\n  2\n]\t\"门\"  ";
const provenance = (input: string) => ({ sha256: createHash("sha256").update(input).digest("hex"), commit: "a".repeat(40) });

function loadExample() {
    const design = syntheticDesign();
    design.prompt = prompt;
    design.marks.push({ id: "B", label: "B", kind: "text", point: [2, 3], follow: "map", elevation: "{input:A}" },
        { id: "C", label: "C", kind: "scale", point: [5, 6], follow: "map", length: 10 },
        { id: "D", label: "D", kind: "text", point: [2, 3], follow: "screen" },
        { id: "E", label: "E", kind: "text", point: [9, 8], follow: "map" });
    const c = design.geoNodes[0].construction;
    if (c.type === "outline") {
        const hole = polygon([[6, 5], [12, 5], [12, 10], [6, 10]]);
        for (const node of hole.nodes) node.id = "H" + node.id;
        c.outlines.push(hole);
    }
    design.geoNodes.push(layer("S", rect(-40, 6, -20, 10), { type: "flat", amount: -5 }),
        layer("B", rect(-40, 10, -20, 18), { type: "flat", amount: -3 }));
    const input = serializeDesign(design), source = provenance(input);
    const project = new Project(design), result = exportProject(project, source);
    return { design, input, source, project, result };
}
let example: ReturnType<typeof loadExample>;
function exportTest(name: string, check: (data: ReturnType<typeof loadExample>) => void) {
    test(name, () => check(example ??= loadExample()));
}

const round = (n: number) => Number(n.toFixed(3)) || 0;
const plan = (p: number[]): Point => [p[0], p[1]];
const rounded = (p: number[]): Point => [round(p[0]), round(p[1])];

// Reconstruct ground level using only the information available in the exported file.
function ground(p: number[], terrain: ReturnType<typeof exportProject>["terrain"]) {
    const { origin, step, width, height, heights } = terrain;
    const x = Math.max(0, Math.min(width - 1, (p[0] - origin[0]) / step));
    const y = Math.max(0, Math.min(height - 1, (origin[1] - p[1]) / step));
    const left = Math.floor(x), right = Math.ceil(x), top = Math.floor(y), bottom = Math.ceil(y);
    let value = 0, total = 0;
    for (const j of new Set([top, bottom])) for (const i of new Set([left, right])) {
        const weight = (1 - Math.abs(x - i)) * (1 - Math.abs(y - j));
        if (terrain.defined[j][i]) {
            value += heights[j][i] * weight; total += weight;
        }
    }
    return value / total;
}

exportTest("independent exports have identical formatted bytes and preserve authored text", ({ input, source, project, result }) => {
    const bytes = serializeExport(result);
    const again = exportProject(new Project(parseDesign(input)), { commit: source.commit, sha256: source.sha256 });
    assert.equal(serializeExport(again), bytes);
    const json = JSON.parse(bytes);
    assert.deepEqual(json.source, source);
    assert.equal(json.format, "groundwork-export");
    assert.equal(json.version, 6);
    assert.deepEqual(Object.keys(json), ["format", "version", "source", "instructions", "prompt", "terrain", "marks", "issues"]);
    assert(!Object.hasOwn(json, "labels"));
    assert.deepEqual(result.marks.map(m => [m.id, m.label, m.type]), [["B", "B", "mark.text"]]);
    assert.equal(json.prompt, prompt);
    for (const elements of [result.marks, result.issues])
        for (const e of elements) assert(e.id && e.label && e.type && !Object.hasOwn(e, "name"));
    assert.match(bytes, /^\{\n  "format"/);
    assert.doesNotMatch(bytes, /\[\n\s+[-\d.]/);
    for (const field of ["routing", "erosion", "levelControls", "angle", "direction", "via", "zones", "radialSlope"])
        assert(!Object.hasOwn(json, field));
    assert.equal(serializeDesign(project.design), input);
});

exportTest("the exported grid contains every height sample and classifies surfaces in priority order", ({ project, result }) => {
    const { terrain } = project, { grid } = terrain, out = result.terrain;
    assert.deepEqual([out.origin, out.step, out.width, out.height, out.rowOrder], [grid.point(0), grid.step, grid.width, grid.height, "north-to-south"]);
    assert.deepEqual(out.surfaceRules.priority, [0, 2, 1, 3]);
    const seen = new Set<number>();
    for (let j = 0; j < grid.height; j++) for (let i = 0; i < grid.width; i++) {
        const k = j * grid.width + i, h = terrain.fields.height.values[k];
        assert.equal(out.defined[j][i], terrain.fields.height.defined[k]);
        assert.equal(out.heights[j][i], round(h));
        if (!terrain.fields.height.defined[k]) {
            assert.equal(h, 0); continue;
        }
        const slope = Math.hypot(...gradient(grid, terrain.fields.height.values, terrain.fields.height.defined, k));
        const expected = h < 0 ? 0 : slope > .75 ? 2 : Math.abs(terrain.shore[k]) <= 5 && slope < .3 && h < 2 ? 1 : 3;
        assert.equal(out.surface[j][i], expected);
        seen.add(expected);
    }
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
    assert(out.defined.some(row => row.includes(0)));
});

exportTest("validation issues and ground-following marks use resolved geometry", ({ design, project, result }) => {
    assert.deepEqual(plan(result.marks[0].position), design.marks[0].point);
    assert(Math.abs(result.marks[0].position[2] - ground(result.marks[0].position, result.terrain)) <= .00050000001);
    assert.equal(result.issues.length, project.issues.length);
    for (const [i, issue] of project.issues.entries()) {
        const out = result.issues[i];
        assert.deepEqual([out.kind, out.severity, out.geoNode, out.message, out.position.slice(0, 2)],
            [issue.kind, issue.severity, issue.geoNode, issue.message, rounded(issue.point)]);
    }
});

test("Mark bases can be reconstructed from rounded grid spacing and origin", () => {
    const d = syntheticDesign();
    d.grid.step = 1.00049;
    d.marks.push({ id: "A", label: "A", kind: "text", follow: "map", point: [-20.1234, -13.9876] });
    const out = exportProject(new Project(d), provenance(serializeDesign(d)));
    assert.equal(out.terrain.step, 1);
    assert.equal(out.marks.length, 1);
    for (const m of out.marks) assert(Math.abs(m.position[2] - ground(m.position, out.terrain)) <= .00050000001);
});

test("Export version six uses error and warning severities", () => {
    const design = syntheticDesign();
    design.geoNodes.push(layer("X", { type: "strip", of: ["missing"], widths: [1, 2] }, { type: "blend" }));
    const result = exportProject(new Project(design), provenance(serializeDesign(design)));
    assert.deepEqual(result.issues.map(i => [i.geoNode, i.severity]), [["X", "error"], ["T", "warning"]]);
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Point } from "../src/core/design/v5.ts";
import { type Issue } from "../src/core/design/results.ts";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { advance, nearest, pointAt, radians, stations } from "../src/core/math/geometry.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign, buildingShape } from "../src/core/design/model.ts";
import { markReading } from "../src/render/map.ts";
import { selfOverlaps, sharpBends, overlappingLocations } from "../src/core/roads/proximity.ts";
import { summitHeights, validateRoads } from "../src/core/checks/validation.ts";
import { issueShapes, objectIssues } from "../src/core/checks/issues.ts";
import { syntheticDesign, syntheticRoads } from "./scenarios.ts";

test("Default roads meet their hard constraints", () => {
    const design = syntheticDesign();
    const model = new Island(design);
    assert(!model.issues.some(i => ["sharp-bend", "self-overlap"].includes(i.kind)), "默认路网出现急弯或自身重叠");
    assert.equal(model.issues.filter(i => i.kind === "no-route" || i.kind === "overlap").length, 0);
    assert(!model.issues.some(i => i.kind === "turn-radius"));
    const routed = model.routes.filter(r => (r.edge.mode ?? "route") === "route");
    assert(routed.length > 0 && !model.issues.some(i => i.severity === "error" && routed.some(r => r.id === i.road)));
    assert(model.issues.every(i => i.point.every(Number.isFinite)));
});

test("Overlap lengths, shared junctions, bends and self-crossings", () => {
    const { synthetic, flat, road } = syntheticRoads();
    const aRoad = road("a-b", "a", "b", [
        [0, 0],
        [10, 0],
        [20, 0]
    ]);
    const bRoad = road("c-d", "c", "d", [
        [0, 2],
        [10, 2],
        [20, 2]
    ]);
    assert(validateRoads(synthetic, flat, [aRoad, bRoad]).some(i => i.kind === "overlap"));
    const fork = road("a-d", "a", "d", [
        [0, 0],
        [1, 1],
        [2, 2],
        [2, 12]
    ]);
    assert(!validateRoads(synthetic, flat, [aRoad, fork]).some(i => i.kind === "overlap"));
    const short = road("c-d", "c", "d", [
        [8, 2.99],
        [9, 2.99]
    ]);
    assert(!validateRoads(synthetic, flat, [aRoad, short]).some(i => i.kind === "overlap"));
    assert(!validateRoads(synthetic, flat, [short, aRoad]).some(i => i.kind === "overlap"));
    const onLimit = road("on-limit", "c", "d", [
        [0, 3],
        [20, 3]
    ]);
    assert(!validateRoads(synthetic, flat, [aRoad, onLimit]).some(i => i.kind === "overlap"));
    const justEnough = road("enough", "c", "d", [
        [6, 2],
        [9, 2]
    ]);
    assert(validateRoads(synthetic, flat, [aRoad, justEnough]).some(i => i.kind === "overlap"));
    const headingLine = (gap: number, degrees: number) => {
        const a: Point = [0, 0], b: Point = [1, 0], c = advance(b, degrees * radians, gap);
        return [a, b, c, advance(c, 2 * degrees * radians, 1)];
    };
    assert(!sharpBends(headingLine(3.01, 24)).length);
    assert(sharpBends(headingLine(2.99, 24)).length);
    assert(!sharpBends(headingLine(2, 22.5)).length);
    const crossing: Point[] = [[0, 0], [12, 10], [0, 10], [12, 0]];
    assert(selfOverlaps(crossing, 2).length);
    assert(!selfOverlaps([[0, 0], [2, 0], [0, 0]], 2).length, "沿路距离刚好两倍路宽");
    assert(!selfOverlaps([[0, 0], [20, 0]], 2).length);
    const parallel = (y: number): Point[] => [[0, 0], [20, 0], [30, 3], [32, 10], [24, 16], [14, 12], [10, y], [0, y]];
    assert(selfOverlaps(parallel(2.99), 2).some(p => p[0] < 11));
    assert(!selfOverlaps(parallel(3), 2).some(p => p[0] < 10));
    const crossingRoad = road("crossing", "a", "d", crossing);
    assert(validateRoads(synthetic, flat, [crossingRoad]).some(i => i.kind === "self-overlap" && i.severity === "error"));
    assert(validateRoads(synthetic, flat, [crossingRoad]).some(i => i.kind === "sharp-bend" && i.severity === "notice"));
});

test("Grade windows and steps on streets", () => {
    const { synthetic, flat, road, grid } = syntheticRoads();
    const steps = road("S", "a", "b", [
        [0, 0],
        [10, 0],
        [20, 0]
    ], { grade: "street", stairs: true });
    assert(validateRoads(synthetic, flat, [steps]).some(i => i.kind === "street-stairs"));
    flat.heights = Float32Array.from(flat.heights, (_, i) => 5 + grid.point(i)[0] * .75);
    const steep = road("steep", "a", "b", Array.from({ length: 21 }, (_, i) => [i, 0]), { grade: "stair" });
    assert(steep.maxGrade > .7);
    assert(validateRoads(synthetic, flat, [steep]).some(i => i.kind === "stair-grade"));
});

test("Summit survey and height marks use the finished terrain", () => {
    const design = syntheticDesign(), b = design.buildings[0];
    b.summit = true;
    design.inputs.A.value = 9;
    design.marks.push({ id: "A", label: "A", kind: "text", point: b.center, building: b.id, elevation: "{input:A}", showElevation: true, spot: true });
    const island = new Island(design), mark = island.resolved.marks[0];
    assert(mark.kind === "text");
    const summit = summitHeights(island.terrain.grid, island.graded.heights, b.center);
    assert(summit.ground !== undefined);
    assert.equal(summit.highest, summit.ground);
    assert.equal(markReading(island.view(), mark).difference, "");
    design.inputs.A.value = summit.ground + 2;
    const changed = new Island(design).resolved.marks[0];
    assert(changed.kind === "text");
    assert.match(markReading(island.view(), changed).difference!, /设计/);
});


test("Issue station bounds cover each offending interval", fixtureOptions("round14-land.json"), async () => {
    const original = await readFixture("round14-land.json");
    const author = parseDesign(original), baseline = new Island(author);
    // Validate station bounds independently against every contiguous run of offending intervals.
    for (const route of baseline.routes) {
        const rule = author.roadClasses[route.edge.grade];
        for (const kind of ["ramp-grade", "stair-grade"]) {
            let start = null;
            const expected = [];
            for (let i = 0; i <= route.stairs.length; i++) {
                const limit = kind === "stair-grade" ? rule.stairLimit : rule.rampLimit;
                const fails = limit != null && i < route.stairs.length && route.stairs[i] === (kind === "stair-grade") && route.peaks[i] > limit;
                if (fails && start == null)
                    start = route.s[i];
                if (!fails && start != null) {
                    expected.push([start, route.s[i]]);
                    start = null;
                }
            }
            const issues = baseline.issues.filter(i => i.kind === kind && i.road === route.id);
            assert.deepEqual(issues.map(i => [i.spans![0].from, i.spans![0].to]), expected);
            for (const issue of issues) {
                const [span] = issue.spans!, [shape] = issueShapes(baseline, issue);
                assert.deepEqual(shape.points[0], pointAt(route.points, route.s, span.from));
                assert.deepEqual(shape.points.at(-1)!, pointAt(route.points, route.s, span.to));
                assert(nearest(...issue.point, shape.points).distance < 1e-6);
            }
        }
    }
});

test("Overlap spans and building issue footprints", () => {
    const author = syntheticDesign(), baseline = new Island(author);
    const a = { id: "a", points: [[0, 0], [30, 0]] as Point[], s: new Float64Array(), edge: { ...author.edges[0], width: 2 } }, b = { id: "b", points: [[8, 2], [20, 2]] as Point[], s: new Float64Array(), edge: { ...author.edges[0], width: 2 } };
    for (const line of [a, b])
        line.s = stations(line.points);
    const [overlap] = overlappingLocations(a, b, [], { ...author.routing, clearance: 1, junctionRadius: 4, overlapLength: 5 }, true);
    assert.deepEqual(overlap.spans.map(s => s.road), ["a", "b"]);
    assert(Math.abs(overlap.spans[0].from - (8 - Math.sqrt(5))) < 1e-8);
    assert(Math.abs(overlap.spans[0].to - (20 + Math.sqrt(5))) < 1e-8);
    assert.deepEqual(overlap.spans[1], { road: "b", from: 0, to: 12 });
    const structure = author.buildings[0];
    const footprintIssue: Issue = { message: "", severity: "error", building: structure.id, point: structure.center, kind: "building" };
    assert.deepEqual(issueShapes(baseline, footprintIssue)[0], { points: buildingShape(structure).polygon, closed: true });
    assert(objectIssues({ ...baseline, issues: [footprintIssue] }, { kind: "building", id: structure.id }).includes(footprintIssue));
});
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { makeShape, makeShapeData, rasterRegion, rebuildShape, shapeData, type RegionShape } from "../src/core/design/regions.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { type Construction, type GeoNode, type Point } from "../src/core/design/v5.ts";
import { random } from "../src/core/math/noise.ts";
import { createGrid } from "../src/core/math/geometry.ts";
import { Project } from "../src/core/project.ts";
import { nodePool } from "../src/compute/nodePool.ts";
import { ThreadPool } from "../src/compute/pool.ts";
import { countBlocks, type CountBlocks } from "./parallelBlocks.ts";
import { erosion, layer, polygon, rect, resolvedRect, syntheticDesign } from "./scenarios.ts";

function geometry(id: string, construction: Construction<number, "resolved">): GeoNode<number, "resolved"> {
    return { id, label: id, field: "height", construction, function: { type: "ground", value: 0 } };
}

test("Free scanlines use the same even-odd mask and row-major cells as individual point tests", () => {
    const grid = createGrid({ xMin: -6, xMax: 6, yMin: -6, yMax: 6, step: 1 });
    const a = polygon([[-4.5, -3.5], [5.5, -3.5], [5.5, -1.5], [.5, -1.5], [.5, 3.5], [-4.5, 3.5]]);
    const b = polygon([[-4.5, -4.5], [4.5, 4.5], [4.5, -4.5], [-4.5, 4.5]]);
    const hole = resolvedRect(-3.5, -2.5, -1.5, 1.5).outlines[0], overlap = resolvedRect(-2.5, -2.5, 1.5, .5).outlines[0];
    const sliver = polygon([[.5 - 1e-14, -1.5], [.5 + 1e-14, -1.5], [.5 + 1e-15, 4.5]]);
    for (const outlines of [[a], [b], [a, hole, overlap], [a, b, sliver], [sliver]]) {
        const shape = makeShape(geometry("A", { type: "outline", outlines }), new Map(), grid.step / 8);
        const region = rasterRegion(grid, shape), { left, top, width, height } = region;
        const mask = new Uint8Array(region.mask.length), cells: number[] = [];
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const inside = shape.contains([grid.x(left + i), grid.y(top + j)]);
                mask[j * width + i] = +inside;
                if (inside) cells.push((top + j) * grid.width + left + i);
            }
        }
        assert.deepEqual(region.mask, mask);
        assert.deepEqual([...region.cells], cells);
    }
});

test("A cloned ShapeData rebuilds outlines, strip sides and multi-level strip geometry", () => {
    const tolerance = .12, original = new Map<string, RegionShape>(), rebuilt = new Map<string, RegionShape>(), next = random(32);
    const nodes = [
        geometry("A", resolvedRect(-20, -10, 2, 18)),
        geometry("B", resolvedRect(2, -10, 16, 18)),
        geometry("C", { type: "strip", of: ["A", "B"], widths: [4, 5] }),
        geometry("D", { type: "strip", of: ["C"], widths: [3, 2] }),
        geometry("E", { type: "strip", of: ["B", "C"], widths: [2, 1] })
    ];
    for (const n of nodes) {
        const shape = makeShape(n, original, tolerance), data = structuredClone(makeShapeData(n, original, tolerance));
        const copy = rebuildShape(data, rebuilt, tolerance);
        original.set(n.id, shape);
        rebuilt.set(n.id, copy);
        assert.deepEqual(copy.box, shape.box);
        assert.deepEqual(copy.spine, shape.spine);
        for (let i = 0; i < 400; i++) {
            const p: Point = [-22 + 44 * next(), -16 + 40 * next()];
            assert.equal(copy.contains(p), shape.contains(p));
            assert.deepEqual(copy.cross?.(p), shape.cross?.(p));
            if (shape.cross) assert.equal(shape.contains(p), shape.cross(p) !== undefined);
        }
        assert.deepEqual(copy.boundary(), shape.boundary());
        const ready = structuredClone(shapeData(shape)!);
        const traced = rebuildShape(ready, rebuilt, tolerance);
        if (ready.type === "strip") assert.equal(traced.boundary(), ready.contour);
    }
});

test("The thread pool assigns every block once and recovers after a block throws", async () => {
    const workers = Array.from({ length: 3 }, () => new Worker(new URL("./parallelBlocks.ts", import.meta.url), { execArgv: [] }));
    try {
        await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
            worker.once("message", () => resolve());
            worker.once("error", reject);
        })));
        const pool = new ThreadPool(workers.map(worker => ({ send: message => worker.postMessage(message), close() {} })));
        function run(blocks: number, failAt?: number) {
            const counts = new Int32Array(new SharedArrayBuffer(blocks * 4));
            const task: CountBlocks = { kind: "count", counts, failAt };
            pool.run(task, blocks, countBlocks(task));
            return [...counts];
        }
        for (const blocks of [1, 2, 3, 17]) assert.deepEqual(run(blocks), Array(blocks).fill(1));
        assert.throws(() => run(7, 2), { name: "RangeError", message: "block 2" });
        assert.deepEqual(run(23), Array(23).fill(1));
    }
    finally {
        await Promise.all(workers.map(worker => worker.terminate()));
    }
});

function parallelDesign() {
    const d = syntheticDesign(), full = rect(-58, -43, 58, 43), left = rect(-56, -42, -3, 42);
    const shore = polygon([[-53, -39], [37, -35], [42, 31], [-47, 39]]);
    for (const node of shore.nodes) node.id = "shore-" + node.id;
    d.grid.step = .2;
    d.fields.F = { label: "F" };
    d.geoNodes = [
        layer("G", full, { type: "ground", value: 2 }),
        layer("F", left, { type: "ground", value: .8 }, "F"),
        layer("C", full, { type: "coast", shore: { curve: shore },
            roughness: "{field:F}", harbor: { center: [12, 30], radius: 6, span: 8 } }),
        layer("A", rect(-30, -25, 24, 23), { type: "flat", amount: 9 }),
        layer("B", { type: "strip", of: ["A"], widths: [12, 18] }, { type: "batter", grade: .2 }),
        layer("N", { type: "strip", of: ["B"], widths: [6, 6] }, { type: "flat", amount: "{field:F}" }),
        layer("L", full, { type: "cliff", factor: "{field:F} + 1.2" }),
        layer("I", full, { type: "islets", density: "{field:F}", reach: 25 }),
        layer("E", full, { ...erosion, strength: "{field:F}", spacing: .8 })
    ];
    return parseDesign(d);
}

function digest(data: Uint8Array | Int32Array | Float32Array) {
    return createHash("sha256").update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}

function hashes({ terrain, issues }: Project) {
    return {
        fields: Object.values(terrain.fields).map(f => [digest(f.values), digest(f.defined)]),
        shore: digest(terrain.shore), issues: createHash("sha256").update(JSON.stringify(issues)).digest("hex"),
        residuals: createHash("sha256").update(JSON.stringify([...terrain.batterResiduals])).digest("hex"),
        regions: [...terrain.regions.values()].map(r => [digest(r.cells), digest(r.mask)])
    };
}

test("Mixed terrain, its diagnostics and its compact regions are bit-identical across thread counts", async () => {
    const design = parallelDesign(), serial = new Project(design);
    assert(serial.terrain.batterResiduals.has("B"));
    const expected = hashes(serial);
    for (const count of [1, 3]) {
        const pool = await nodePool(count);
        try {
            const threaded = new Project(design, undefined, undefined, pool);
            assert(pool.dispatchTime > 0);
            assert.deepEqual(hashes(threaded), expected);
            assert.deepEqual(threaded.terrain.regions.get("B")!.shape.boundary(), serial.terrain.regions.get("B")!.shape.boundary());
        }
        finally {
            pool.close();
        }
    }
});
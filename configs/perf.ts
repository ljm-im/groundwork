import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { readFixture, readRegressions } from "./read-fixture.ts";
import { Project } from "../src/core/project.ts";
import { parseDesign } from "../src/core/design/model.ts";
import { type Design, type GeoFunction } from "../src/core/design/v5.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";

const [file, spacing, ...extra] = process.argv.slice(2), step = Number(spacing);
if (file && (!Number.isFinite(step) || step <= 0 || extra.length))
    throw Error("Usage: pnpm perf [<design.json> <step>]");

const design = parseDesign(file ? await readFile(file, "utf8") : await readFixture("round14-coast.json"));
if (file) design.grid.step = step;
const cache = new TerrainCache();
const timings: Record<string, number> = {};
const ms = (duration: number) => +duration.toFixed(1);

function time<T>(name: string, fn: () => T) {
    const start = performance.now(), result = fn();
    timings[name] = ms(performance.now() - start);
    return result;
}

function layersByType(d: Design) {
    const totals = new Map<GeoFunction["type"], number>();
    for (const node of d.geoNodes) {
        const elapsed = cache.layerTimings.get(node.id);
        if (elapsed !== undefined) totals.set(node.function.type, (totals.get(node.function.type) ?? 0) + elapsed);
    }
    return Object.fromEntries([...totals].map(([type, elapsed]) => [type, ms(elapsed)]));
}

const model = time("首次生成地形及校验", () => new Project(design, cache));
const cold = { makeShape: ms(cache.makeShapeTime), layers: layersByType(design) };
if (!file) {
    const { fixtures } = await readRegressions(), variable = fixtures.coast.variables[0];
    if (!Object.hasOwn(design.inputs, variable)) throw Error("Unknown performance scenario in .local/fixtures/regressions.json");
    design.inputs[variable].value = Number(design.inputs[variable].value) + .5;
    time("自定义输入预览", () => model.update());
}

console.table(timings);
console.table({ makeShape: cold.makeShape, ...cold.layers });
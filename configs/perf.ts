import { performance } from "node:perf_hooks";
import { readFixture, readRegressions } from "./read-fixture.ts";
import { Project } from "../src/core/project.ts";
import { parseDesign } from "../src/core/design/model.ts";

const design = parseDesign(await readFixture("round14-coast.json"));
const { fixtures } = await readRegressions();
const variable = fixtures.coast.variables[0];
const timings: Record<string, number> = {};

function time<T>(name: string, fn: () => T) {
    const t = performance.now(),
        result = fn();
    timings[name] = +(performance.now() - t).toFixed(1); return result;
}

const model = time("首次生成地形及校验", () => new Project(design));
if (!Object.hasOwn(design.inputs, variable)) throw Error("Unknown performance scenario in .local/fixtures/regressions.json");
design.inputs[variable].value = Number(design.inputs[variable].value) + .5;
time("自定义输入预览", () => model.update());
console.table(timings);
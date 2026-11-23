import { performance } from "node:perf_hooks";
import { readFixture, readRegressions } from "./read-fixture.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign } from "../src/core/design/model.ts";

const design = parseDesign(await readFixture("round14-coast.json"));
const { perfEdge, fixtures } = await readRegressions();
const variable = fixtures.coast.variables[0];
const timings: Record<string, number> = {};

function time<T>(name: string, fn: () => T) {
    const t = performance.now(),
        result = fn();
    timings[name] = +(performance.now() - t).toFixed(1); return result;
}

const model = time("首次生成（含侵蚀、植被、路网及校验）", () => new Island(design));
console.table(model.routes.map(r => ({
    道路: r.edge.label,
    "长度 m": +r.length.toFixed(1),
    "落差 m": +r.drop.toFixed(1),
    "最陡 %": +(r.maxGrade * 100).toFixed(1),
    台阶段数: r.stairRuns,
    "台阶 m": +r.stairLength.toFixed(1),
    绕路比: +r.detour.toFixed(2),
    校验: model.issues.filter(i => i.road === r.id || i.other === r.id).map(i => i.message).join(" / ") || "通过"
})));
time("全部重新选线", () => model.reroute());
const edge = design.edges.find(e => e.id === perfEdge);
if (!edge || !Object.hasOwn(design.inputs, variable)) throw Error("Unknown performance scenario in .local/fixtures/regressions.json");
time(`单条边重算（${edge.label}）`, () => model.reroute(new Set([edge.id])));
design.inputs[variable].value = Number(design.inputs[variable].value) + .5;
time("自定义输入预览（保持线形）", () => model.inputs());
console.table(timings);
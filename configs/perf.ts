import { performance } from "node:perf_hooks";
import { readFixture } from "./read-fixture.ts";
import { Island } from "../src/core/island.ts";
import { parseDesign } from "../src/core/design/model.ts";

const design = parseDesign(await readFixture("round4.json"));
const timings: Record<string, number> = {};

function time<T>(name: string, fn: () => T) {
    const t = performance.now(),
        result = fn();
    timings[name] = +(performance.now() - t).toFixed(1); return result;
}

const model = time("首次生成（含侵蚀、植被、路网及校验）", () => new Island(design));
console.table(model.routes.map(r => ({
    道路: r.edge.name,
    "长度 m": +r.length.toFixed(1),
    "落差 m": +r.drop.toFixed(1),
    "最陡 %": +(r.maxGrade * 100).toFixed(1),
    台阶段数: r.stairRuns,
    "台阶 m": +r.stairLength.toFixed(1),
    绕路比: +r.detour.toFixed(2),
    校验: model.issues.filter(i => i.road === r.id || i.other === r.id).map(i => i.message).join(" / ") || "通过"
})));
time("全部重新选线", () => model.reroute());
time("单条边重算（林间路）", () => model.reroute(new Set(["forest"])));
design.levels.H += .5;
time("标高预览（保持线形）", () => model.levels());
console.table(timings);
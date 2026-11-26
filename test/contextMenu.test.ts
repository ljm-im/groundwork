import { resolveDesign } from "../src/core/design/parameters.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextMenuColumns, issueMenuColumns } from "../src/app/state/contextMenu.ts";
import { type GeoControl } from "../src/core/edit/geoControls.ts";
import { defaultFunction, holdPoint } from "../src/core/edit/geoNodes.ts";
import { type Selection } from "../src/core/edit/types.ts";
import { type Point } from "../src/core/design/v5.ts";
import { fixtureMark, fixtureSection, withNodeSlope, literalCurve, addLayer, openCurve, rect, syntheticDesign, fixtureCurve, fixtureFunction } from "./scenarios.ts";

const selection = (id: string): Selection => ({ kind: "geoNode", id });
const hit = (role: GeoControl["role"], path = 0, index = 0): GeoControl => ({ role, path, index, point: [0, 0] });
const titles = (columns: ReturnType<typeof contextMenuColumns>) => columns.map(column => column.map(group => group.title));
const names = (columns: ReturnType<typeof contextMenuColumns>) => columns.map(column => column.flatMap(group => group.items.map(item => item.name)));

test("Contour, curve and region menus follow the actual geometry and semantic owners", () => {
    const d = syntheticDesign(), n = d.geoNodes[1];
    assert(n.construction.type === "outline");
    n.construction.outlines.push(fixtureCurve(d, rect(-16, -10, -13, -5).outlines[0]));
    const menu = (control?: GeoControl) => contextMenuColumns(resolveDesign(d), selection("T"), true, control);
    const semantic = ["轮廓 2", "区域", "地件"], curveActions = ["全部节点改为自动平滑", "全部线段改为直线"];
    for (const role of ["vertex", "in", "out"] as const) {
        const groups = menu(hit(role, 1));
        assert.deepEqual(titles(groups), [["节点类型", "节点", "闭合曲线"], semantic]);
        const handleAction = role === "vertex" ? [] : ["收回控制柄"];
        assert.deepEqual(names(groups), [["尖角", "自动平滑", "手动平滑", ...handleAction, "删除节点", ...curveActions],
            ["删除轮廓", "添加轮廓", "复制地件", "禁用地件", "删除地件"]]);
        assert.equal(groups[0][0].items[0].selected, true);
    }
    for (const role of ["segment", "arc"] as const) {
        const path = literalCurve(d, n.construction.outlines[1]);
        path.nodes[0].bulge = .5;
        const groups = menu(hit(role, 1));
        assert.deepEqual(titles(groups), [["线段类型", "线段", "闭合曲线"], semantic]);
        assert.deepEqual(groups[0][0].items.map(i => i.name), ["直线", "曲线", "圆弧"]);
        assert.deepEqual(groups[0][1].items.map(i => i.name), ["插入节点", "相切", "删除线段"]);
        assert.equal(groups[0][0].items[2].selected, true);
        assert.equal(groups[0][1].items[1].disabled, false);
        assert.equal(menu(hit("vertex", 1))[0][0].items[2].disabled, true);
    }
    assert.deepEqual(titles(menu(hit("body"))), [["区域", "地件"]]);
    assert.deepEqual(titles(menu(hit("outline", 1))), [["轮廓 2", "区域", "地件"]]);
    assert.deepEqual(names(menu(hit("outline", 1))), [["删除轮廓", "添加轮廓", "复制地件", "禁用地件", "删除地件"]]);
    n.construction.outlines.pop();
    literalCurve(d, n.construction.outlines[0]).nodes.pop();
    assert.deepEqual(titles(menu(hit("vertex"))), [["节点类型", "闭合曲线"], ["区域", "地件"]]);
    assert.deepEqual(menu(hit("segment"))[0][1].items.map(i => i.name), ["插入节点"]);
    assert.deepEqual(titles(menu(hit("outline"))), [["区域", "地件"]]);
    d.geoNodes.push(addLayer(d, "S", { type: "strip", of: ["T"], widths: [1, 2] }, { type: "blend" }));
    const strip = contextMenuColumns(resolveDesign(d), selection("S"), true, hit("body"));
    assert.deepEqual(titles(strip), [["区域", "地件"]]);
    assert.deepEqual(names(strip), [["重选边", "复制地件", "禁用地件", "删除地件"]]);
});

test("Parameter geometry menus show member operations for profiles and peaks", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], mountain = defaultFunction(d, "mountain");
    const points: Point[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const ridge = withNodeSlope(openCurve(points.map(p => ({ p, h: 0 }))), 1);
    ridge.nodes[0].bulge = .5;
    assert(mountain.type === "mountain");
    n.function = mountain;
    mountain.ridges.push(fixtureCurve(d, { curve: withNodeSlope(ridge, 2) }, ["h", "slope"]), fixtureCurve(d, { curve: ridge }, ["h", "slope"]));
    mountain.peaks.push({ at: holdPoint(d, [0, 0]), height: 3, radius: 18, noise: 0, scale: 1 });
    const menu = (control?: GeoControl) => contextMenuColumns(resolveDesign(d), selection("T"), true, control);
    const first = menu(hit("segment", -2, 0));
    assert.deepEqual(titles(first), [["线段类型", "线段", "曲线"], ["山脊 2", "地件"]]);
    assert.deepEqual(names(first)[1].slice(0, 2), ["复制山脊", "删除山脊"]);
    assert.equal(first[0][1].items.find(i => i.id === "tangent")?.disabled, true);
    assert(names(first)[0].includes("删除线段"));
    assert(!names(menu(hit("segment", -2, 1)))[0].includes("删除线段"));
    assert.deepEqual(titles(menu(hit("vertex", -2, 1))), [["节点类型", "节点", "曲线"], ["山脊 2", "地件"]]);
    const peak = menu(hit("parameter", 2));
    assert.deepEqual(titles(peak), [["山峰 1", "地件"]]);
    assert.deepEqual(names(peak)[0].slice(0, 2), ["复制山峰", "删除山峰"]);
    literalCurve(d, mountain.ridges[1]).closed = true;
    ridge.closed = true;
    assert.deepEqual(titles(menu(hit("segment", -2, 3))), [["线段类型", "线段", "闭合曲线"], ["山脊 2", "地件"]]);

    const slope = structuredClone(ridge);
    slope.nodes.forEach(n => delete n.slope);
    n.function = fixtureFunction(d, { type: "slope", kind: "path", lines: [{ curve: slope }], center: [0, 0], radius: 5, value: 2, rate: -.2 });
    assert.deepEqual(titles(menu(hit("segment", -1, 3))), [["线段类型", "线段", "闭合曲线"], ["坡线 1", "地件"]]);
    assert(n.function.type === "slope");
    literalCurve(d, n.function.lines[0]).closed = false;
    assert.deepEqual(titles(menu(hit("vertex", -1, 1))), [["节点类型", "节点", "曲线"], ["坡线 1", "地件"]]);
    n.function = defaultFunction(d, "coast", { shore: rect(0, 0, 4, 4).outlines[0].curve, center: [0, 0] });
    assert.deepEqual(titles(menu(hit("segment", -1))), [["线段类型", "线段", "闭合曲线"], ["地件"]]);
    assert.deepEqual(titles(menu(hit("parameter"))), [["地件"]]);
});

test("Issue menus use their severity group and only reveal the issue", () => {
    for (const [severity, title] of [["warning", "警告"], ["error", "错误"]] as const) {
        const menu = issueMenuColumns({ kind: "test", severity, point: [1, 2], message: "test" });
        assert.deepEqual(titles(menu), [[title]]);
        assert.deepEqual(names(menu), [["在视野中显示"]]);
        assert.equal(menu[0][0].items[0].icon, "fit");
    }
});

test("List menus put reveal first and name every semantic operation", () => {
    const d = syntheticDesign();
    d.geoNodes[1].disabled = true;
    d.marks = [
        fixtureMark(d, { kind: "text", id: "A", label: "A", point: [0, 0], follow: "map" }),
        fixtureMark(d, { kind: "scale", id: "B", label: "B", point: [20, 20], follow: "screen" })
    ];
    d.sections = [fixtureSection(d, { id: "C", label: "C", points: [[0, 0], [3, 0]] })];
    for (const [kind, id, title, operations] of [
        ["geoNode", "T", "地件", ["复制地件", "启用地件", "删除地件"]],
        ["section", "C", "剖面线", ["复制剖面线", "删除剖面线"]],
        ["mark", "A", "文字标记", ["复制文字标记", "删除文字标记"]],
        ["mark", "B", "比例尺", ["复制比例尺", "删除比例尺"]],
        ["input", "A", "输入", ["删除输入"]],
        ["field", "F", "场", ["删除场"]]
    ] as const) {
        const h = { kind, id }, menu = contextMenuColumns(resolveDesign(d), h, false), reveal = kind === "input" || kind === "field" ? [] : ["在视野中显示"];
        assert.deepEqual(titles(menu), [[title]]);
        assert.deepEqual(names(menu), [[...reveal, ...operations]]);
        assert.equal(menu[0][0].items.at(-1)?.danger, true);
        if (kind === "mark" || kind === "section") assert.deepEqual(names(contextMenuColumns(resolveDesign(d), h, true)), [operations]);
    }
    assert.deepEqual(contextMenuColumns(resolveDesign(d), { kind: "input", id: "seed" }, false), []);
    assert.deepEqual(contextMenuColumns(resolveDesign(d), { kind: "field", id: "height" }, false), []);
});
import assert from "node:assert/strict";
import { test } from "node:test";
import { contextMenuColumns, issueMenuColumns } from "../src/app/state/contextMenu.ts";
import { type GeoControl } from "../src/core/edit/geoControls.ts";
import { defaultFunction } from "../src/core/edit/geoNodes.ts";
import { type Selection } from "../src/core/edit/types.ts";
import { type Point } from "../src/core/design/v5.ts";
import { literalCurve, layer, openCurve, rect, syntheticDesign } from "./scenarios.ts";

const selection = (id: string): Selection => ({ kind: "geoNode", id });
const hit = (role: GeoControl["role"], path = 0, index = 0): GeoControl => ({ role, path, index, point: [0, 0] });
const titles = (columns: ReturnType<typeof contextMenuColumns>) => columns.map(column => column.map(group => group.title));
const names = (columns: ReturnType<typeof contextMenuColumns>) => columns.map(column => column.flatMap(group => group.items.map(item => item.name)));

test("Contour, curve and region menus follow the actual geometry and semantic owners", () => {
    const d = syntheticDesign(), n = d.geoNodes[1];
    assert(n.construction.type === "outline");
    n.construction.outlines.push(rect(-16, -10, -13, -5).outlines[0]);
    const menu = (control?: GeoControl) => contextMenuColumns(d, selection("T"), true, control);
    const semantic = ["轮廓 2", "区域", "地件"], curveActions = ["全部节点改为自动平滑", "全部线段改为直线"];
    for (const role of ["vertex", "in", "out"] as const) {
        const groups = menu(hit(role, 1));
        assert.deepEqual(titles(groups), [["节点类型", "节点", "闭合曲线"], semantic]);
        const handleAction = role === "vertex" ? [] : ["收回控制柄"];
        assert.deepEqual(names(groups), [["尖角", "自动平滑", "手动平滑", ...handleAction, "删除节点", ...curveActions],
            ["复制轮廓", "删除轮廓", "添加轮廓", "复制地件", "禁用地件", "删除地件"]]);
        assert.equal(groups[0][0].items[0].selected, true);
    }
    for (const role of ["segment", "arc"] as const) {
        const path = literalCurve(n.construction.outlines[1]);
        path.nodes[0].bulge = .5;
        const groups = menu(hit(role, 1));
        assert.deepEqual(titles(groups), [["线段类型", "线段", "闭合曲线"], semantic]);
        assert.deepEqual(names(groups)[0], ["直线", "曲线", "圆弧", "相切", "插入节点", "删除线段", ...curveActions]);
        assert.equal(groups[0][0].items[2].selected, true);
        assert.equal(groups[0][0].items[3].disabled, false);
        assert.equal(menu(hit("vertex", 1))[0][0].items[2].disabled, true);
    }
    assert.deepEqual(titles(menu(hit("body"))), [["区域", "地件"]]);
    assert.deepEqual(titles(menu(hit("outline", 1))), [["轮廓 2", "区域", "地件"]]);
    assert.deepEqual(names(menu(hit("outline", 1))), [["复制轮廓", "删除轮廓", "添加轮廓", "复制地件", "禁用地件", "删除地件"]]);
    n.construction.outlines.pop();
    literalCurve(n.construction.outlines[0]).nodes.pop();
    assert.deepEqual(titles(menu(hit("vertex"))), [["节点类型", "闭合曲线"], ["轮廓 1", "区域", "地件"]]);
    assert(!names(menu(hit("segment")))[0].includes("删除线段"));
    assert.deepEqual(titles(menu(hit("outline"))), [["轮廓 1", "区域", "地件"]]);
    d.geoNodes.push(layer("S", { type: "strip", of: ["T"], widths: [1, 2] }, { type: "blend" }));
    const strip = contextMenuColumns(d, selection("S"), true, hit("body"));
    assert.deepEqual(titles(strip), [["区域", "地件"]]);
    assert.deepEqual(names(strip), [["重选边", "复制地件", "禁用地件", "删除地件"]]);
});

test("Parameter geometry menus show member operations only for ridges and peaks", () => {
    const d = syntheticDesign(), n = d.geoNodes[1], mountain = defaultFunction("mountain");
    const points: Point[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    const ridge = openCurve(points.map(p => ({ p })));
    ridge.nodes[0].bulge = .5;
    assert(mountain.type === "mountain");
    n.function = mountain;
    mountain.ridges.push({ line: structuredClone(ridge), slope: 2 }, { line: ridge, slope: 1 });
    mountain.peaks.push({ at: { p: [0, 0], h: 3 }, radius: 18, noise: 0, scale: 1 });
    const menu = (control?: GeoControl) => contextMenuColumns(d, selection("T"), true, control);
    const first = menu(hit("segment", -2, 0));
    assert.deepEqual(titles(first), [["线段类型", "线段", "曲线"], ["山脊 2", "地件"]]);
    assert.deepEqual(names(first)[1].slice(0, 2), ["复制山脊", "删除山脊"]);
    assert.equal(first[0][0].items.find(i => i.id === "tangent")?.disabled, true);
    assert(names(first)[0].includes("删除线段"));
    assert(!names(menu(hit("segment", -2, 1)))[0].includes("删除线段"));
    assert.deepEqual(titles(menu(hit("vertex", -2, 1))), [["节点类型", "节点", "曲线"], ["山脊 2", "地件"]]);
    const peak = menu(hit("parameter", 2));
    assert.deepEqual(titles(peak), [["山峰 1", "地件"]]);
    assert.deepEqual(names(peak)[0].slice(0, 2), ["复制山峰", "删除山峰"]);
    ridge.closed = true;
    assert.deepEqual(titles(menu(hit("segment", -2, 3))), [["线段类型", "线段", "闭合曲线"], ["山脊 2", "地件"]]);

    n.function = { type: "slope", kind: "path", line: ridge };
    assert.deepEqual(titles(menu(hit("segment", -1, 3))), [["线段类型", "线段", "闭合曲线"], ["地件"]]);
    ridge.closed = false;
    assert.deepEqual(titles(menu(hit("vertex", -1, 1))), [["节点类型", "节点", "曲线"], ["地件"]]);
    n.function = defaultFunction("coast", { shore: rect(0, 0, 4, 4).outlines[0], center: [0, 0] });
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
        { kind: "text", id: "A", label: "A", point: [0, 0], follow: "map" },
        { kind: "scale", id: "B", label: "B", point: [20, 20], follow: "screen" }
    ];
    d.sections = [{ id: "C", label: "C", points: [[0, 0], [3, 0]] }];
    for (const [kind, id, title, operations] of [
        ["geoNode", "T", "地件", ["复制地件", "启用地件", "删除地件"]],
        ["section", "C", "剖面线", ["删除剖面线"]],
        ["mark", "A", "文字标记", ["复制文字标记", "删除文字标记"]],
        ["mark", "B", "比例尺", ["复制比例尺", "删除比例尺"]],
        ["input", "A", "输入", ["删除输入"]],
        ["field", "F", "场", ["删除场"]]
    ] as const) {
        const h = { kind, id }, menu = contextMenuColumns(d, h, false), reveal = kind === "input" || kind === "field" ? [] : ["在视野中显示"];
        assert.deepEqual(titles(menu), [[title]]);
        assert.deepEqual(names(menu), [[...reveal, ...operations]]);
        assert.equal(menu[0][0].items.at(-1)?.danger, true);
        if (kind === "mark" || kind === "section") assert.deepEqual(names(contextMenuColumns(d, h, true)), [operations]);
    }
    assert.deepEqual(contextMenuColumns(d, { kind: "input", id: "seed" }, false), []);
    assert.deepEqual(contextMenuColumns(d, { kind: "field", id: "height" }, false), []);
});
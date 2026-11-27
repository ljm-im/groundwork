import { displayReading, displayValue } from "../../core/design/display.ts";
import { fieldPrecision } from "../../core/design/defaults.ts";
import { displaySteps, gridStep } from "../../core/design/functionTable.ts";
import { type GeoDraft } from "../../core/edit/types.ts";
import { type FieldDeclaration, type Point } from "../../core/design/v5.ts";
import { type FieldSamples } from "../../core/design/results.ts";
import { type GridSpec } from "../../core/math/geometry.ts";
import { type Tool } from "../types.ts";

const lineEnd = "回车或双击结束，单击首个节点闭合";
const continueEnd = "回车或双击完成，单击另一端闭合";
const pickCurveHint = "单击曲线换用它，单击空白处开始画，按住 Ctrl 单击在曲线上开始画，Esc 取消";

export type HintGlyph = { key: string } | { mouse: "left" | "right" | "middle" | "wheel" } | "plus" | "or";
export interface HintItem { glyphs: HintGlyph[]; text: string; primary?: boolean }

const left = { mouse: "left" } as const;
const right = { mouse: "right" } as const;
const esc = { key: "Esc" }, enter = { key: "Enter" }, alt = { key: "Alt" }, shift = { key: "Shift" }, ctrl = { key: "Ctrl" };
const hint = (text: string, glyphs: HintGlyph[], primary = false): HintItem => ({ glyphs, text, primary });
const cancel = hint("取消", [esc], true);
const node = hint("放置节点", [left], true);
const square = hint("画正方形", [shift]), noSnap = hint("不吸附", [ctrl]);
const penControls = [hint("切换尖角和自动平滑", [{ key: "S" }]), hint("约束方向", [shift]), noSnap];
const alternate = hint("选被遮住的地件", [alt, "plus", left]);
const navigate = [
    hint("拖动平移", [{ mouse: "middle" }, "or", { key: "Space" }, "plus", left]),
    hint("缩放", [{ mouse: "wheel" }])
];
const closedPen = [node, hint("闭合", [enter], true), cancel, hint("双击或单击首个节点闭合", [left]), ...penControls];
const lineEndHints = [node, hint("结束", [enter], true), cancel, hint("双击结束", [left])];
const line = [...lineEndHints, hint("单击首个节点闭合", [left]), ...penControls];
const radius = hint("拖出半径，或单击圆心和圆周", [left], true);
const finishAngle = hint("确定终止角", [left], true);
const point = (label: string) => [hint("放置" + label, [left], true), cancel];

export const hints: Record<Tool, readonly HintItem[]> = {
    select: [hint("逐层选中", [left], true), hint("回到上一层", [esc], true),
        hint("切换重叠的对象", [alt, "plus", left], true), hint("打开菜单", [right])],
    pen: closedPen,
    rect: [hint("拖动或单击两个对角", [left], true), cancel, square, noSnap],
    circle: [radius, cancel],
    sector: [radius, hint("再单击确定终止角", [left], true), cancel],
    strip: [hint("单击要沿的地件", [left], true), cancel, alternate],
    addOutline: closedPen,
    shore: closedPen,
    ridge: line,
    valley: line,
    slopeLine: line,
    peak: point("山峰"),
    center: point("圆心"),
    harbor: point("港湾圆心"),
    textMark: point("文字标记"),
    scaleMark: point("比例尺"),
    section: [hint("单击起点和终点", [left], true), cancel],
    geometryPoint: point("点"),
    geometryCurve: [node, hint("双击结束", [left], true), cancel],
    geometryClosed: closedPen,
    redrawCurve: line,
    continueCurve: [node, hint("完成", [enter], true), hint("放弃这次加的节点", [esc], true),
        hint("双击完成", [left]), hint("单击另一端闭合", [left]), hint("删除上一个节点", [{ key: "Backspace" }]), ...penControls]
};
const pickCurve = [hint("单击曲线换用它", [left], true), hint("单击空白处开始画", [left], true), cancel,
    hint("在曲线上开始画", [ctrl, "plus", left])];

export function drawingStatus(mode: Exclude<Tool, "select">, name: string, owner?: string, member?: number, names: string[] = [], curve?: GeoDraft["curve"]) {
    const label = "“" + name + "”", pen = "回车、双击或单击首点结束", point = "单击地图放置";
    const text: Record<Exclude<Tool, "select">, [string, string, boolean]> = {
        pen: ["新建地件（钢笔）", pen, true],
        rect: ["新建地件（矩形）", "单击或拖出两个对角", false],
        circle: ["新建地件（圆）", "单击或拖出圆心和半径", false],
        sector: ["新建地件（扇形）", "单击圆心和圆周，再单击终止角", false],
        strip: owner ? ["重选" + label + "的边", "单击起止节点，Tab 交换，回车确认", true] :
            ["新建地件（条带）", names.length ? "沿" + names.map(name => "“" + name + "”").join("、") + "，回车确认" : "单击要沿的地件", true],
        addOutline: ["给" + label + "添加轮廓", pen, true],
        shore: ["重画" + label + "的海岸线", pen, true],
        ridge: [member === undefined ? "给" + label + "添加山脊" : "重画" + label + "的山脊线", lineEnd, true],
        valley: [member === undefined ? "给" + label + "添加山谷" : "重画" + label + "的山谷线", lineEnd, true],
        peak: [member === undefined ? "给" + label + "添加山峰" : "移动" + label + "的山峰", point, false],
        slopeLine: [member === undefined ? "给" + label + "添加坡线" : "重画" + label + "的坡线", lineEnd, true],
        center: ["选择" + label + "的圆心", point, false],
        harbor: ["选择" + label + "的港湾圆心", point, false],
        textMark: ["新建文字标记", point, false],
        scaleMark: ["新建比例尺", point, false],
        section: ["新建剖面线", "单击起点和终点", false],
        geometryPoint: ["新建点", "单击地图放置", false],
        geometryCurve: ["新建曲线", "单击添加节点，双击结束", true],
        geometryClosed: ["新建闭合曲线", pen, true],
        redrawCurve: [curve?.redrawTitle ?? "重画" + label, curve?.requiredClosed ? pen : curve?.openOnly ? "单击添加节点，双击结束" : lineEnd, true],
        continueCurve: ["继续画" + label, continueEnd + "，Esc 取消", true]
    };
    if (curve?.pick) return { title: "选取或重画" + curve.pick.label, end: pickCurveHint, finish: false, owner, member };
    const [title, end, finish] = text[mode];
    return { title, end, finish, owner, member };
}

function stripHints(draft: GeoDraft) {
    const swap = hint("交换方向", [{ key: "Tab" }], true);
    const confirm = hint("确认", [enter], true);
    const range = hint("单击起止节点只取一段", [left], true);
    if (draft.anchors.length === 1) return [hint("单击终止节点", [left], true), cancel];
    if (draft.anchors.length === 2) return [swap, confirm, cancel];
    if (draft.owner) return [hint("单击起止节点", [left], true), swap, confirm, { ...cancel, primary: false }];
    if (draft.ids.length === 1) return [hint("单击另一个地件改沿公共边", [left], true), range, cancel,
        hint("取整圈", [enter]), alternate];
    if (draft.ids.length === 2) return [range, hint("取整条公共边", [enter], true), cancel];
    return hints.strip;
}

export function drawingHint(tool: Tool, draft?: GeoDraft): HintItem[] {
    let items = hints[tool];
    if (draft?.curve?.pick) items = pickCurve;
    else if (draft?.radius) items = [finishAngle, cancel];
    else if (draft?.sizing) items = tool === "rect" ? [hint("确定对角", [left], true), cancel, square, noSnap] :
        [hint("确定半径", [left], true), cancel];
    else if (tool === "redrawCurve" && draft?.curve?.requiredClosed) items = closedPen;
    else if (tool === "redrawCurve" && draft?.curve?.openOnly) items = [...lineEndHints, ...penControls];
    else if (tool === "strip" && draft) items = stripHints(draft);
    return [...items, ...navigate];
}

export function numberPreviewHint(step: number): HintItem[] {
    const spacing = Number(displayValue(step, gridStep.step));
    return [hint("拖动中按 " + spacing + " " + gridStep.unit + " 间距预览", [], true)];
}

export function readingRange(samples?: FieldSamples): [number, number] | undefined {
    if (!samples) return;
    let min = Infinity, max = -Infinity;
    for (const [i, value] of samples.values.entries()) {
        if (!samples.defined[i] || !Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    if (min <= max) return [min, max];
}

export function positionReadings(cursor: { point: Point; sample?: number } | undefined, field: FieldDeclaration | undefined,
    grid?: GridSpec, range?: [number, number]) {
    if (!field) return [];
    const coord = (value?: number) => displayReading(value, displaySteps.coordinates, displaySteps.coordinateUnit);
    const sample = (value?: number) => displayReading(value, fieldPrecision(field), field.unit);
    return [
        { label: "X", min: coord(grid?.xMin), max: coord(grid?.xMax), value: coord(cursor?.point[0]) },
        { label: "Y", min: coord(grid?.yMin), max: coord(grid?.yMax), value: coord(cursor?.point[1]) },
        { label: field.label, min: sample(range?.[0]), max: sample(range?.[1]), value: sample(cursor?.sample) }
    ];
}
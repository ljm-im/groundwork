import { displayReading, displayValue } from "../../core/design/display.ts";
import { fieldPrecision } from "../../core/design/defaults.ts";
import { displaySteps, gridStep } from "../../core/design/functionTable.ts";
import { type GeoDraft } from "../../core/edit/types.ts";
import { type FieldDeclaration, type Point } from "../../core/design/v5.ts";
import { type FieldSamples } from "../../core/design/results.ts";
import { type GridSpec } from "../../core/math/geometry.ts";
import { type Tool } from "../types.ts";

const lineEnd = "回车或双击结束，单击首个节点闭合";
const penHint = "单击放置节点，按 S 切换尖角和自动平滑，按住 Shift 约束方向，按住 Ctrl 不吸附，";
const closedPenHint = penHint + "回车、双击或单击首点闭合";
const lineHint = penHint + lineEnd;
const continueEnd = "回车或双击完成，单击另一端闭合";

const hints: Record<Tool, string> = {
    select: "单击选择，Alt 单击选择下层，中键或按住空格拖动平移，滚轮缩放",
    pen: closedPenHint,
    rect: "拖动或单击矩形的两个对角，按住 Shift 画正方形，按住 Ctrl 不吸附",
    circle: "拖出半径或单击圆心和圆周",
    sector: "拖出半径或单击圆心和圆周，再单击确定终止角",
    strip: "单击要沿的地件，按住 Alt 单击可选被遮住的地件",
    addOutline: closedPenHint,
    shore: closedPenHint,
    ridge: lineHint,
    valley: lineHint,
    slopeLine: lineHint,
    peak: "单击放置山峰",
    center: "单击选择圆心",
    harbor: "单击选择港湾圆心",
    textMark: "单击放置文字标记",
    scaleMark: "单击放置比例尺",
    section: "单击起点和终点",
    geometryPoint: "单击地图放置",
    geometryCurve: "单击添加节点，双击结束",
    geometryClosed: closedPenHint,
    redrawCurve: lineHint,
    continueCurve: penHint + continueEnd
};

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
    const [title, end, finish] = text[mode];
    return { title, end, finish, owner, member };
}

export function drawingHint(tool: Tool, draft?: GeoDraft, finish?: string) {
    if (tool === "select") return hints.select;
    if (draft?.radius) return "单击确定终止角，Esc 取消";
    if (draft?.sizing) return tool === "rect" ? "单击确定对角，按住 Shift 画正方形，按住 Ctrl 不吸附，Esc 取消" : "单击确定半径，Esc 取消";
    let hint = tool === "redrawCurve" && draft?.curve?.requiredClosed ? closedPenHint : hints[tool];
    if (tool === "strip" && draft) {
        if (draft.anchors.length === 1) hint = "单击终止节点";
        else if (draft.anchors.length === 2) hint = "Tab 交换方向，回车确认";
        else if (draft.owner) hint = finish ?? hint;
        else if (draft.ids.length === 1) hint = "单击另一个地件改沿公共边，单击起止节点只取一段，或回车取整圈";
        else if (draft.ids.length === 2) hint = "单击起止节点只取一段，或回车取整条公共边";
    }
    return hint + "，Esc 取消";
}

export function numberPreviewHint(step: number) {
    const spacing = Number(displayValue(step, gridStep.step));
    return "拖动中按 " + spacing + " " + gridStep.unit + " 间距预览";
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
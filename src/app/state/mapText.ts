import { displayReading } from "../../core/design/display.ts";
import { fieldPrecision } from "../../core/design/defaults.ts";
import { displaySteps } from "../../core/design/functionTable.ts";
import { type GeoDraft } from "../../core/edit/types.ts";
import { type FieldDeclaration, type Point } from "../../core/design/v5.ts";
import { type Tool } from "../types.ts";

const hints: Record<Tool, string> = {
    select: "单击选择，中键平移，滚轮缩放",
    pen: "单击放尖角，拖出控制柄，回车、双击或单击首点闭合",
    rect: "拖动或单击矩形的两个对角",
    circle: "拖出半径或单击圆心和圆周",
    sector: "拖出半径或单击圆心和圆周，再单击确定终止角",
    strip: "单击要沿的地件，按住 Alt 单击可选被遮住的地件",
    addPath: "单击放尖角，拖出控制柄，回车、双击或单击首点闭合",
    shore: "单击放点，回车、双击或单击首点闭合海岸线",
    ridge: "单击放置山脊顶点，回车或双击完成",
    slopeLine: "单击放置坡线顶点，回车或双击完成",
    peak: "单击放置山峰",
    center: "单击选择圆心",
    harbor: "单击选择港湾圆心",
    textMark: "单击放置文字标记",
    scaleMark: "单击放置比例尺",
    section: "单击起点和终点"
};

export function drawingStatus(mode: Exclude<Tool, "select">, name: string, owner?: string, member?: number, names: string[] = []) {
    const label = "“" + name + "”", pen = "回车、双击或单击首点结束", line = "回车或双击结束", point = "单击地图放置";
    const text: Record<Exclude<Tool, "select">, [string, string, boolean]> = {
        pen: ["新建地件（钢笔）", pen, true],
        rect: ["新建地件（矩形）", "单击或拖出两个对角", false],
        circle: ["新建地件（圆）", "单击或拖出圆心和半径", false],
        sector: ["新建地件（扇形）", "单击圆心和圆周，再单击终止角", false],
        strip: owner ? ["重选" + label + "的边", "单击起止节点，Tab 交换，回车确认", true] :
            ["新建地件（条带）", names.length ? "沿" + names.map(name => "“" + name + "”").join("、") + "，回车确认" : "单击要沿的地件", true],
        addPath: ["给" + label + "添加路径", pen, true],
        shore: ["重画" + label + "的海岸线", pen, true],
        ridge: [member === undefined ? "给" + label + "添加山脊" : "重画" + label + "的山脊线", line, true],
        peak: [member === undefined ? "给" + label + "添加山峰" : "移动" + label + "的山峰", point, false],
        slopeLine: ["重画" + label + "的坡线", line, true],
        center: ["选择" + label + "的圆心", point, false],
        harbor: ["选择" + label + "的港湾圆心", point, false],
        textMark: ["新建文字标记", point, false],
        scaleMark: ["新建比例尺", point, false],
        section: ["新建剖面线", "单击起点和终点", false]
    };
    const [title, end, finish] = text[mode];
    return { title, end, finish, owner, member };
}

export function drawingHint(tool: Tool, draft?: GeoDraft, finish?: string) {
    if (tool === "select") return hints.select;
    if (draft?.radius) return "单击确定终止角，Esc 取消";
    if (draft?.sizing) return tool === "rect" ? "单击确定对角，Esc 取消" : "单击确定半径，Esc 取消";
    let hint = hints[tool];
    if (tool === "strip" && draft) {
        if (draft.anchors.length === 1) hint = "单击终止节点";
        else if (draft.anchors.length === 2) hint = "Tab 交换方向，回车确认";
        else if (draft.owner) hint = finish ?? hint;
        else if (draft.ids.length === 1) hint = "单击另一个地件改沿公共边，单击起止节点只取一段，或回车取整圈";
        else if (draft.ids.length === 2) hint = "单击起止节点只取一段，或回车取整条公共边";
    }
    return hint + "，Esc 取消";
}

export function positionText(cursor: { point: Point; sample?: number } | undefined, field?: FieldDeclaration) {
    if (!cursor || !field) return "";
    const { point: [x, y], sample } = cursor;
    const coordinate = (value: number) => displayReading(value, displaySteps.coordinates, displaySteps.coordinateUnit);
    return "X " + coordinate(x) + "  Y " + coordinate(y) + "  " + field.label + " " +
        displayReading(sample, fieldPrecision(field), field.unit);
}
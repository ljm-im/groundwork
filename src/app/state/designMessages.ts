import { geoParameterName, type Address } from "../../core/design/parameters.ts";
import { DesignError, type DesignProblem } from "../../core/design/problems.ts";
import { gridStep, markParameters } from "../../core/design/functionTable.ts";
import { type Design } from "../../core/design/v5.ts";
import { errorText } from "../types.ts";

function geoProperty(path: Address) {
    const [group, item] = path;
    if (group === "field") return "输出到";
    if (group === "construction") {
        if (item === "of" || item === "range") return "边";
        if (item === "widths") return "条带宽度";
        return "区域";
    }
    if (group === "function") return item === "kind" ? "坡面形式" : "函数";
    if (group === "disabled") return "启用状态";
}

export function designProblemText({ location, message }: DesignProblem, d: Design) {
    if (!location) return message;
    const { kind, path } = location;
    const key = path[0];
    if (kind === "project") return key === "grid" ? gridStep.label + " " + message : message;
    const { id } = location;
    let label: string | undefined, property: string | undefined;
    if (kind === "geo") {
        const n = d.geoNodes.find(n => n.id === id);
        label = n?.label;
        property = (n && geoParameterName(d, n, path)) ?? geoProperty(path);
    }
    else if (kind === "mark") {
        const mark = d.marks.find(m => m.id === id);
        label = mark?.label;
        if (mark && key === markParameters[mark.kind].key[0]) property = markParameters[mark.kind].label;
        else if (key === "follow") property = "跟随";
    }
    else if (kind === "section") label = d.sections.find(s => s.id === id)?.label;
    else {
        label = (kind === "field" ? d.fields[id] : d.inputs[id])?.label;
        if (key === "unit") property = "单位";
        if (key === "range") property = "取值范围";
    }
    if (!property && key === "label") property = "标签";
    if (!property && key === "showLabel") property = "显示标签";
    return "“" + (label ?? id) + "”" + (property ? "." + property : "") + " " + message;
}

export function designErrorText(error: unknown, d: Design) {
    return error instanceof DesignError ? [...new Set(error.problems.map(problem => designProblemText(problem, d)))].join("\n") : errorText(error);
}
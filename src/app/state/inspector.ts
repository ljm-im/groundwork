import { type Selection } from "../../core/edit/types.ts";

const label = ["label", "标签与描述", "tag"] as const;
const issues = ["issues", "问题", "issues"] as const;
const single = [["general", "", "project"]] as const;
const tabs = {
    geoNode: [label, ["region", "区域", "region"], ["function", "函数", "function"], issues],
    section: [label, ["section", "剖面线", "section"]]
} as const;

export type PropertyTab = (typeof tabs)[keyof typeof tabs][number][0] | "general";
export type SubitemGroup = "ridges" | "peaks" | "advanced";

export function propertyTabs(selection: Selection | null) {
    switch (selection?.kind) {
        case "geoNode": return tabs.geoNode;
        case "section": return tabs.section;
        default: return single;
    }
}

export function tabForSelection(selection: Selection | null, current: PropertyTab): PropertyTab {
    const available = propertyTabs(selection);
    return available.some(([tab]) => tab === current) ? current : available[0][0];
}

export const nodeModes = [["corner", "尖角", "nodeCorner"], ["auto", "自动平滑", "nodeAuto"], ["manual", "手动平滑", "nodeManual"]] as const;
export const segmentTypes = [["line", "直线", "segmentLine"], ["curve", "曲线", "segmentCurve"], ["arc", "圆弧", "segmentArc"]] as const;
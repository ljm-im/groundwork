import { type Selection } from "../../core/edit/types.ts";

const label = ["label", "标签与描述", "tag"] as const;
const issues = ["issues", "校验", "issues"] as const;
const single = [["general", "", "project"]] as const;
const tabs = {
    geoNode: [label, ["region", "区域", "region"], ["function", "函数", "function"], issues],
    building: [label, ["building", "建筑", "building"], ["doors", "门", "door"], issues],
    edge: [label, ["edge", "道路", "edge"], issues],
    node: [label, ["node", "节点", "node"], issues],
    section: [label, ["section", "剖面线", "section"]]
} as const;

export type PropertyTab = (typeof tabs)[keyof typeof tabs][number][0] | "general";
export type SubitemGroup = "ridges" | "peaks" | "doors";

export function propertyTabs(selection: Selection | null) {
    switch (selection?.kind) {
        case "geoNode": return tabs.geoNode;
        case "building": return tabs.building;
        case "edge":
        case "via": return tabs.edge;
        case "node": return tabs.node;
        case "section": return tabs.section;
        default: return single;
    }
}

export function tabForSelection(selection: Selection | null, current: PropertyTab): PropertyTab {
    if (selection?.kind === "via") return "edge";
    const available = propertyTabs(selection);
    return available.some(([tab]) => tab === current) ? current : available[0][0];
}
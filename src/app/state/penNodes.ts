import { type DrawTool } from "../../core/edit/types.ts";

export type PenNodeMode = "corner" | "auto";
type PenNodes = Record<"boundary" | "terrain", PenNodeMode>;
const defaults: PenNodes = { boundary: "corner", terrain: "auto" };
const key = "groundwork/pen-node-v1";

export function penNodeGroup(tool: DrawTool | undefined): keyof PenNodes | undefined {
    if (tool === "pen" || tool === "addPath") return "boundary";
    if (tool === "shore" || tool === "ridge" || tool === "slopeLine") return "terrain";
}

function validMode(value: unknown): value is PenNodeMode {
    return value === "corner" || value === "auto";
}

export function readPenNodes(): PenNodes {
    try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        return {
            boundary: validMode(value?.boundary) ? value.boundary : defaults.boundary,
            terrain: validMode(value?.terrain) ? value.terrain : defaults.terrain
        };
    }
    catch {
        return { ...defaults };
    }
}

export function savePenNodes(penNodes: PenNodes) {
    try {
        localStorage.setItem(key, JSON.stringify(penNodes));
    }
    catch { /* The current session retains its settings. */ }
}
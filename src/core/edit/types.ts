import { type Path, type PathNode, type Point } from "../design/v5.ts";
import { type Segment } from "../design/regions.ts";
import { type ShapeTool } from "./paths.ts";

export interface Selection { kind: "geoNode" | "input" | "field" | "mark" | "section"; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }

export type DrawTool = ShapeTool | "strip" | "addPath" | "shore" | "ridge" | "peak" | "slopeLine" | "center" | "harbor" | "section";
export interface GeoDraft {
    tool: DrawTool; owner?: string; member?: number; ids: string[]; nodes: PathNode[]; anchors: string[]; reverse: boolean;
    down?: Point; downRaw?: Point; start?: Point; sizing?: boolean; radius?: Point; cursor?: Point; path?: Path; spine?: Segment[]; spineRange?: string;
}
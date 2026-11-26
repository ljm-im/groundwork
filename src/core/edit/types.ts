import { type Curve, type CurveNode, type Point } from "../design/v5.ts";
import { type Segment } from "../design/regions.ts";
import { type ShapeTool } from "./paths.ts";

export interface Selection { kind: "geoNode" | "input" | "field" | "geometry" | "mark" | "section"; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }

export type DrawTool = ShapeTool | "strip" | "addOutline" | "shore" | "ridge" | "valley" | "peak" | "slopeLine" | "center" | "harbor" | "section" | "geometryPoint" | "geometryCurve" | "geometryClosed" | "redrawCurve" | "continueCurve";
export interface GeoDraft {
    tool: DrawTool; owner?: string; member?: number; ids: string[]; nodes: CurveNode[]; anchors: string[]; reverse: boolean;
    curve?: { key: string; name: string; redrawTitle?: string; original: Curve; pen: "boundary" | "terrain"; requiredClosed: boolean; openOnly?: true; endpoint?: number };
    down?: Point; downRaw?: Point; handle?: Point; start?: Point; sizing?: boolean; radius?: Point; cursor?: Point; path?: Curve; closed?: boolean; spine?: Segment[]; spineRange?: string;
}
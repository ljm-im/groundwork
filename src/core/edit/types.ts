import { type Curve, type CurveNode, type Point, type PointHolder } from "../design/v5.ts";
import { type Segment } from "../design/regions.ts";
import { type ShapeTool } from "./paths.ts";
import { type FunctionMember } from "../design/curveReferences.ts";

export interface Selection { kind: "geoNode" | "input" | "field" | "geometry" | "mark" | "section"; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }
export type HolderGroup = FunctionMember | "outlines" | "shore" | "harbor" | "center" | "endpoints";
export type HolderLayer = { kind: "holder"; group: HolderGroup; index: number };
export type PointTarget = { root: Selection; holder?: HolderLayer };

export type DrawTool = ShapeTool | "strip" | "addOutline" | "shore" | "ridge" | "valley" | "peak" | "slopeLine" | "center" | "pointPlacement" | "section" | "geometryPoint" | "geometryCurve" | "geometryClosed" | "redrawCurve" | "continueCurve";
export type PointDraft = { title: string; hovered?: Point } & ({ target: PointTarget; id?: never } | { id: string; target?: never });
export type PointChoice = { reference: PointHolder; point: Point };
export interface GeoDraft {
    tool: DrawTool; owner?: string; member?: number; ids: string[]; nodes: CurveNode[]; anchors: string[]; reverse: boolean;
    curve?: { key: string; name: string; redrawTitle?: string; original: Curve; pen: "boundary" | "terrain"; requiredClosed: boolean; openOnly?: true; endpoint?: number;
        pick?: { label: string; hovered?: string; pressed?: string } };
    point?: PointDraft;
    down?: Point; downRaw?: Point; handle?: Point; start?: Point; sizing?: boolean; radius?: Point; cursor?: Point; path?: Curve; closed?: boolean; spine?: Segment[]; spineRange?: string;
}
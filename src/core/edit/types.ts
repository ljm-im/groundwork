import { type Clearing, type Peak, type Planting, type Point, type Ridge } from "../design/types.ts";

export interface FeatureMap { peak: Peak; ridge: Ridge; planting: Planting; clearing: Clearing }
export type FeatureKind = keyof FeatureMap;
export type Feature = FeatureMap[FeatureKind];
export interface Selection { kind: string; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }
export interface VertexHit { point: Point; index: number; fraction: number; distance?: number }
export interface DrawingTarget {
    kind: FeatureKind; id: string; action: "select" | "insert" | "extend"; index: number;
    hit: VertexHit; point: Point; distance: number;
}
export interface Drawing {
    kind: FeatureKind; points: Point[]; cursor: Point | null; hover: DrawingTarget | null;
    extension: { id: string; atStart: boolean; origin: Point } | null;
}
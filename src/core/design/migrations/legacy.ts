import { type Design, type Edge, type Named, type Point, type RoadNode, type Routing, type Vegetation } from "../types.ts";

export interface Forest { center: Point; radii: Point; density: number }
export interface Grove { zone: string; radius: Point; angles: Point; zones: string[]; density: number }
interface View { from?: string; building?: string; door?: string; targetZone: string; length: number; halfAngle: number }
export interface FixedRoad extends Named {
    points: Point[]; grade: string; width: number; stairUntil?: number; stairs?: boolean; levelDeck?: boolean; color?: string;
}
export interface ImportNode extends RoadNode { fixedRoad?: string; vertex?: number }
export interface ImportDesign extends Omit<Design, "version" | "nodes" | "routing" | "vegetation"> {
    version: number;
    fixedRoads?: FixedRoad[];
    nodes: ImportNode[];
    edges: Edge[];
    routing: Routing & { turnDegrees?: number };
    vegetation: Vegetation & { forest?: Forest; grove?: Grove; view?: View; scatterPattern?: unknown };
}
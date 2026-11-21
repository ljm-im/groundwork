import { type Design, type Edge, type Point } from "../core/design/types.ts";
export { type Design, type Edge, type Point, type Height, type Named, type Building, type Door, type Zone, type RoadClass, type RoadNode } from "../core/design/types.ts";
import { type Island } from "../core/island.js";
import { type IslandMap } from "../render/map.js";
import { type layerDefaults } from "../core/edit/controls.js";

export type Tab = "network" | "buildings" | "terrain" | "layers" | "issues";
export type FeatureKind = "peak" | "ridge" | "planting" | "clearing";
export type Tool = "select" | "node" | "gate" | "edge" | "via" | "fork" | "door" | "building" | FeatureKind;
export type Layer = keyof typeof layerDefaults;

export interface Selection { kind: string; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }

export interface Route {
    id: string; edge: Edge; points: Point[]; length: number; drop: number; maxGrade: number;
    detour: number; stairRuns: number; stairLength: number;
}

export interface Issue {
    severity: string; message: string; road?: string; other?: string; node?: string; building?: string;
    zone?: string; point: Point; label?: string;
}

export type IslandModel = Omit<Island, "design" | "routes" | "issues"> & { design: Design; routes: Route[]; issues: Issue[];
    terrain: Island["terrain"] & { zoneAt: Int16Array }; graded: NonNullable<Island["graded"]> };
export interface Drawing {
    kind: FeatureKind; points: Point[]; cursor: Point | null;
    hover: ReturnType<typeof import("../core/edit/landforms.js").drawingTarget>;
    extension: { id: string; origin: Point; atStart: boolean } | null;
}
export type MapView = Omit<IslandMap, "screen" | "world" | "hitBuilding" | "hitHandle" | "issueHits" | "focusBounds"> & {
    focusBounds(box: number[]): void;
    drawing: Drawing | null; linkPreview: Point[] | null;
    screen(point: Point): Point; world(x: number, y: number): Point;
    hitHandle(x: number, y: number): Handle | null;
    hitBuilding(x: number, y: number): Handle | null;
    issueHits(screen: Point): Issue[];
};
interface GestureStart { screen: Point; pointer: number; changed?: boolean }
export type Gesture = GestureStart & (
  { pan: true; center: number[]; click?: () => void } |
  { branch: true } |
  { handle: Handle; offset: number[]; hits: Issue[] }
);
export type Editable = HTMLInputElement | HTMLSelectElement;
export const numeric = (input: Editable) => input instanceof HTMLInputElement ? input.valueAsNumber : NaN;
export const checked = (input: Editable) => input instanceof HTMLInputElement && input.checked;
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export type Yard = ReturnType<typeof import("../core/design/shapes.ts").areaBoundary>;
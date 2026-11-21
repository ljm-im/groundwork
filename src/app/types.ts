import { type Island } from "../core/island.js";
import { type IslandMap } from "../render/map.js";
import { type layerDefaults } from "../core/edit/controls.js";

export type Tab = "network" | "buildings" | "terrain" | "layers" | "issues";
export type FeatureKind = "peak" | "ridge" | "planting" | "clearing";
export type Tool = "select" | "node" | "gate" | "edge" | "via" | "fork" | "door" | "building" | FeatureKind;
export type Layer = keyof typeof layerDefaults;
export type Point = [number, number];
export type Height = number | { level: string; offset?: number };
export interface Named { id: string; name: string }
export interface Selection { kind: string; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }
export interface RoadNode extends Named {
    type: string; direction?: number; building?: string; door?: string; yard?: string;
    at?: number; through?: string[]; otherThrough?: string[][];
}
export interface RoadClass {
    name: string; width: number; comfort: number; maxGrade: number; corridor: number;
    rampLimit?: number; stairLimit: number; allowStairs: boolean;
}
export interface Edge extends Named {
    from: string; to: string; via: Point[]; grade: string; width: number; comfort: number;
    maxGrade: number; corridor: number; mode?: string; segments?: ({ mode?: string; exactEnd?: boolean } | null)[];
}
export interface Route {
    id: string; edge: Edge; points: Point[]; length: number; drop: number; maxGrade: number;
    detour: number; stairRuns: number; stairLength: number;
}
export interface Door extends Named { wall: number }
export interface Building extends Named {
    shape: "rect" | "circle" | "ring"; center: Point; size: Point; radius: number; inner?: number;
    height: number; angle?: number; doors: Door[]; showTitle?: boolean; summit?: boolean;
}
export interface Zone extends Named { shape: { type: string }; height: { endRise?: { fade: Point } } }
export interface Yard extends Named { kind: string; points: Point[] }
export interface Issue {
    severity: string; message: string; road?: string; other?: string; node?: string; building?: string;
    zone?: string; point: Point; label?: string;
}
export interface Design {
    seed: number; grid: { step: number; xMin: number; xMax: number; yMin: number; yMax: number };
    nodes: RoadNode[]; edges: Edge[]; zones: Zone[]; yards: Yard[]; buildings: Building[];
    levelControls: Record<string, [string, number, number, number]>; levels: Record<string, number>;
    roadClasses: Record<string, RoadClass>; vegetation: { density: Record<string, number> };
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
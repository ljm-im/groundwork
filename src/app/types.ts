import { type Drawing, type FeatureKind, type Handle } from "../core/edit/types.ts";
export { type Drawing, type FeatureKind, type Handle, type Selection } from "../core/edit/types.ts";
import { type Issue } from "../core/design/results.ts";
import { type Point } from "../core/design/types.ts";
export { type Design, type Edge, type Point, type Height, type Named, type Building, type Door, type Zone, type RoadClass, type RoadNode } from "../core/design/types.ts";
import { type Island } from "../core/island.ts";
import { type IslandMap } from "../render/map.js";
import { type layerDefaults } from "./state/layers.ts";

export type Tab = "network" | "buildings" | "terrain" | "layers" | "issues";

export type Tool = "select" | "node" | "gate" | "edge" | "via" | "fork" | "door" | "building" | FeatureKind;
export type Layer = keyof typeof layerDefaults;

export { type Route } from "../core/design/results.ts";

export { type Issue } from "../core/design/results.ts";

export type IslandModel = Island;

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
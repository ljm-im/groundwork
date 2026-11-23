import { type Point } from "../core/design/v5.ts";
import { type Issue } from "../core/design/results.ts";
import { type FeatureKind, type Handle } from "../core/edit/types.ts";
import { type layerDefaults } from "./state/layers.ts";

export { type Building, type Design, type Door, type Edge, type Height, type Named, type Point, type RoadClass, type RoadNode } from "../core/design/v5.ts";
export { type Issue, type Route } from "../core/design/results.ts";
export { type Drawing, type FeatureKind, type Handle, type Selection } from "../core/edit/types.ts";
export { type Island as IslandModel } from "../core/island.ts";
export { type IslandMap as MapView } from "../render/map.ts";

export type Tab = "network" | "buildings" | "terrain" | "layers" | "issues";

export type Tool = "select" | "node" | "edge" | "via" | "fork" | "door" | "building" | FeatureKind;
export type Layer = keyof typeof layerDefaults;

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
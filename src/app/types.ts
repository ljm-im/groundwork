import { type GeoControl } from "../core/edit/geoControls.ts";
import { type GeoNode, type Point } from "../core/design/v5.ts";
import { type Issue } from "../core/design/results.ts";
import { type Handle } from "../core/edit/types.ts";
import { type DrawTool } from "./state/geoTools.ts";
import { type layerDefaults } from "./state/layers.ts";

export { type Building, type Design, type Door, type Edge, type Expression, type Mark, type Point, type RoadClass, type RoadNode } from "../core/design/v5.ts";
export { type Issue, type Route } from "../core/design/results.ts";
export { type Handle, type Selection } from "../core/edit/types.ts";
export { type Island as IslandModel } from "../core/island.ts";
export { type IslandMap as MapView } from "../render/map.ts";

export type Tab = "network" | "buildings" | "terrain" | "inputs" | "layers" | "marks" | "issues";

export type Tool = "select" | "node" | "edge" | "via" | "fork" | "door" | "building" | "textMark" | "scaleMark" | DrawTool;
export type Layer = keyof typeof layerDefaults;

interface GestureStart { screen: Point; pointer: number; changed?: boolean }
export type Gesture = GestureStart & (
  { geo: GeoNode; control: GeoControl } |
  { pan: true; middle?: boolean; center: number[]; click?: () => void } |
  { branch: true } |
  { handle: Handle; offset: number[]; hits: Issue[] }
);
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
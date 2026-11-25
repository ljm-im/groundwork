import { type GeoControl } from "../core/edit/geoControls.ts";
import { type GeoNode, type Point, type Section } from "../core/design/v5.ts";
import { type Handle } from "../core/edit/types.ts";
import { type DrawTool } from "../core/edit/types.ts";
import { type layerDefaults } from "../core/edit/display.ts";
import { type LabelTarget } from "../render/map.ts";

export { type Design, type Expression, type Mark, type Point } from "../core/design/v5.ts";
export { type Issue } from "../core/design/results.ts";
export { type Handle, type Selection } from "../core/edit/types.ts";
export { type Project as ProjectModel } from "../core/project.ts";

export type Tab = "terrain" | "inputs" | "marks" | "issues" | "layers";

export type Tool = "select" | "textMark" | "scaleMark" | DrawTool;
export type Layer = keyof typeof layerDefaults;

interface GestureStart { screen: Point; pointer: number; changed?: boolean }
export type Gesture = GestureStart & (
  { geo: GeoNode; control: GeoControl } |
  { label: LabelTarget; offset: Point } |
  { section: Section } |
  { pan: "middle" | "space" | "stationary"; center: number[]; click?: () => void } |
  { handle: Handle; offset: Point }
);
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
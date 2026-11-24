import { type Point } from "../design/v5.ts";

export interface Selection { kind: "geoNode" | "input" | "field" | "mark" | "section"; id: string; role?: string; index?: number }
export interface Handle extends Selection { point: Point; role: string }
export interface SelectionState { selection: Selection | null; geoSelection: string[] }
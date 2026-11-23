import { type Box, type Point } from "../math/geometry.ts";

export interface Segment { a: Point; b: Point; from?: string }
export interface CrossSection { s: number; first: boolean; at: Point; normal: Point }
export interface RegionShape {
    box: Box;
    contains: (p: Point) => boolean;
    boundary: () => Segment[][];
    spine?: Segment[];
    cross?: (p: Point) => CrossSection | undefined;
}
export interface Region { shape: RegionShape; cells: number[]; mask: Uint8Array }
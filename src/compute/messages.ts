import { type Issue, type Terrain } from "../core/design/results.ts";
import { gridSpec, type GridSpec } from "../core/math/geometry.ts";
import { shapeData, type Region, type Segment, type ShapeData } from "../core/design/regions.ts";
import { DesignError, type DesignProblem } from "../core/design/problems.ts";
import { type Design, type Point, type ResolvedDesign } from "../core/design/v5.ts";
import { type ProjectView } from "../core/project.ts";

export type KnownRegions = [revision: number, contour: boolean][];
type RegionData = Omit<Region, "shape"> & { shape: ShapeData };
type RegionRevision = { revision: number; data?: RegionData; contour?: Segment[][] };
type TerrainData = Omit<Terrain, "grid" | "regions"> & { grid: GridSpec; regions: [string, RegionRevision][] };
export type ViewData = { design: ResolvedDesign; terrain: TerrainData; issues: Issue[] };
export type ProjectData = { design: Design; view: ViewData; helpers: number };

export type Request =
    { kind: "generate"; id: number; design: Design | string; reset: boolean; known: KnownRegions } |
    { kind: "number" | "coarse"; id: number; source: number; design: Design; resolved: ResolvedDesign; known: KnownRegions } |
    { kind: "below"; id: number; source: number; through: string; known: KnownRegions } |
    { kind: "reading"; id: number; source: number; owner: string; field: string; point?: Point } |
    { kind: "export"; id: number; source: number; design: Design };

export type Command = Request | { kind: "clearPreviews" } | { kind: "release"; source: number };

export type Missing = "base" | "natural" | null;
type Failure = { message: string; name: string; problems?: DesignProblem[] };
export type Reply =
    { kind: "started"; id: number; missing: Missing } |
    { kind: "error"; id: number; error: Failure } |
    { kind: "dropped"; id: number } |
    { kind: "project"; id: number; project: ProjectData } |
    { kind: "view"; id: number; view: ViewData } |
    { kind: "reading"; id: number; value?: number } |
    { kind: "export"; id: number; bytes: Uint8Array<ArrayBuffer> };

export function failure(error: unknown): Failure {
    if (error instanceof DesignError) return { name: error.name, message: error.message, problems: error.problems };
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: "Error", message: String(error) };
}

export function replyError(error: Failure) {
    return error.problems ? new DesignError(error.problems) : Object.assign(Error(error.message), { name: error.name });
}

export class TerrainSender {
    private readonly revisions = new WeakMap<Region, number>();
    private serial = 0;

    view({ design, terrain, issues }: ProjectView, known: KnownRegions): ViewData {
        const knownRegions = new Map(known);
        const regions = [...terrain.regions].map(([id, region]): [string, RegionRevision] => {
            let revision = this.revisions.get(region);
            if (revision === undefined) this.revisions.set(region, revision = ++this.serial);
            const { shape, ...layout } = region, data = shapeData(shape)!;
            if (knownRegions.has(revision)) {
                const contour = !knownRegions.get(revision) && data.type === "strip" ? data.contour : undefined;
                return [id, contour === undefined ? { revision } : { revision, contour }];
            }
            return [id, { revision, data: { ...layout, shape: data } }];
        });
        return { design, issues, terrain: { ...terrain, grid: gridSpec(terrain.grid), regions } };
    }
}

export function transfers({ terrain }: ViewData) {
    const buffers = [terrain.shore.buffer, ...Object.values(terrain.fields).flatMap(({ values, defined }) => [values.buffer, defined.buffer])];
    return buffers.filter(buffer => buffer instanceof ArrayBuffer);
}
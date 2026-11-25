import { type Point } from "./design/v5.ts";
import { heightId } from "./design/defaults.ts";
import { serializeDesign } from "./design/model.ts";
import { type Issue, type Terrain } from "./design/results.ts";
import { writeReliefPixels } from "./terrain/relief.ts";
import { surfaceRules, terrainSurface } from "./terrain/surface.ts";
import { type Project } from "./project.ts";
import { npy, png, zip } from "./export/formats.ts";
import { readme } from "./export/readme.ts";

type XYZ = [number, number, number];
interface Element { id: string; label: string; type: string }
interface ExportMark extends Element { position: XYZ }
interface ExportIssue extends Element, Omit<Issue, "point" | "label" | "location"> { position: [number, number, number | null] }

interface ExportTerrain {
    origin: Point; step: number; width: number; height: number; rowOrder: "north-to-south"; triangulation: "northwest-southeast";
    heights: { file: string; dtype: "float32"; undefined: "NaN" };
    surface: { file: string; dtype: "uint8"; types: Record<number, string>; rules: typeof surfaceRules };
}

export interface GroundworkExport {
    format: "groundwork-export"; version: 7; instructions: string; source: { design: string; sha256: string; commit: string }; prompt: string;
    terrain: ExportTerrain;
    preview: { file: string; width: number; height: number; cellsPerPixel: number };
    marks: ExportMark[]; issues: ExportIssue[];
}

const text = new TextEncoder();

function precision(n: number) {
    if (!Number.isFinite(n)) throw new Error("几何包含非有限数值");
    return Number(n.toFixed(3)) || 0;
}

const xy = ([x, y]: Point): Point => [precision(x), precision(y)];
type Ground = (point: Point) => number | undefined;

function position(point: Point, ground: Ground): XYZ | undefined {
    const [x, y] = xy(point), z = ground([x, y]);
    return z === undefined ? undefined : [x, y, precision(z)];
}

function triangulatedGround({ origin: [west, north], step, width, height }: ExportTerrain, terrain: Terrain): Ground {
    const { values, defined } = terrain.fields[heightId];
    const east = west + (width - 1) * step, south = north - (height - 1) * step;
    return ([x, y]) => {
        if (width < 2 || height < 2 || x < west || x > east || y < south || y > north) return;
        const u = Math.min(width - 1, (x - west) / step), v = Math.min(height - 1, (north - y) / step);
        const c = Math.min(Math.floor(u), width - 2), r = Math.min(Math.floor(v), height - 2);
        const a = u - c, b = v - r, nw = r * width + c, se = nw + width + 1;
        if (!defined[nw] || !defined[se]) return;
        if (a === b) return (1 - a) * values[nw] + a * values[se];
        if (a > b) {
            const ne = nw + 1;
            if (defined[ne]) return (1 - a) * values[nw] + (a - b) * values[ne] + b * values[se];
        }
        else {
            const sw = nw + width;
            if (defined[sw]) return (1 - b) * values[nw] + (b - a) * values[sw] + a * values[se];
        }
    };
}

function terrainArrays(terrain: Terrain) {
    const { width, height, size } = terrain.grid, { values, defined } = terrain.fields[heightId];
    const heights = npy(width, height, "<f4"), surface = npy(width, height, "|u1");
    const heightData = new DataView(heights.bytes.buffer, heights.dataAt);
    const cellAt = terrainSurface(terrain);
    for (let i = 0; i < size; i++) {
        if (defined[i]) heightData.setFloat32(i * 4, values[i], true);
        else heightData.setUint32(i * 4, 0x7fc00000, true);
        surface.bytes[surface.dataAt + i] = cellAt(i)?.type ?? 0;
    }
    return { heights: heights.bytes, surface: surface.bytes };
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

type ExportProject = Pick<Project, "design" | "resolved" | "terrain" | "issues">;

export async function exportProject({ design, resolved, terrain, issues }: ExportProject, commit: string) {
    const { grid } = terrain, { width, height, step } = grid;
    const terrainInfo: ExportTerrain = {
        origin: [grid.x(0), grid.y(0)], step, width, height, rowOrder: "north-to-south", triangulation: "northwest-southeast",
        heights: { file: "terrain/heights.npy", dtype: "float32", undefined: "NaN" },
        surface: { file: "terrain/surface.npy", dtype: "uint8", types: { 0: "海底", 1: "沙", 2: "岩石", 3: "草" }, rules: surfaceRules }
    };
    const ground = triangulatedGround(terrainInfo, terrain);
    const marks = resolved.marks.flatMap((mark): ExportMark[] => {
        if (mark.kind !== "text" || mark.follow !== "map") return [];
        const at = position(mark.point, ground);
        return at ? [{ id: mark.id, label: mark.label, type: "mark.text", position: at }] : [];
    });
    const cellsPerPixel = Math.max(1, Math.ceil(Math.max(width, height) / 2048));
    const preview = {
        file: "preview.png", width: Math.ceil(width / cellsPerPixel), height: Math.ceil(height / cellsPerPixel), cellsPerPixel
    };
    const arrays = terrainArrays(terrain), source = text.encode(serializeDesign(design));
    const pixels = new Uint8ClampedArray(preview.width * preview.height * 4);
    writeReliefPixels(terrain, "light", pixels, cellsPerPixel);
    const [hash, previewImage] = await Promise.all([sha256(source), png(preview.width, preview.height, pixels)]);
    const metadata: GroundworkExport = {
        format: "groundwork-export", version: 7, instructions: "说明见同一压缩包里的 README.md。",
        source: { design: "source/design.json", sha256: hash, commit }, prompt: design.prompt ?? "",
        terrain: terrainInfo, preview, marks,
        issues: issues.map(({ point, kind, severity, message, geoNode, label }, i) => ({
            kind, severity, message, geoNode, id: "issue-" + (i + 1),
            label: label ?? message, type: "issue." + kind, position: position(point, ground) ?? [...xy(point), null]
        }))
    };
    return zip([
        ["README.md", text.encode(readme)],
        ["project.json", text.encode(JSON.stringify(metadata, null, 2))],
        [terrainInfo.heights.file, arrays.heights],
        [terrainInfo.surface.file, arrays.surface],
        [preview.file, previewImage],
        [metadata.source.design, source]
    ]);
}
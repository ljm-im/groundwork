import { type Point } from "./design/v5.ts";
import { heightId } from "./design/defaults.ts";
import { type Issue, type Terrain } from "./design/results.ts";
import { createGrid, sampleDefined } from "./math/geometry.ts";
import { surfaceRules, terrainSurface } from "./terrain/surface.ts";
import { type Project } from "./project.ts";

export interface ExportSource { sha256: string; commit: string }
type XYZ = [number, number, number];
interface Element { id: string; label: string; type: string }
interface ExportMark extends Element { position: XYZ }
interface ExportIssue extends Element, Omit<Issue, "point" | "label" | "location"> { position: [number, number, number | null] }
interface ExportTerrain {
    origin: Point; step: number; width: number; height: number; rowOrder: "north-to-south";
    heights: number[][]; defined: number[][]; surface: number[][]; surfaceTypes: Record<number, string>; surfaceRules: typeof surfaceRules;
}
export interface GroundworkExport {
    format: "groundwork-export"; version: 6; source: ExportSource; instructions: string; prompt: string;
    terrain: ExportTerrain; marks: ExportMark[]; issues: ExportIssue[];
}

const instructions = [
    "这是一份户外场地设计。Groundwork 已算好几何，描述由作者撰写。",
    "保持给定的位置、标高、尺寸和朝向。描述决定外观。如与几何冲突，采用几何，并在交付时逐条列出冲突。",
    "先读项目描述，再读各元素的描述，具体元素的描述优先。只制作设计中列出的内容，不添加描述以外的道具或装饰。",
    "marks 只含跟随地图的文字标记，用于定位和标注。元素的标签保存在 label。",
    "按原样呈现 issues 中的问题。遇到描述不足、无法确定做法的地方，采用最简单的实现，并在交付时逐条列明。",
    "单位为米。X 向东，Y 向北，Z 向上，海平面为 Z = 0。栅格原点是西北角第一个格点的中心，列向东、行向南，行列下标从 0 开始。第 r 行第 c 列的平面坐标为 [origin[0] + c × step, origin[1] − r × step]。defined 为 1 的格子有地形，0 表示高度未定义。仅在有效格点间插值。高度未定义处的问题以 null 表示没有地面标高。"
].join("\n\n");

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

function exportTerrain(terrain: Terrain): ExportTerrain {
    const { grid } = terrain, { values: heights, defined: mask } = terrain.fields[heightId], { width, height, step } = grid;
    const cellAt = terrainSurface(terrain);
    const heightsOut: number[][] = [], surface: number[][] = [], defined: number[][] = [];
    for (let j = 0; j < height; j++) {
        const start = j * width;
        defined.push(Array.from(mask.subarray(start, start + width)));
        heightsOut.push(Array.from(heights.subarray(start, start + width), precision));
        surface.push(Array.from({ length: width }, (_, i) => cellAt(start + i)?.type ?? 0));
    }
    return { origin: xy([grid.x(0), grid.y(0)]), step: precision(step), width, height, rowOrder: "north-to-south",
        surfaceTypes: { 0: "海底", 1: "沙", 2: "岩石", 3: "草" }, surfaceRules, heights: heightsOut, defined, surface };
}

export function exportProject(project: Project, source: ExportSource): GroundworkExport {
    const { resolved: design } = project;
    const terrain = exportTerrain(project.terrain);
    if (terrain.step === 0) throw new Error("格距小于导出文件可表示的精度");
    const samples = Float64Array.from(terrain.heights.flat());
    // Attach objects to the same millimetre-rounded lattice that a recipient reads.
    const xMin = terrain.origin[0] - terrain.step / 2, yMax = terrain.origin[1] + terrain.step / 2;
    const publishedGrid = createGrid({ xMin, xMax: xMin + terrain.width * terrain.step, yMax, yMin: yMax - terrain.height * terrain.step, step: terrain.step });
    const ground: Ground = p => sampleDefined(publishedGrid, samples, project.terrain.fields[heightId].defined, ...p);
    const marks = design.marks.flatMap((mark): ExportMark[] => {
        if (mark.kind !== "text" || mark.follow !== "map") return [];
        const at = position(mark.point, ground);
        return at ? [{ id: mark.id, label: mark.label, type: "mark.text", position: at }] : [];
    });

    const issues = project.issues.map(({ point, kind, severity, message, geoNode, label }, i): ExportIssue => ({
        kind, severity, message, geoNode, id: "issue-" + (i + 1),
        label: label ?? message, type: "issue." + kind, position: position(point, ground) ?? [...xy(point), null] }));
    return { format: "groundwork-export", version: 6, source: { sha256: source.sha256, commit: source.commit }, instructions, prompt: design.prompt ?? "",
        terrain, marks, issues };
}

export function serializeExport(data: GroundworkExport): string {
    // JSON strings escape their newlines. Only structural, numeric arrays can
    // match this multiline pattern, including when descriptions contain JSON.
    return JSON.stringify(data, null, 2).replace(/\[\n\s*([-\d.eE+]+(?:,\n\s*[-\d.eE+]+)*)\n\s*\]/g,
        (_, numbers: string) => "[" + numbers.replace(/,\n\s*/g, ", ") + "]");
}
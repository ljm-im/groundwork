import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { type Issue } from "../src/core/design/results.ts";
import { type Point } from "../src/core/design/v5.ts";
import { createGrid } from "../src/core/math/geometry.ts";
import { Project } from "../src/core/project.ts";
import { writeReliefPixels } from "../src/core/terrain/relief.ts";
import { surfaceRules, terrainSurface } from "../src/core/terrain/surface.ts";
import { exportProject, type GroundworkExport } from "../src/core/export.ts";
import { layer, polygon, rect, syntheticDesign } from "./scenarios.ts";
import { decodePreview, readNpy, readProject, readZip } from "./exportFiles.ts";

const commit = "a".repeat(40), text = new TextDecoder();
const prompt = "  外观保留原样。\n[\n  1,\n  2\n]\t\"门\"  ";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (array: Float32Array | Uint8Array) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
const littleEndian = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const millimeters = (value: number) => Number(value.toFixed(3)) || 0;

async function loadExample() {
    const design = syntheticDesign();
    design.prompt = prompt;
    design.grid.step = 1.00049;
    design.fields.F = { label: "F" };
    design.marks.push({ id: "A", label: "A", kind: "text", point: [2, 3], follow: "map", elevation: "{input:A}" },
        { id: "B", label: "B", kind: "scale", point: [5, 6], follow: "map", length: 10 },
        { id: "C", label: "C", kind: "text", point: [2, 3], follow: "screen" },
        { id: "D", label: "D", kind: "text", point: [9, 8], follow: "map" });
    const base = design.geoNodes[0].construction;
    assert(base.type === "outline");
    const hole = polygon([[6, 5], [12, 5], [12, 10], [6, 10]]);
    for (const node of hole.nodes) node.id = "H" + node.id;
    base.outlines.push(hole);
    design.geoNodes.push(layer("S", rect(-40, 6, -20, 10), { type: "flat", amount: -5 }),
        layer("B", rect(-40, 10, -20, 18), { type: "flat", amount: -3 }),
        layer("F", rect(-30, -6, 30, 8), { type: "ground", value: .123456 }, "F"),
        layer("X", { type: "strip", of: ["missing"], widths: [1, 2] }, { type: "blend" }));
    const project = new Project(parseDesign(design, true)), zip = await exportProject(project, commit), files = readZip(zip);
    return { project, zip, files, info: readProject(files) };
}

let sample: ReturnType<typeof loadExample>;
const example = () => sample ??= loadExample();

test("Export includes a deterministic ZIP32, fixed instructions and the exact authored source", async () => {
    const { project, zip, files, info } = await example();
    assert.deepEqual([...files.keys()], ["README.md", "project.json", "terrain/heights.npy", "terrain/surface.npy", "preview.png", "source/design.json"]);
    assert.deepEqual(await exportProject(project, commit), zip);

    const expected = serializeDesign(project.design), source = files.get(info.source.design)!, readme = text.decode(files.get("README.md"));
    assert.equal(text.decode(source), expected);
    assert.deepEqual(info.source, { design: "source/design.json", sha256: digest(source), commit });
    assert.equal(info.format, "groundwork-export");
    assert.equal(info.version, 7);
    assert.equal(info.instructions, "说明见同一压缩包里的 README.md。");
    assert.equal(info.prompt, prompt);
    assert.match(text.decode(files.get("project.json")), /^\{\n  "format"/);
    assert(!readme.includes(prompt.trim()));
    assert(!readme.includes("·"));
    for (const path of files.keys()) assert(readme.includes("`" + path + "`"), path);
    for (const { file, dtype } of [info.terrain.heights, info.terrain.surface]) {
        const row = readme.split("\n").find(line => line.startsWith("| `" + file + "`"))!;
        assert(row.includes("`" + dtype + "`") && row.includes("`(height, width)`"));
        assert(readme.includes(`numpy.load("${file}")`));
    }
    const reopened = new Project(parseDesign(text.decode(source), true));
    for (const [id, field] of Object.entries(project.terrain.fields)) {
        const actual = reopened.terrain.fields[id];
        assert.deepEqual([digest(bytesOf(actual.values)), digest(bytesOf(actual.defined))],
            [digest(bytesOf(field.values)), digest(bytesOf(field.defined))]);
    }
    assert.deepEqual(reopened.issues, project.issues);
    assert.equal(serializeDesign(project.design), expected);
});

test("NumPy grids carry the original Float32 bits and terrain surface types", async () => {
    const { project, files, info } = await example();
    const { terrain } = project, { grid } = terrain, { origin, step, width, height } = info.terrain;
    assert.deepEqual([origin, step, width, height], [grid.point(0), grid.step, grid.width, grid.height]);
    assert.equal(step, 1.00049);
    assert.equal(info.terrain.rowOrder, "north-to-south");
    assert.equal(info.terrain.triangulation, "northwest-southeast");
    assert.deepEqual(info.terrain.heights, { file: "terrain/heights.npy", dtype: "float32", undefined: "NaN" });
    assert.deepEqual(info.terrain.surface.types, { 0: "海底", 1: "沙", 2: "岩石", 3: "草" });
    assert.deepEqual(info.terrain.surface.rules, surfaceRules);
    const heights = readNpy(files.get(info.terrain.heights.file)!), surface = readNpy(files.get(info.terrain.surface.file)!);
    assert.deepEqual([heights.dtype, heights.height, heights.width], ["<f4", height, width]);
    assert.deepEqual([surface.dtype, surface.height, surface.width], ["|u1", height, width]);
    const { values, defined } = terrain.fields.height, raw = new DataView(values.buffer, values.byteOffset, values.byteLength);
    const cellAt = terrainSurface(terrain), types = new Set<number>();
    let undefinedCells = 0;
    for (let k = 0; k < grid.size; k++) {
        assert.equal(heights.view.getUint32(k * 4, true), defined[k] ? raw.getUint32(k * 4, littleEndian) : 0x7fc00000);
        const cell = cellAt(k);
        assert.equal(surface.data[k], cell?.type ?? 0);
        if (cell) types.add(cell.type);
        else undefinedCells++;
    }
    assert(undefinedCells > 0);
    assert.deepEqual([...types].sort(), [0, 1, 2, 3]);
});

// Reconstruct the selected triangle in world coordinates using only the package.
function ground([x, y]: Point, info: GroundworkExport, heights: DataView) {
    const { origin: [west, north], step, width, height } = info.terrain;
    if (x < west || x > west + (width - 1) * step || y > north || y < north - (height - 1) * step) return null;
    const left = Math.min(Math.floor((x - west) / step), width - 2);
    const top = Math.min(Math.floor((north - y) / step), height - 2);
    const corner = (col: number, row: number) =>
        [west + col * step, north - row * step, heights.getFloat32(4 * (row * width + col), true)] as const;
    const a = corner(left, top), c = corner(left + 1, top + 1);
    const east = x - a[0], south = a[1] - y;
    if (east === south) {
        const ratio = east / step, z = a[2] * (1 - ratio) + c[2] * ratio;
        return Number.isNaN(z) ? null : millimeters(z);
    }
    const b = east > south ? corner(left + 1, top) : corner(left, top + 1);
    if ([a, b, c].some(v => Number.isNaN(v[2]))) return null;
    const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx;
    const area = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
    const m = cross(x - a[0], y - a[1], c[0] - a[0], c[1] - a[1]) / area;
    const n = cross(b[0] - a[0], b[1] - a[1], x - a[0], y - a[1]) / area;
    return millimeters(a[2] + m * (b[2] - a[2]) + n * (c[2] - a[2]));
}

test("Placement can be reproduced on triangle interiors, shared edges, holes and the outer boundary", async () => {
    const design = syntheticDesign();
    const points: Point[] = [[.2504, 2.7503], [1, 1.75], [1.75, 2.75], [1.25, 2.25], [3.1, 1], [3, 0]];
    design.marks = points.map((point, i) => ({ kind: "text", id: String.fromCharCode(65 + i), label: "标记 " + i, follow: "map", point }));
    const project = new Project(parseDesign(design)), grid = createGrid({ xMin: -.5, xMax: 3.5, yMin: -.5, yMax: 3.5, step: 1 });
    const values = Float32Array.of(1, 5, 0, 2, 7, 9, 13, 11, 0, 1, 2, 3, 4, 6, 8, 15);
    const defined = new Uint8Array(grid.size).fill(1);
    defined[2] = 0;
    const terrain = { ...project.terrain, grid, fields: { height: { values, defined } }, shore: new Float32Array(grid.size) };
    const issues: Issue[] = points.map(point => ({ point, kind: "geo-reference", severity: "error", message: "问题" }));
    const files = readZip(await exportProject({ ...project, terrain, issues }, commit)), info = readProject(files);
    const h = readNpy(files.get(info.terrain.heights.file)!).view;
    const zs = [3, 7, null, 9, null, 15];
    assert.deepEqual(info.marks.map(m => [m.id, m.position[2]]), [["A", 3], ["B", 7], ["D", 9], ["F", 15]]);
    assert.deepEqual(info.issues.map(i => i.position[2]), zs);
    assert.deepEqual(info.marks[0].position, [.25, 2.75, 3]);
    for (const entry of [...info.marks, ...info.issues]) {
        const [x, y, z] = entry.position;
        assert.equal(z, ground([x, y], info, h));
    }
});

test("A point on the diagonal needs only the northwest and southeast heights", async () => {
    const design = syntheticDesign(), point: Point = [.25, .75];
    design.marks.push({ id: "A", label: "A", kind: "text", follow: "map", point });
    const project = new Project(parseDesign(design)), grid = createGrid({ xMin: -.5, xMax: 1.5, yMin: -.5, yMax: 1.5, step: 1 });
    const values = Float32Array.of(1.25, 21, 10, 9.25);
    const issues: Issue[] = [{ point, kind: "geo-reference", severity: "error", message: "问题" }];
    const cases = [
        { mask: [1, 0, 1, 1], z: 3.25 },
        { mask: [1, 1, 0, 1], z: 3.25 },
        { mask: [1, 0, 0, 1], z: 3.25 },
        { mask: [0, 1, 1, 1], z: null },
        { mask: [1, 1, 1, 0], z: null }
    ];
    for (const { mask, z } of cases) {
        const field = { values, defined: Uint8Array.from(mask) };
        const terrain = { ...project.terrain, grid, fields: { height: field }, shore: new Float32Array(grid.size) };
        const files = readZip(await exportProject({ ...project, issues, terrain }, commit)), info = readProject(files);
        const heights = readNpy(files.get(info.terrain.heights.file)!).view;
        assert.equal(ground(point, info, heights), z, String(mask));
        assert.deepEqual(info.issues[0].position, [...point, z], String(mask));
        assert.deepEqual(info.marks.map(mark => mark.position), z === null ? [] : [[...point, z]], String(mask));
    }
});

test("Only map text marks with terrain are included and issue records keep their properties", async () => {
    const { files, info, project } = await example();
    const h = readNpy(files.get(info.terrain.heights.file)!).view;
    assert.deepEqual(info.marks.map(m => [m.id, m.label, m.type]), [["A", "A", "mark.text"]]);
    assert.deepEqual(info.marks[0].position, [2, 3, ground([2, 3], info, h)]);
    assert.deepEqual(info.issues.map(i => [i.geoNode, i.severity]), [["X", "error"], ["T", "warning"], ["S", "warning"], ["B", "warning"]]);
    for (const [i, issue] of project.issues.entries()) {
        const { position, ...exported } = info.issues[i];
        const [x, y] = issue.point.map(millimeters);
        assert.deepEqual(position, [x, y, ground([x, y], info, h)]);
        assert.deepEqual(exported, {
            id: "issue-" + (i + 1), label: issue.label ?? issue.message, type: "issue." + issue.kind,
            kind: issue.kind, severity: issue.severity, message: issue.message, ...(issue.geoNode && { geoNode: issue.geoNode })
        });
    }
});

function checkPreview(project: Project, files: ReturnType<typeof readZip>, stride: number) {
    const { terrain } = project, { width, height, size } = terrain.grid;
    const { preview } = readProject(files), image = decodePreview(files.get(preview.file)!);
    assert.deepEqual([preview.cellsPerPixel, preview.width, preview.height],
        [stride, Math.ceil(width / stride), Math.ceil(height / stride)]);
    assert.deepEqual([image.width, image.height], [preview.width, preview.height]);
    const full = new Uint8ClampedArray(size * 4);
    writeReliefPixels(terrain, "light", full);
    const pixels = new Uint8Array(image.pixels.length);
    let transparent = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const cell = y * stride * width + x * stride, offset = (y * image.width + x) * 4;
        pixels.set(full.subarray(cell * 4, cell * 4 + 4), offset);
        if (!terrain.fields.height.defined[cell]) {
            assert.equal(image.pixels[offset + 3], 0);
            transparent++;
        }
    }
    assert(transparent > 0 && transparent < image.width * image.height);
    assert.deepEqual(image.pixels, pixels);
}

test("PNG preview matches the light map relief both at full resolution and when striding", async () => {
    const { project, files } = await example();
    checkPreview(project, files, 1);
    const design = syntheticDesign();
    const base = rect(-1025, -3, 1025, 3), hole = rect(-12, -2, 11, 2).outlines[0];
    for (const node of hole.nodes) node.id = "H" + node.id;
    base.outlines.push(hole);
    design.geoNodes = [layer("A", base, { type: "ground", value: -1 }), layer("B", rect(-991, -2, 1021, 2), { type: "flat", amount: 3 })];
    const wide = new Project(parseDesign(design));
    checkPreview(wide, readZip(await exportProject(wide, commit)), 2);
});
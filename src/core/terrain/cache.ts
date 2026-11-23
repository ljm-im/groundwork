import { type Design, type ResolvedDesign, type GeoNode, type Point } from "../design/v5.ts";
import { resolveDesign } from "../design/parameters.ts";
import { references } from "../design/expression.ts";
import { type Region, type RegionShape } from "../design/regions.ts";
import { type Terrain } from "../design/results.ts";
import { sampleDefined, type Box, type Grid } from "../math/geometry.ts";
import { applyLayer, evaluateLayer, type LayerOutput } from "./functions.ts";
import { canvasGrid, intersects, makeShape, rasterRegion } from "./regions.ts";
import { finishTerrain, initialFields } from "./terrain.ts";

interface Geometry { key: string; shape: RegionShape; revision: number; region?: Region }
interface Layer { key: string; revision: number; output: LayerOutput }
interface Writer { id: string; field: string; ground: boolean; box: Box; revision: number; geometry: number }

function inputs(node: GeoNode<number>) {
    const fields = new Set<string>(), f = node.function, field = node.field ?? "height";
    if (f.type !== "ground") fields.add(field);
    const input = f.type === "noise" ? f.amplitude : f.type === "coast" ? f.roughness : f.type === "erosion" ? f.strength :
        f.type === "cliff" ? f.factor : f.type === "islets" ? f.density : undefined;
    if (input !== undefined) for (const ref of references(input)) fields.add(ref.slice(6));
    return { params: f, fields };
}

function readBox(n: GeoNode<number>, shape: RegionShape, grid: Grid): Box {
    if (["coast", "cliff", "islets"].includes(n.function.type)) return [grid.xMin, grid.yMin, grid.xMax, grid.yMax];
    const extra = n.construction.type === "strip" ? Math.max(...n.construction.widths) + 2 * grid.step : 0;
    const [x0, y0, x1, y1] = shape.box;
    return [x0 - extra, y0 - extra, x1 + extra, y1 + extra];
}

// Keep each layer's writes, never its entire composite. Replaying them in current
// stack order restores overwritten or deleted areas without mutating an older Island.
export class TerrainCache {
    private geometry = new Map<string, Geometry>();
    private layers = new Map<string, Layer>();
    private gridKey = "";
    private serial = 0;
    private designKey = "";
    recomputed: string[] = [];
    timings = new Map<string, number>();

    clear() {
        this.geometry.clear();
        this.layers.clear();
        this.designKey = this.gridKey = "";
        this.recomputed = [];
        this.timings.clear();
    }

    missing(d: Design) {
        return this.missingResolved(resolveDesign(d));
    }

    missingResolved(d: ResolvedDesign) {
        if (!this.gridKey) return "base";
        return this.designKey === this.terrainKey(d) ? null : "natural";
    }

    private terrainKey(d: Design) {
        return JSON.stringify([d.grid.step, d.fields, d.inputs, d.geoNodes.map(n => [n.id, n.disabled, n.construction, n.field, n.function])]);
    }

    inputAt(d: ResolvedDesign, terrain: Terrain, owner: string, field: string, p: Point) {
        if (field !== "height" && !d.fields[field]) return;
        const { grid, defined } = terrain, heightDefined = new Uint8Array(grid.size);
        const values = field === "height" ? new Float32Array(grid.size) : Float32Array.from(defined, v => v ? d.fields[field].default : 0);
        const state = { grid, defined, heightDefined, fields: { [field]: values } };
        for (const n of d.geoNodes) {
            if (n.id === owner) break;
            const layer = this.layers.get(n.id);
            if (layer && (n.field ?? "height") === field) applyLayer(layer.output, n, state);
        }
        return sampleDefined(grid, values, field === "height" ? heightDefined : defined, ...p);
    }

    preview(d: ResolvedDesign) {
        // Preview can have a different canvas. Copy geometry entries before replacing their raster.
        const copy = new TerrainCache();
        copy.geometry = new Map([...this.geometry].map(([id, g]) => [id, { ...g }]));
        copy.layers = this.layers;
        copy.gridKey = this.gridKey;
        copy.serial = this.serial;
        return copy.generateResolved(d);
    }

    generate(d: Design) {
        return this.generateResolved(resolveDesign(d));
    }

    generateResolved(d: ResolvedDesign) {
        const shapes = new Map<string, RegionShape>(), current = new Map<string, Geometry>();
        const regions = new Map<string, Region>(), times = new Map<string, number>();
        for (const n of d.geoNodes) {
            const start = performance.now(), c = n.construction;
            const refs = c.type === "strip" ? [...current].filter(([id]) => c.of.some(ref => ref === id)).map(([id, g]) => [id, g.revision]) : [];
            const key = JSON.stringify([d.grid.step, c, refs]);
            const old = this.geometry.get(n.id);
            const entry = old?.key === key ? old : { key, shape: makeShape(n, shapes, d.grid.step / 8), revision: ++this.serial };
            current.set(n.id, entry);
            shapes.set(n.id, entry.shape);
            times.set(n.id, performance.now() - start);
        }
        const grid = canvasGrid(d, shapes), gridKey = JSON.stringify([grid.xMin, grid.yMax, grid.width, grid.height, grid.step]);
        for (const [id, g] of current) {
            const start = performance.now();
            if (!g.region || gridKey !== this.gridKey) g.region = rasterRegion(grid, g.shape);
            regions.set(id, g.region);
            times.set(id, times.get(id)! + performance.now() - start);
        }
        const state = initialFields(d, grid, regions), writers: Writer[] = [], layers = new Map<string, Layer>();
        const batterResiduals = new Map<string, NonNullable<LayerOutput["residual"]>>(), recomputed: string[] = [];
        const grounds = d.geoNodes.filter(n => !n.disabled && n.function.type === "ground");
        for (const n of d.geoNodes) {
            if (n.disabled) continue;
            const start = performance.now(), g = current.get(n.id)!, box = readBox(n, g.shape, grid);
            const { fields, params } = inputs(n), field = n.field ?? "height";
            const reads = writers.filter(w => fields.has(w.field) && intersects(box, w.box));
            // Disjoint writes commute. Record only the ordering pairs that can change a read.
            const order = reads.flatMap((w, i) => reads.slice(0, i).filter(v => v.field === w.field && intersects(v.box, w.box)).map(v => [v.id, w.id]));
            const defined = grounds.filter(node => intersects(box, shapes.get(node.id)!.box)).map(node => current.get(node.id)!.revision).sort((a, b) => a - b);
            const activeHeight = field === "height" || fields.has("height") ? writers.filter(w => w.ground && intersects(box, w.box)).map(w => w.geometry) : [];
            const defaults = [...fields].filter(key => key !== "height").map(key => d.fields[key].default);
            const key = JSON.stringify([gridKey, g.revision, field, params, defaults, defined, activeHeight.sort((a, b) => a - b),
                reads.map(w => w.revision).sort((a, b) => a - b), order.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))]);
            let layer = this.layers.get(n.id);
            if (!layer || layer.key !== key) {
                layer = { key, revision: ++this.serial, output: evaluateLayer(n, g.region!, state) };
                recomputed.push(n.id);
            }
            applyLayer(layer.output, n, state);
            if (layer.output.residual) batterResiduals.set(n.id, layer.output.residual);
            writers.push({ id: n.id, field, ground: n.function.type === "ground", box: g.shape.box, geometry: g.revision, revision: layer.revision });
            layers.set(n.id, layer);
            times.set(n.id, times.get(n.id)! + performance.now() - start);
        }
        this.layers = layers;
        this.geometry = current;
        this.gridKey = gridKey;
        this.designKey = this.terrainKey(d);
        this.recomputed = recomputed;
        this.timings = times;
        return finishTerrain(d, { ...state, regions, batterResiduals });
    }
}
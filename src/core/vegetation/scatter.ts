import { type ResolvedDesign, type Point, type ClearingShape } from "../design/v5.ts";
import { type Terrain } from "../design/results.ts";
import { angleDiff, bearing, distance, radians, smooth, type Grid, gradient } from "../math/geometry.ts";
import { fbm, noise, randomAt } from "../math/noise.ts";
import { insidePolygon } from "../math/polygon.ts";

export function inClearing(shape: ClearingShape, p: Point) {
    if (shape.type === "polygon")
        return insidePolygon(shape, p);
    const [x, y] = shape.center;
    if (shape.type === "ellipse")
        return ((p[0] - x) / shape.radii[0]) ** 2 + ((p[1] - y) / shape.radii[1]) ** 2 < 1;
    const radius = distance(p, shape.center), half = (shape.end - shape.start) * radians / 2;
    return radius <= shape.outer && radius >= (shape.inner ?? 0) && angleDiff(bearing(shape.center, p), shape.start * radians + half) <= half;
}

export function treeEnvironment(design: Pick<ResolvedDesign, "vegetation">, terrain: Terrain) {
    const { grid, defined, heights } = terrain, rules = design.vegetation, n = noise(404);
    const clearings = rules.clearings.map(c => ({ ambient: c.cover === "ambient", shape: c.shape }));
    const buffers = terrain.buildings.map(b => ({ center: b.data.center, radius: b.data.treeRadius ??
      Math.hypot(b.box[2] - b.box[0], b.box[3] - b.box[1]) / 2 + 1.5 }));
    function terrainFactors([x, y]: Point, k: number) {
        const [dx, dy] = gradient(grid, heights, defined, k);
        const slope = Math.hypot(dx, dy);
        const clump = smooth(.5 + 1.2 * fbm(n, x / 24 + 9, y / 24, 4));
        return { slope, clump };
    }
    return {
        terrainFactors,
        clearingAt: (p: Point, ambient: boolean) => clearings.some(c => c.ambient === ambient && inClearing(c.shape, p)),
        freeGround: (p: Point) => !rules.rooms.some(c => distance(p, c.center) < c.radius + 1.5),
        outsideBuffers: (p: Point) => buffers.every(b => distance(p, b.center) >= b.radius),
        outsideBuildings: (p: Point) => terrain.buildings.every(b => b.signedDistance(...p) >= 2)
    };
}

// Each cell owns four samples, regardless of planting decisions in earlier cells.
export function walkScatter(design: Pick<ResolvedDesign, "vegetation">, grid: Grid, visit: (point: Point, roll: number, size: number) => void) {
    const seed = 55;
    let cell = 0;
    for (let y = grid.yMin + 2; y < grid.yMax; y += 3)
        for (let x = grid.xMin + 2; x < grid.xMax; x += 3, cell++) {
            const offset = cell * 4;
            const point: Point = [x + (randomAt(seed, offset) - .5) * 2.6, y + (randomAt(seed, offset + 1) - .5) * 2.6];
            visit(point, randomAt(seed, offset + 2), randomAt(seed, offset + 3));
        }
}
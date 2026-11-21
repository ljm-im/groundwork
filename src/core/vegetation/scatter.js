import { angleDiff, bearing, distance, radians, smooth } from "../math/geometry.ts";
import { fbm, noise, randomAt } from "../math/noise.ts";
import { clearingShape } from "../design/shapes.ts";
import { insidePolygon } from "../math/polygon.ts";

export function inClearing(shape, p) {
    if (shape.type === "polygon")
        return insidePolygon(shape, p);
    const [x, y] = shape.center;
    if (shape.type === "ellipse")
        return ((p[0] - x) / shape.radii[0]) ** 2 + ((p[1] - y) / shape.radii[1]) ** 2 < 1;
    const radius = distance(p, shape.center), half = (shape.end - shape.start) * radians / 2;
    return radius <= shape.outer && radius >= (shape.inner ?? 0) && angleDiff(bearing(shape.center, p), shape.start * radians + half) <= half;
}

export function treeEnvironment(design, terrain) {
    const { grid, flow, heights } = terrain, rules = design.vegetation, n = noise(design.seed + 404);
    const clearings = rules.clearings.map(c => ({ ambient: c.cover === "ambient", shape: clearingShape(design, c) }));
    const buffers = terrain.buildings.map(b => ({ center: b.data.center, radius: b.data.treeRadius ??
      Math.hypot(b.box[2] - b.box[0], b.box[3] - b.box[1]) / 2 + 1.5 }));
    let peakFlow = 0;
    for (const v of flow)
        peakFlow = Math.max(peakFlow, v);
    const flowScale = Math.log1p(peakFlow) || 1;
    function terrainFactors([x, y], k) {
        const dx = heights[grid.index(x + grid.step, y)] - heights[grid.index(x - grid.step, y)];
        const dy = heights[grid.index(x, y + grid.step)] - heights[grid.index(x, y - grid.step)];
        const slope = Math.hypot(dx, dy) / (2 * grid.step);
        const clump = smooth(.5 + 1.2 * fbm(n, x / 24 + 9, y / 24, 4));
        const factor = (1 + .9 * Math.log1p(flow[k]) / flowScale) * (1 - .6 * terrain.rock[k] * smooth((slope - .4) / .4));
        return { slope, clump, factor };
    }
    return {
        terrainFactors,
        clearingAt: (p, ambient) => clearings.some(c => c.ambient === ambient && inClearing(c.shape, p)),
        freeGround: p => !terrain.yards.some(y => insidePolygon(y.yard, p)) && !rules.rooms.some(c => distance(p, c.center) < c.radius + 1.5),
        outsideBuffers: p => buffers.every(b => distance(p, b.center) >= b.radius),
        outsideBuildings: p => terrain.buildings.every(b => b.signedDistance(...p) >= 2)
    };
}

// Each cell owns four samples, regardless of planting decisions in earlier cells.
export function walkScatter(design, visit) {
    const { grid } = design, seed = design.seed + 55;
    let cell = 0;
    for (let y = grid.yMin + 2; y < grid.yMax; y += 3)
        for (let x = grid.xMin + 2; x < grid.xMax; x += 3, cell++) {
            const offset = cell * 4;
            const point = [x + (randomAt(seed, offset) - .5) * 2.6, y + (randomAt(seed, offset + 1) - .5) * 2.6];
            visit(point, randomAt(seed, offset + 2), randomAt(seed, offset + 3));
        }
}
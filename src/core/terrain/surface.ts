import { type SurfaceCell, type Terrain } from "../design/results.ts";
import { eachCell } from "../math/geometry.ts";
import { insidePolygon } from "../math/polygon.ts";

export const surfaceRules = {
    priority: [0, 4, 2, 1, 3],
    seabed: "非陆地且非礁岛",
    paved: "带填色的地形区域、广场院落或建筑台基",
    rock: { islet: true, slopeAbove: 0.75, coastalRockAtLeast: 0.45, coastDistanceAtMost: 8, coastalSlopeAbove: 0.3 },
    sand: { coastDistanceAtMost: 5, rockBelow: 0.35, slopeBelow: 0.3, heightBelow: 2 },
    grass: "其他陆地"
};

export function terrainSurface(terrain: Terrain, heights: Float32Array) {
    const { grid } = terrain, { width, height, step } = grid;
    const paved = new Uint8Array(grid.size);
    for (const zone of terrain.zones) if (zone.fill) for (const k of zone.cells) paved[k] = 1;
    for (const cells of terrain.pads) for (const k of cells) paved[k] = 1;
    for (const { yard, box } of terrain.yards) if (yard.kind === "plaza") {
        eachCell(grid, box, 0, (k, x, y) => {
            if (insidePolygon(yard, [x, y])) paved[k] = 1;
        });
    }
    const { rock, sand } = surfaceRules;
    return (k: number): SurfaceCell => {
        const i = k % width, j = Math.floor(k / width);
        const west = Math.max(0, i - 1), east = Math.min(width - 1, i + 1);
        const north = Math.max(0, j - 1), south = Math.min(height - 1, j + 1);
        const dx = (heights[j * width + east] - heights[j * width + west]) / ((east - west) * step);
        const dy = (heights[north * width + i] - heights[south * width + i]) / ((south - north) * step);
        const slope = Math.hypot(dx, dy), shore = Math.abs(terrain.dc[k]), stone = terrain.rock[k];
        if (!terrain.land[k] && !terrain.islet[k]) return { type: 0, slope };
        if (paved[k]) return { type: 4, slope };
        if (terrain.islet[k] || slope > rock.slopeAbove || stone >= rock.coastalRockAtLeast && shore <= rock.coastDistanceAtMost && slope > rock.coastalSlopeAbove)
            return { type: 2, slope };
        if (shore <= sand.coastDistanceAtMost && stone < sand.rockBelow && slope < sand.slopeBelow && heights[k] < sand.heightBelow)
            return { type: 1, slope };
        return { type: 3, slope };
    };
}
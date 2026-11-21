import { bounds } from "../../core/math/geometry.ts";
import { profile } from "../../core/roads/profiles.js";
import { applyLevels, updateHeights } from "../../core/terrain/terrain.js";
import { type Height, type IslandModel, type Route } from "../types";

// During a slider gesture the centerlines stay fixed. Sampling a profile only
// reads heights along that line, including the four neighboring grid cells.
function groundChanged(island: IslandModel, route: Route, previous: Float32Array) {
    const { grid, heights } = island.terrain;
    const [west, south, east, north] = bounds(route.points);
    const left = grid.col(west - grid.step), right = grid.col(east + grid.step);
    const top = grid.row(north + grid.step), bottom = grid.row(south - grid.step);
    for (let row = top; row <= bottom; row++) {
        const end = row * grid.width + right;
        for (let k = row * grid.width + left; k <= end; k++) {
            if (previous[k] !== heights[k]) return true;
        }
    }
    return false;
}

export function previewLevels(island: IslandModel, changed: ReadonlySet<string>) {
    const { terrain, design } = island;
    const previous = terrain.heights.slice();
    const affectsNatural = (point: { height: Height }) =>
        typeof point.height === "object" && changed.has(point.height.level);
    if (terrain.peaks.some(affectsNatural) || terrain.ridges.some((ridge: { points: { height: Height }[] }) => ridge.points.some(affectsNatural)))
        updateHeights(terrain, design);
    else
        applyLevels(terrain, design);
    island.routes = island.routes.map(route => groundChanged(island, route, previous) ? profile(design, terrain, route) : route);
    island.finish();
}
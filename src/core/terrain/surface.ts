import { type SurfaceCell, type Terrain } from "../design/results.ts";
import { gradient } from "../math/geometry.ts";

export const surfaceRules = {
    priority: [0, 2, 1, 3],
    seabed: "已定义且标高低于零",
    rock: { slopeAbove: .75 },
    sand: { coastDistanceAtMost: 5, slopeBelow: .3, heightBelow: 2 },
    grass: "其余已定义的格子"
};

export function terrainSurface(t: Terrain) {
    const { heights } = t;
    return (k: number): SurfaceCell | undefined => {
        if (!t.defined[k]) return;
        const slope = Math.hypot(...gradient(t.grid, heights, t.defined, k));
        if (heights[k] < 0) return { type: 0, slope };
        if (slope > surfaceRules.rock.slopeAbove) return { type: 2, slope };
        const sand = surfaceRules.sand;
        if (Math.abs(t.shore[k]) <= sand.coastDistanceAtMost && slope < sand.slopeBelow && heights[k] < sand.heightBelow)
            return { type: 1, slope };
        return { type: 3, slope };
    };
}
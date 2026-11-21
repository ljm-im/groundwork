import { advance, bounds, distance, nearest, pointAt, smooth, stations } from "../math/geometry.ts";
import { treeEnvironment, walkScatter } from "./scatter.js";
import { fbm, noise, random } from "../math/noise.ts";
import { gatePose } from "../edit/yards.js";
import { insidePolygon } from "../math/polygon.ts";

export const treeStyles = {
    forest: ["#537848", 2.1], small: ["#81a56d", 1.75], shrub: ["#9eaf74", .85], avenue: ["#467c67", 2.35]
};

export { inClearing } from "./scatter.js";

function covers(area, p, zone) {
    return (!zone || !area.zones || area.zones.includes(zone)) && insidePolygon(area, p);
}

function plantedTrees(design, terrain, areas, env) {
    const result = [], n = noise(design.seed + 741);
    for (const [index, area] of areas.entries()) {
        let seed = design.seed;
        for (const letter of area.id)
            seed = Math.imul(seed, 31) + letter.charCodeAt(0) | 0;
        const next = random(seed), box = bounds(area.points), later = areas.slice(index + 1), local = [];
        function canPlant(p, k, zone) {
            return terrain.dc[k] >= 2.5 && (!zone || !area.zones || area.zones.includes(zone)) &&
        !later.some(a => covers(a, p, zone)) && env.freeGround(p) && env.outsideBuildings(p) &&
        !env.clearingAt(p, true) && !env.clearingAt(p, false);
        }
        function densityAt(p, k) {
            let density = area.density;
            if (area.natural) {
                const { slope, clump, factor } = env.terrainFactors(p, k);
                if (slope > .85)
                    return 0;
                density *= (1 + area.clump * (.6 + .5 * clump - 1)) * factor;
            }
            else {
                const clump = smooth(.5 + 1.6 * fbm(n, p[0] / 12, p[1] / 12, 3));
                density *= 1 + area.clump * (2 * clump - 1);
            }
            if (area.feather > 0)
                density *= smooth(nearest(...p, area.points, true).distance / area.feather);
            return density;
        }
        function add(p, row) {
            const species = area.species === "mixed" ? (next() < .55 ? "small" : "shrub") : area.species;
            const t = next();
            const size = area.size[0] + (area.size[1] - area.size[0]) * (area.species === "mixed" ? (species === "shrub" ? t * .44 : .44 + .56 * t) : t);
            local.push({ point: p, radius: size, wooded: species === "forest", species, planting: area.id, row });
        }
        if (area.rows && area.density > 0) {
            const ring = [...area.points, area.points[0]], s = stations(ring), length = s.at(-1);
            const count = Math.max(1, Math.round(length / area.spacing));
            for (let i = 0; i < count; i++) {
                const fraction = (i + .5) / count;
                let p = pointAt(ring, s, (i + .5) * length / count);
                if (area.feather > 0) {
                    // Keep rows parallel to the edge, inside the band where trees can grow.
                    const pose = gatePose(area, fraction);
                    p = advance(pose.point, pose.angle, -Math.min(area.feather, area.spacing / 2));
                    if (!insidePolygon(area, p))
                        continue;
                }
                const k = terrain.grid.index(...p), zone = terrain.zones[terrain.zoneAt[k]]?.id;
                if (canPlant(p, k, zone) && (!(area.natural || area.feather) || next() < densityAt(p, k)))
                    add(p, true);
            }
        }
        // Stagger natural stands at a 3 m nearest-neighbour pitch, so there is no preferred row direction.
        const pitchY = area.natural ? 3 * Math.sqrt(3) / 2 : 3;
        for (let row = Math.floor(box[1] / pitchY); row * pitchY <= box[3]; row++) {
            const shift = area.natural && row % 2 !== 0 ? 1.5 : 0;
            for (let x = Math.floor((box[0] - shift) / 3) * 3 + shift; x <= box[2]; x += 3) {
                const p = [x + (next() - .5) * 2.6, row * pitchY + (next() - .5) * 2.6], pick = next(), k = terrain.grid.index(...p);
                const zone = terrain.zones[terrain.zoneAt[k]]?.id;
                if (!insidePolygon(area, p) || pick >= densityAt(p, k) || !canPlant(p, k, zone))
                    continue;
                const minimum = area.species === "forest" ? .65 : null;
                if (local.some(t => distance(t.point, p) < (minimum ?? t.radius + area.size[0])))
                    continue;
                add(p, false);
            }
        }
        for (const tree of local)
            result.push(tree);
    }
    return result;
}

export function plantTrees(design, terrain) {
    const rules = design.vegetation, env = treeEnvironment(design, terrain), trees = [];
    walkScatter(design, (p, roll, size) => {
        const k = terrain.grid.index(...p), zone = terrain.zones[terrain.zoneAt[k]]?.id;
        if (terrain.dc[k] >= 2.5 && (!rules.plantings.some(a => covers(a, p, zone)) || env.clearingAt(p, true))) {
            const { slope, clump, factor } = env.terrainFactors(p, k);
            const base = rules.density[zone ?? "natural"] ?? rules.density.natural ?? 0;
            const density = base * (.15 + 1.25 * clump) * factor;
            if (slope <= .85 && roll <= density && !env.clearingAt(p, false) && env.freeGround(p) && env.outsideBuffers(p) && env.outsideBuildings(p))
                trees.push({ point: p, wooded: false, radius: 1.3 + size * 1.1, species: "small" });
        }
    });
    return trees.concat(plantedTrees(design, terrain, rules.plantings, env));
}

// Bucket the actual finished centreline segments so dragging a road only refilters
// existing candidates. Distances are to the road edge, including on diagonal spans.
export function visibleTrees(candidates, terrain, graded, routes) {
    const buckets = new Map(), key = (i, j) => i + "," + j, size = 10;
    for (const r of routes) {
        const limit = r.edge.width / 2 + 1.5;
        for (let i = 1; i < r.points.length; i++) {
            const a = r.points[i - 1], b = r.points[i], dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
            const segment = { a, dx, dy, length2, limit2: limit * limit };
            for (let j = Math.floor((Math.min(a[1], b[1]) - limit) / size); j <= Math.floor((Math.max(a[1], b[1]) + limit) / size); j++)
                for (let k = Math.floor((Math.min(a[0], b[0]) - limit) / size); k <= Math.floor((Math.max(a[0], b[0]) + limit) / size); k++) {
                    const id = key(k, j);
                    if (!buckets.has(id))
                        buckets.set(id, []);
                    buckets.get(id).push(segment);
                }
        }
    }
    return candidates.filter(tree => {
        const [x, y] = tree.point;
        if (!tree.planting && graded.weight[terrain.grid.index(x, y)] > .35)
            return false;
        return !(buckets.get(key(Math.floor(x / size), Math.floor(y / size))) ?? []).some(({ a, dx, dy, length2, limit2 }) => {
            const u = x - a[0], v = y - a[1], f = Math.max(0, Math.min(1, (u * dx + v * dy) / (length2 || 1)));
            return (u - f * dx) ** 2 + (v - f * dy) ** 2 < limit2;
        });
    });
}
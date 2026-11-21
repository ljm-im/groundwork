import { advance, pointAt, radians, stations } from "./geometry.js";
import { fbm, noise } from "./noise.js";

function forestField(forest, n, x, y) {
    return ((x - forest.center[0]) / forest.radii[0]) ** 2 + ((y - forest.center[1]) / forest.radii[1]) ** 2 +
    .45 * fbm(n, x / 18, y / 18, 3) - 1;
}

function northernBoundary(forest, seed) {
    const n = noise(seed + 404), [cx, cy] = forest.center, [rx, ry] = forest.radii;
    const angle = ([x, y]) => (Math.atan2((y - cy) / ry, (x - cx) / rx) + 2 * Math.PI) % (2 * Math.PI);
    function edge(a) {
        const dx = rx * Math.cos(a), dy = ry * Math.sin(a);
        let lo = 0, hi = 1.6;
        for (let i = 0; i < 28; i++) {
            const mid = (lo + hi) / 2;
            if (forestField(forest, n, cx + dx * mid, cy + dy * mid) < 0)
                lo = mid;
            else
                hi = mid;
        }
        return [cx + dx * hi, cy + dy * hi];
    }
    const dense = Array.from({ length: 360 }, (_, i) => edge(i * Math.PI / 180));
    dense.push(dense[0]);
    const s = stations(dense), length = s.at(-1), count = Math.max(8, Math.round(length / 4));
    const angles = Array.from({ length: count }, (_, i) => angle(pointAt(dense, s, i * length / count)));
    return angles.map(edge);
}

function groveBoundary(grove, center) {
    const [start, end] = grove.angles.map(a => a * radians);
    const arc = (r) => {
        const count = Math.max(1, Math.round((end - start) * r / 4));
        return Array.from({ length: count + 1 }, (_, i) => start + (end - start) * i / count);
    };
    const [inner, outer] = grove.radius, angles = arc(outer);
    const back = inner ? arc(inner).reverse().map(a => advance(center, a, inner)) : [center.slice()];
    return angles.map(a => advance(center, a, outer)).concat(back);
}

export function upgradeWoodlands(d) {
    const rules = d.vegetation;
    if (rules.forest || rules.grove) {
        const converted = [];
        function planting(id, name, points, density, clump, feather, zones) {
            while (rules.plantings.some(a => a.id === id))
                id += "-1";
            const area = { id, name, points, density, clump, size: [1.7, 2.8], species: "forest", rows: false, spacing: 6, natural: true, feather };
            if (zones)
                area.zones = zones.slice();
            converted.push(area);
        }
        if (rules.forest)
            planting("north-forest", "北部树林", northernBoundary(rules.forest, d.seed), rules.forest.density, 1, 6);
        if (rules.grove) {
            const grove = rules.grove, center = d.zones.find(z => z.id === grove.zone).shape.center;
            planting("home-grove", "家旁密林", groveBoundary(grove, center), grove.density, 0, 3, grove.zones);
        }
        rules.plantings.unshift(...converted);
        delete rules.forest;
        delete rules.grove;
    }
    for (const a of rules.plantings) {
        a.natural ??= false;
        a.feather ??= 0;
    }
    for (const z of d.zones)
        if (z.height.endRise)
            z.height.endRise.fade ??= [4, 13];
    d.version = 4;
    return d;
}
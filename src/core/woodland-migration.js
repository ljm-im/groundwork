import { advance, bearing, distance, pointAt, radians, stations } from './geometry.js';
import { fbm, noise } from './noise.js';
import { treeEnvironment, walkScatter } from './scatter.js';
import { generateTerrain } from './terrain.js';
import { insideYard } from './yards.js';

function forestField(forest, n, x, y) {
  return ((x - forest.center[0]) / forest.radii[0]) ** 2 + ((y - forest.center[1]) / forest.radii[1]) ** 2 +
    .45 * fbm(n, x / 18, y / 18, 3) - 1;
}

// Replay the old population once on import, before changing the relief. One bit
// per sampling cell preserves its random sequence, independently of future edits.
export function captureLegacyScatter(d, t, onTree) {
  const rules = d.vegetation, { forest, grove } = rules, env = treeEnvironment(d, t), n = noise(d.seed + 404);
  const home = grove && d.zones.find(z => z.id === grove.zone).shape.center, mask = [];
  walkScatter(d, (p, roll, size, cell) => {
    const group = cell >> 2;
    if (!(cell % 4))
      mask[group] = 0;
    const k = t.grid.index(...p);
    if (t.dc[k] < 2.5)
      return false;
    const { slope, clump, factor } = env.terrainFactors(p, k);
    if (slope > .85)
      return false;
    const zone = t.zones[t.zoneAt[k]]?.id;
    const angle = home && bearing(home, p) / radians, radius = home && distance(home, p);
    const dense = grove && radius > grove.radius[0] && radius < grove.radius[1] && angle > grove.angles[0] && angle < grove.angles[1] &&
      (!zone || grove.zones.includes(zone)) && !env.clearingAt(p, true);
    const northern = !dense && forest && !zone && forestField(forest, n, ...p) < 0;
    const wooded = !!(dense || northern);
    let density = dense ? grove.density : northern ? forest.density : rules.density[zone ?? 'natural'];
    if (!dense)
      density *= wooded ? .6 + .5 * clump : .15 + 1.25 * clump;
    if (roll > density * factor || !env.freeGround(p) || env.clearingAt(p, false) || !env.outsideBuffers(p))
      return false;
    mask[group] |= 1 << (cell % 4);
    onTree?.({ point: p, wooded, radius: (wooded ? 1.7 : 1.3) + size * 1.1, species: wooded ? 'forest' : 'small' }, dense ? 'grove' : northern ? 'forest' : null);
    return true;
  });
  return mask.map(v => v.toString(16)).join('');
}

function northernBoundary(forest, seed, sites) {
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
  let boundary = angles.map(edge);
  // Retain isolated crowns on the outer side of an approximating chord.
  for (const p of sites)
    if (!insideYard({ points: boundary }, p)) {
      angles.push(angle(p));
      angles.sort((a, b) => a - b);
      boundary = angles.map(edge);
    }
  return boundary;
}

function groveBoundary(grove, center, sites) {
  const [start, end] = grove.angles.map(a => a * radians);
  const arc = (r) => {
    const count = Math.max(1, Math.round((end - start) * r / 4));
    return Array.from({ length: count + 1 }, (_, i) => start + (end - start) * i / count);
  };
  const [inner, outer] = grove.radius, angles = arc(outer);
  const back = inner ? arc(inner).reverse().map(a => advance(center, a, inner)) : [center.slice()];
  const polygon = () => angles.map(a => advance(center, a, outer)).concat(back);
  let boundary = polygon();
  for (const p of sites)
    if (!insideYard({ points: boundary }, p)) {
      const a = start + ((bearing(center, p) - start + 2 * Math.PI) % (2 * Math.PI));
      angles.push(a);
      angles.sort((a, b) => a - b);
      boundary = polygon();
    }
  return boundary;
}

export function upgradeWoodlands(d) {
  const rules = d.vegetation;
  if (rules.forest || rules.grove) {
    const sites = { forest: [], grove: [] };
    rules.scatterPattern = captureLegacyScatter(d, generateTerrain(d), (tree, kind) => {
      if (kind) sites[kind].push(tree.point);
    });
    const converted = [];
    function planting(id, name, points, density, clump, feather, zones) {
      while (rules.plantings.some(a => a.id === id))
        id += '-1';
      const area = { id, name, points, density, clump, size: [1.7, 2.8], species: 'forest', rows: false, spacing: 6, natural: true, feather };
      if (zones)
        area.zones = zones.slice();
      converted.push(area);
    }
    if (rules.forest)
      planting('north-forest', '北部树林', northernBoundary(rules.forest, d.seed, sites.forest), rules.forest.density, 1, 6);
    if (rules.grove) {
      const grove = rules.grove, center = d.zones.find(z => z.id === grove.zone).shape.center;
      planting('home-grove', '家旁密林', groveBoundary(grove, center, sites.grove), grove.density, 0, 3, grove.zones);
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
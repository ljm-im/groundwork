import { sample } from './geometry.js';
import { elevation } from './model.js';

export function labelReading(island, label) {
  const d = island.design, b = label.building && d.buildings.find(b => b.id === label.building);
  const anchor = b ? b.center : label.point;
  const point = b && label.offset ? anchor.map((v, i) => v + label.offset[i]) : anchor;
  if(label.titleOnly) return {point,text:label.name};
  const rule = label.level ? { level: label.level } : b && d.zones.find(z => z.id === b.zone)?.height;
  if (!rule && !label.spot) return { point, text: label.name };
  const actual = sample(island.terrain.grid, island.graded.heights, ...anchor);
  const target = rule ? elevation(rule, d.levels) : null;
  return { point, actual, text: [label.name, actual.toFixed(1) + 'm'].filter(Boolean).join(' '),
    difference: target != null && Math.abs(actual - target) > .5 ? '（设计 ' + +target.toFixed(1) + 'm）' : '' };
}
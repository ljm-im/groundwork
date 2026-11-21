import { bounds, distance, mixPoint, nearest, spline } from './geometry.js';
import { clearingShape, elevation, zonePolygon } from './model.js';
import { newId } from './topology.js';
import { simpleBoundary } from './yards.js';

export const featureNames = { peak: '山头', ridge: '山脊', planting: '绿化区', clearing: '林间空地' };

export function features(d, kind) {
  return ({ peak: d.peaks, ridge: d.ridges, planting: d.vegetation.plantings, clearing: d.vegetation.clearings })[kind];
}

export const featureOf = (d, h) => features(d, h?.kind)?.find(item => item.id === h.id);

export function featureLine(d, kind, item) {
  if (kind === 'ridge')
    return spline(item.points.map(p => p.point), false, 8);
  if (kind === 'planting')
    return item.points;
  if (kind === 'clearing')
    return zonePolygon(clearingShape(d, item));
  return [item.center];
}

export function featureBounds(d, kind, item) {
  if (kind === 'peak') {
    const [x, y] = item.center, r = item.radius;
    return [x - r, y - r, x + r, y + r];
  }
  return bounds(featureLine(d, kind, item));
}

export function addFeature(d, kind, points, height = 16) {
  const list = features(d, kind), id = newId(list, kind);
  const item = { id, name: featureNames[kind] + ' ' + id.split('-').at(-1) };
  if (kind === 'peak')
    Object.assign(item, { center: points[0].slice(), height, radius: 14, noise: 2, scale: 10, protect: 0, cliffMin: 1.4 });
  else if (kind === 'ridge') {
    if (points.length < 2 || points.some((p, i) => i && distance(p, points[i - 1]) < .05))
      throw Error('山脊至少需要两个不同的折点');
    Object.assign(item, { points: points.map((point, i) => ({ point: point.slice(), height: Array.isArray(height) ? height[i] : height })),
      widths: [18, 18], widthNoise: [.18, .9, 1.7], heightNoise: [.1, 1.3, 4.4] });
  } else {
    if (points.length < 3 || !simpleBoundary(points))
      throw Error('请绘制至少有三个顶点且不自交的边界');
    const polygon = points.map(p => p.slice());
    if (kind === 'clearing')
      item.shape = { type: 'polygon', points: polygon };
    else
      Object.assign(item, { points: polygon, density: .35, clump: .5, size: [.7, 1.7], species: 'mixed', rows: false, spacing: 6, natural: false, feather: 0 });
  }
  list.push(item);
  return item;
}

export function featureHit(d, kind, item, p) {
  const line = featureLine(d, kind, item), closed = kind !== 'ridge', h = nearest(...p, line, closed);
  const point = mixPoint(line[h.segment], line[(h.segment + 1) % line.length], h.t);
  const divisions = kind === 'ridge' ? 8 : kind === 'clearing' ? item.shape?.smooth || 1 : 1;
  const at = (h.segment + h.t) / divisions;
  const last = kind === 'ridge' ? item.points.length-2 : line.length/divisions-1;
  const index = Math.min(last,Math.floor(at));
  return {distance:h.distance,point,index,fraction:at-index};
}

export function insertVertex(d, h, hit) {
  const f = featureOf(d, h), points = h.kind === 'clearing' ? f.shape?.points : f.points;
  if (!points)
    return null;
  const pos = p => h.kind === 'ridge' ? p.point : p;
  const existing = points.findIndex(p => distance(pos(p), hit.point) < .05);
  if (existing >= 0)
    return existing;
  const i = hit.index + 1;
  if (h.kind === 'ridge') {
    const a = points[i - 1].height, b = points[i].height, t = hit.fraction;
    const height = a?.level && a.level === b?.level ? { level: a.level, offset: (a.offset ?? 0) * (1 - t) + (b.offset ?? 0) * t } :
      elevation(a, d.levels) * (1 - t) + elevation(b, d.levels) * t;
    points.splice(i, 0, { point: hit.point, height });
  } else {
    const copy = points.slice();
    copy.splice(i, 0, hit.point);
    if (!simpleBoundary(copy)) throw Error('插入后边界会自交，请选择另一段边界');
    points.splice(i, 0, hit.point);
  }
  return i;
}

export const newDrawing = kind => ({ kind, points: [], cursor: null, extension: null, hover: null });

export function drawingTarget(d, kind, p, scale) {
  const tolerance = 10 / scale;
  let closest = null;
  for (const item of features(d, kind)) {
    if (kind === 'clearing' && item.shape?.type !== 'polygon')
      continue;
    const hit = featureHit(d, kind, item, p);
    if (hit.distance > tolerance || closest && hit.distance > closest.distance + 1e-8)
      continue;
    const points = kind === 'ridge' ? item.points.map(v => v.point) : kind === 'clearing' ? item.shape.points : item.points;
    let endpoint = -1, vertex = -1;
    for (let i = 0; i < points.length; i++) {
      const gap = distance(p, points[i]);
      if (gap > tolerance)
        continue;
      if (kind === 'ridge' && (i === 0 || i === points.length - 1)) {
        if (endpoint < 0 || gap < distance(p, points[endpoint]))
          endpoint = i;
      } else if (vertex < 0 || gap < distance(p, points[vertex]))
        vertex = i;
    }
    const index = endpoint >= 0 ? endpoint : vertex, action = endpoint >= 0 ? 'extend' : vertex >= 0 ? 'select' : 'insert';
    if (closest && Math.abs(hit.distance - closest.distance) < 1e-8 && closest.action !== 'insert' && action !== 'extend')
      continue;
    closest = { kind, id: item.id, action, index, hit, point: index >= 0 ? points[index] : hit.point, distance: hit.distance };
  }
  return closest;
}

export function clickDrawing(d, drawing, p, scale) {
  const { kind, points, extension } = drawing;
  const target = !extension && !points.length && drawingTarget(d, kind, p, scale);
  drawing.hover = null;
  drawing.cursor = null;
  if (!target) {
    const previous = points.at(-1) ?? extension?.origin;
    if (!previous || distance(previous, p) > .05)
      points.push(p.map(v => +v.toFixed(2)));
    return null;
  }
  let index = target.index;
  if (target.action === 'extend')
    drawing.extension = { id: target.id, atStart: index === 0, origin: target.point.slice() };
  if (target.action === 'insert') {
    index = insertVertex(d, target, target.hit);
  }
  return { selection: { kind, id: target.id, role: 'vertex', index }, changed: target.action === 'insert' };
}

export function finishExtension(d, drawing, heights) {
  const { id, atStart } = drawing.extension, ridge = d.ridges.find(item => item.id === id);
  const added = drawing.points.map((point, i) => ({ point: point.slice(), height: heights[i] }));
  if (atStart)
    ridge.points.unshift(...added.reverse());
  else
    ridge.points.push(...added);
  return { kind: 'ridge', id, role: 'vertex', index: atStart ? 0 : ridge.points.length - 1 };
}

export function deleteFeature(d, h) {
  const item = featureOf(d, h), list = features(d, h.kind);
  if (h.role === 'vertex') {
    const pts = h.kind === 'clearing' ? item.shape.points : item.points;
    if (pts.length <= (h.kind === 'ridge' ? 2 : 3))
      throw Error('已达到最少顶点数，可返回对象后删除整个对象');
    if (h.kind !== 'ridge' && !simpleBoundary(pts.filter((p, i) => i !== h.index)))
      throw Error('删除后边界会自交');
    pts.splice(h.index, 1);
    return { kind: h.kind, id: h.id };
  }
  list.splice(list.indexOf(item), 1);
  return null;
}
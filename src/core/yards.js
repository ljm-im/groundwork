import { bearing, clamp, distance, mixPoint, nearest, stations } from './geometry.js';

export function signedArea(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - p[1] * q[0];
  }, 0) / 2;
}

export function simpleBoundary(points) {
  if (Math.abs(signedArea(points)) < .01) return false;
  const side = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (distance(a, b) < .01) return false;
    for (let j = i + 2; j < points.length; j++) {
      const c = points[j], d = points[(j + 1) % points.length];
      if (d === a) continue;
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
          Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
      if (side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0) return false;
    }
  }
  return true;
}

export function insideYard(yard, point) {
  const [x, y] = point, points = yard.points;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) inside = !inside;
  }
  return inside;
}

export function perimeter(yard) {
  const points = [...yard.points, yard.points[0]], s = stations(points);
  return { points, s, length: s.at(-1) };
}

export function gateFraction(yard, point) {
  const { s, length } = perimeter(yard);
  let { segment, t } = nearest(...point, yard.points, true);
  if (yard.ellipse) {
    const { center, radii: [rx, ry] } = yard.ellipse, step = 2 * Math.PI / yard.points.length;
    const x = point[0] - center[0], y = point[1] - center[1];
    let angle = (segment + t) * step;
    for (let i = 0; i < 6; i++) {
      const c = Math.cos(angle), n = Math.sin(angle), dx = rx * c - x, dy = ry * n - y;
      const slope = rx * rx * n * n + ry * ry * c * c - dx * rx * c - dy * ry * n;
      if (Math.abs(slope) < 1e-9) break;
      angle -= clamp((-dx * rx * n + dy * ry * c) / slope, -step, step);
    }
    const u = ((angle / step % yard.points.length) + yard.points.length) % yard.points.length;
    segment = Math.floor(u);
    t = u - segment;
  }
  return ((s[segment] + t * (s[segment + 1] - s[segment])) / length) % 1;
}

export function gatePose(yard, at) {
  const { points, s, length } = perimeter(yard);
  const station = at * length;
  let i = 0;
  while (i < points.length - 2 && s[i + 1] <= station) i++;
  const t = clamp((station - s[i]) / (s[i + 1] - s[i]));
  if (yard.ellipse) {
    const { center, radii: [rx, ry] } = yard.ellipse;
    const theta = 2 * Math.PI * (i + t) / yard.points.length, c = Math.cos(theta), n = Math.sin(theta);
    return { point: [center[0] + rx * c, center[1] + ry * n], angle: Math.atan2(n / ry, c / rx) };
  }
  const sign = Math.sign(signedArea(yard.points));
  let angle = bearing(points[i], points[i + 1]) - sign * Math.PI / 2;
  // At a corner the bisector points out of both adjacent wall segments.
  if (t < 1e-7 || t > 1 - 1e-7) {
    const n = yard.points.length;
    const j = t < .5 ? (i + n - 1) % n : (i + 1) % n;
    const other = bearing(points[j], points[j + 1]) - sign * Math.PI / 2;
    angle = Math.atan2(Math.sin(angle) + Math.sin(other), Math.cos(angle) + Math.cos(other));
  }
  return { point: mixPoint(points[i], points[i + 1], t), angle };
}

export function gateDistance(a, b, length) {
  const delta = Math.abs(a.at - b.at);
  return Math.min(delta, 1 - delta) * length;
}

// Return only the solid wall intervals, including openings that straddle station zero.
export function hedgeLines(yard, gates, edges) {
  const { points, s, length } = perimeter(yard), gaps = [];
  for (const gate of gates) {
    const half = Math.max(1.2, ...edges.filter(e => e.from === gate.id || e.to === gate.id).map(e => e.width / 2)) + .55;
    for (const wrap of [-length, 0, length]) {
      const at = gate.at * length + wrap;
      if (at + half > 0 && at - half < length) gaps.push([Math.max(0, at - half), Math.min(length, at + half)]);
    }
  }
  const lines = [];
  function solid(a, b) {
    if (a >= b) return;
    const line = [];
    for (let i = 0; i + 1 < points.length; i++) {
      if (a >= s[i + 1] || b <= s[i]) continue;
      const lerp = d => mixPoint(points[i], points[i + 1], clamp((d - s[i]) / (s[i + 1] - s[i])));
      if (!line.length) line.push(lerp(a));
      line.push(lerp(b));
    }
    if (line.length > 1) lines.push(line);
  }
  let start = 0;
  for (const [a, b] of gaps.sort((a, b) => a[0] - b[0])) {
    solid(start, a);
    start = Math.max(start, b);
  }
  solid(start, length);
  return lines;
}
import { clamp, smooth } from '../core/geometry.js';

const colors = [
  [0, 226, 231, 200],
  [4, 204, 221, 168],
  [8, 182, 209, 146],
  [13, 160, 192, 124],
  [18, 190, 183, 138],
  [24, 176, 158, 122],
  [32, 154, 134, 104]
];
const palette = Array.from({ length: 641 }, (_, i) => {
  const h = i / 20,
    j = colors.findIndex(row => row[0] >= h);
  const a = colors[Math.max(0, j - 1)],
    b = colors[j],
    t = (h - a[0]) / (b[0] - a[0] || 1);
  return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * t);
});

function contours(h, grid) {
  const paths = Array.from({ length: 4 }, () => new Path2D()),
    { width, height, step } = grid;
  for (let y = 0; y < height - 1; y++)
    for (let x = 0; x < width - 1; x++) {
      const k = y * width + x,
        a = h[k],
        b = h[k + 1],
        c = h[k + width + 1],
        d = h[k + width];
      const lo = Math.min(a, b, c, d),
        hi = Math.max(a, b, c, d);
      const min = Math.max(0, Math.ceil(lo)),
        max = lo < 0 ? 0 : Math.floor(hi);
      for (let level = min; level <= max && level <= hi; level++) {
        const path = paths[level === 0 ? 0 : level % 10 === 0 ? 3 : level % 2 === 0 ? 2 : 1];
        const px = grid.x(x),
          py = grid.y(y);
        let paired = false;
        const cross = (u, v) => {
          if (paired) path.lineTo(px + step * u, py - step * v);
          else path.moveTo(px + step * u, py - step * v);
          paired = !paired;
        };
        if ((a >= level) !== (b >= level)) cross((level - a) / (b - a), 0);
        if ((b >= level) !== (c >= level)) cross(1, (level - b) / (c - b));
        if ((d >= level) !== (c >= level)) cross((level - d) / (c - d), 1);
        if ((a >= level) !== (d >= level)) cross(0, (level - a) / (d - a));
      }
    }
  return paths;
}

const oceanBorder = new WeakMap();

function chartPaper(t) {
  if (oceanBorder.has(t)) return oceanBorder.get(t);
  const { grid: g } = t, pad = Math.ceil(56 / g.step);
  const raster = document.createElement('canvas');
  raster.width = g.width + 2 * pad;
  raster.height = g.height + 2 * pad;
  const ctx = raster.getContext('2d'),
    pixels = ctx.createImageData(raster.width, raster.height);
  for (let j = 0; j < raster.height; j++)
    for (let i = 0; i < raster.width; i++) {
      const x = i - pad,
        y = j - pad,
        u = clamp(x, 0, g.width - 1),
        v = clamp(y, 0, g.height - 1);
      if (x === u && y === v) continue;
      const depth = clamp((-t.dc[v * g.width + u] + Math.hypot(x - u, y - v) * g.step) * .09 / 5);
      const k = 4 * (j * raster.width + i);
      pixels.data[k] = 186 - 36 * depth;
      pixels.data[k + 1] = 221 - 26 * depth;
      pixels.data[k + 2] = 230 - 18 * depth;
      pixels.data[k + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  const chart = { raster, ctx, pad };
  oceanBorder.set(t, chart);
  return chart;
}

export function relief(island) {
  const { terrain: t, graded } = island, { grid } = t, { width, height, step } = grid, h = graded.heights;
  const { raster, ctx, pad } = chartPaper(t), pixels = ctx.createImageData(width, height), data = pixels.data;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const k = j * width + i,
        v = h[k],
        at = k * 4;
      if (v < 0) {
        const depth = Math.min(1, (-v - 1) / 5);
        data[at] = 186 - 36 * depth;
        data[at + 1] = 221 - 26 * depth;
        data[at + 2] = 230 - 18 * depth;
      } else {
        const dx = (h[k + (i + 1 < width ? 1 : 0)] - h[k - (i ? 1 : 0)]) / (2 * step);
        const dy = (h[k - (j ? width : 0)] - h[k + (j + 1 < height ? width : 0)]) / (2 * step);
        const slope = Math.sqrt(dx * dx + dy * dy),
          rk = t.rock[k];
        const rockMix = smooth((slope - .5) / .45) * (.5 + .5 * rk);
        const sand = v < 1.6 && slope < .3 && rk < .35 && t.zoneAt[k] < 0 ? smooth(1.6 - v) : 0;
        const nx = -dx * 1.7,
          ny = -dy * 1.7;
        const light = clamp(.45 + .6 * (-nx * .5 + ny * .5 + .7) / Math.sqrt((nx * nx + ny * ny + 1) * .99), .6, 1.13);
        const base = palette[clamp(Math.round(v * 20), 0, 640)];
        data[at] = ((base[0] * (1 - rockMix) + 163 * rockMix) * (1 - sand) + 232 * sand) * light;
        data[at + 1] = ((base[1] * (1 - rockMix) + 157 * rockMix) * (1 - sand) + 222 * sand) * light;
        data[at + 2] = ((base[2] * (1 - rockMix) + 143 * rockMix) * (1 - sand) + 190 * sand) * light;
      }
      data[at + 3] = 255;
    }
  ctx.putImageData(pixels, pad, pad);
  const woods = Object.fromEntries(['forest','small','shrub','avenue'].map(k=>[k,new Path2D()]));
  for (const tree of island.trees) {
    const [x, y] = tree.point, path = woods[tree.species];
    path.moveTo(x + tree.radius, y);
    path.arc(x, y, tree.radius, 0, 2 * Math.PI);
  }
  return { raster, margin: pad * step, lines: contours(h, grid), woods };
}
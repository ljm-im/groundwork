import { clamp, distance, mixPoint, sample } from '../core/geometry.js';

import { treeStyles } from '../core/vegetation.js';

export function drawSections(container, island) {
  const { design: d, terrain: t, graded } = island;
  while (container.children.length > d.sections.length) container.lastChild.remove();
  for (const [index, section] of d.sections.entries()) {
    let figure = container.children[index];
    if (!figure) { figure = document.createElement('div');
      figure.className = 'plot';
      figure.innerHTML = '<div class="plot-title"><b></b><span></span></div><canvas></canvas>';
      container.append(figure); }
    figure.querySelector('b').textContent = section.id + '—' + section.id + '′';
    figure.querySelector('span').textContent = section.name;
    const canvas = figure.lastElementChild,
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (w < 20 || h < 20) continue;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [a, b] = section.points, len = distance(a, b), n = Math.max(2, Math.round(len * 2));
    const ux = (b[0] - a[0]) / len,
      uy = (b[1] - a[1]) / len;
    const ground = Array.from({ length: n + 1 }, (_, i) => sample(t.grid, graded.heights, ...mixPoint(a, b, i / n)));
    const left = 17,
      right = w - 5,
      base = h - 15,
      ys = Math.min((h - 27) / Math.max(28, ...ground), 3.4);
    const sx = v => left + v / len * (right - left),
      sy = v => base - v * ys;
    ctx.font = '9px Consolas,monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const level of [0, 10, 20, 30]) {
      const y = sy(level);
      if (y < 4) continue;
      ctx.fillStyle = '#84938a';
      ctx.fillText(level, left - 3, y);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.strokeStyle = '#dfe5dc';
      ctx.lineWidth = .7;
      ctx.stroke();
    }
    ctx.fillStyle = '#a8cbd3';
    ctx.fillRect(left, base, right - left, 5);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const x = sx(len * i / n),
        y = sy(Math.max(ground[i], -3)); if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y); }
    ctx.lineTo(right, base + 6);
    ctx.lineTo(left, base + 6);
    ctx.closePath();
    ctx.fillStyle = '#cec5a8';
    ctx.fill();
    ctx.strokeStyle = '#978e71';
    ctx.lineWidth = .8;
    ctx.stroke();
    for (const tree of island.trees) {
      const [x, y] = tree.point, dx = x - a[0], dy = y - a[1], along = dx * ux + dy * uy;
      if (along < 0 || along > len || Math.abs(dx * uy - dy * ux) > tree.radius) continue;
      const px = sx(along),
        g = ground[clamp(Math.round(along / len * n), 0, n)];
      const [color,heightRatio]=treeStyles[tree.species], crown=g+tree.radius*heightRatio;
      ctx.beginPath();
      ctx.moveTo(px, sy(g));
      ctx.lineTo(px, sy(crown));
      ctx.strokeStyle = '#806d4e';
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px, sy(crown), Math.max(1, tree.radius * (right - left) / len), tree.radius * ys, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    for (const building of t.buildings) {
      let start = -1;
      for (let i = 0; i <= n + 1; i++) {
        const p = i <= n ? mixPoint(a, b, i / n) : null,
          inside = p && building.signedDistance(...p) <= 0;
        if (inside && start < 0) start = i;
        if (!inside && start >= 0) {
          const x = sx(start * len / n),
            y = sy(ground[start] + building.data.height);
          ctx.fillStyle = building.data.color;
          ctx.fillRect(x, y, Math.max(1, sx((i - 1) * len / n) - x), building.data.height * ys);
          start = -1;
        }
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '9px Consolas,monospace';
    ctx.fillStyle = '#738278';
    ctx.fillText('0', left, h);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(len) + ' m', right, h);
    if (w >= 200) {
      ctx.font = '9px "Microsoft YaHei UI",sans-serif';
      ctx.textAlign = 'center';
      let last = -100;
      for (const mark of section.marks) {
        const p = mark[2];
        const at = p ? (p[0] - a[0]) * ux + (p[1] - a[1]) * uy : mark[0];
        if (at < 0 || at > len || p && Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) > 9) continue;
        const x = sx(at),
          height = ground[Math.round(at / len * n)],
          text = mark[1];
        if (x - last < ctx.measureText(text).width + 6) continue;
        ctx.fillStyle = '#556955';
        ctx.fillText(text, x, Math.max(13, sy(height) - 9));
        last = x;
      }
    }
  }
}
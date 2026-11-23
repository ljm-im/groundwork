import { type Section, type Point } from "../core/design/types.ts";
import { type Terrain } from "../core/design/results.ts";
import { type IslandView } from "../core/island.ts";
import { clamp, distance, mixPoint, sampleDefined } from "../core/math/geometry.ts";
import { treeStyles } from "../core/vegetation/vegetation.ts";

// Section stations and building intersections only change when an endpoint or the terrain changes.
const sectionCuts = new WeakMap<Section, { terrain: Terrain; footprints: string; x0: number; y0: number; x1: number; y1: number;
    len: number; n: number; stations: Point[]; buildings: { building: Terrain["buildings"][number]; start: number; end: number }[] }>();

function sectionCut(section: Section, terrain: Terrain, footprints: string) {
    const [a, b] = section.points;
    const last = sectionCuts.get(section);
    if (last && last.terrain === terrain && last.footprints === footprints && last.x0 === a[0] && last.y0 === a[1] && last.x1 === b[0] && last.y1 === b[1]) return last;
    const len = distance(a, b), n = Math.max(2, Math.round(len * 2));
    const stations = Array.from({ length: n + 1 }, (_, i) => mixPoint(a, b, i / n));
    const buildings = [];
    for (const building of terrain.buildings) {
        let start = -1;
        for (let i = 0; i <= stations.length; i++) {
            const inside = i < stations.length && building.signedDistance(...stations[i]) <= 0;
            if (inside && start < 0) start = i;
            if (!inside && start >= 0) {
                buildings.push({ building, start, end: i - 1 });
                start = -1;
            }
        }
    }
    const cut = { terrain, footprints, x0: a[0], y0: a[1], x1: b[0], y1: b[1], len, n, stations, buildings };
    sectionCuts.set(section, cut);
    return cut;
}

export function drawSections(container: HTMLElement, island: IslandView) {
    const { design: d, terrain: t, graded } = island;
    const footprints = t.buildings.map(({ data: b }) => [b.shape, ...b.center, b.angle, b.radius, b.inner, ...(b.size ?? [])].join(",")).join(";");
    while (container.children.length > d.sections.length) container.lastChild!.remove();
    for (const [index, section] of d.sections.entries()) {
        let figure = container.children[index];
        if (!figure) {
            figure = document.createElement("div");
            figure.className = "plot";
            figure.innerHTML = "<div class=\"plot-title\"><b></b><span></span></div><canvas></canvas>";
            container.append(figure);
        }
        const id = section.id + "—" + section.id + "′";
        const label = figure.querySelector("b")!, name = figure.querySelector("span")!;
        if (label.textContent !== id) label.textContent = id;
        if (name.textContent !== section.name) name.textContent = section.name;
        const canvas = figure.lastElementChild as HTMLCanvasElement,
            w = canvas.clientWidth,
            h = canvas.clientHeight;
        if (w < 20 || h < 20) continue;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const [a, b] = section.points, { len, n, stations, buildings } = sectionCut(section, t, footprints);
        const ux = (b[0] - a[0]) / len,
            uy = (b[1] - a[1]) / len;
        const ground = stations.map(p => sampleDefined(t.grid, graded.heights, t.defined, ...p));
        const left = 17,
            right = w - 5,
            base = h - 15,
            ys = Math.min((h - 27) / Math.max(28, ...ground.filter(v => v !== undefined)), 3.4);
        const sx = (v: number) => left + v / len * (right - left),
            sy = (v: number) => base - v * ys;
        ctx.font = "9px Consolas,monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const level of [0, 10, 20, 30]) {
            const y = sy(level);
            if (y < 4) continue;
            ctx.fillStyle = "#84938a";
            ctx.fillText(String(level), left - 3, y);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.strokeStyle = "#dfe5dc";
            ctx.lineWidth = .7;
            ctx.stroke();
        }
        for (let i = 0; i <= n;) {
            if (ground[i] === undefined) {
                i++; continue;
            }
            const start = i;
            ctx.beginPath();
            ctx.moveTo(sx(len * i / n), sy(Math.max(ground[i]!, -3)));
            while (++i <= n && ground[i] !== undefined) ctx.lineTo(sx(len * i / n), sy(Math.max(ground[i]!, -3)));
            ctx.lineTo(sx(len * (i - 1) / n), base + 6);
            ctx.lineTo(sx(len * start / n), base + 6);
            ctx.closePath();
            ctx.fillStyle = "#cec5a8";
            ctx.fill();
            ctx.strokeStyle = "#978e71";
            ctx.lineWidth = .8;
            ctx.stroke();
        }
        for (const tree of island.trees) {
            const [x, y] = tree.point, dx = x - a[0], dy = y - a[1], along = dx * ux + dy * uy;
            if (along < 0 || along > len || Math.abs(dx * uy - dy * ux) > tree.radius) continue;
            const px = sx(along),
                g = ground[clamp(Math.round(along / len * n), 0, n)];
            if (g === undefined) continue;
            const [color, heightRatio] = treeStyles[tree.species], crown = g + tree.radius * heightRatio;
            ctx.beginPath();
            ctx.moveTo(px, sy(g));
            ctx.lineTo(px, sy(crown));
            ctx.strokeStyle = "#806d4e";
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(px, sy(crown), Math.max(1, tree.radius * (right - left) / len), tree.radius * ys, 0, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }
        for (const { building, start, end } of buildings) {
            const h = ground[start];
            if (h === undefined) continue;
            const x = sx(start * len / n), y = sy(h + building.data.height);
            ctx.fillStyle = building.data.color;
            ctx.fillRect(x, y, Math.max(1, sx(end * len / n) - x), building.data.height * ys);
        }
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.font = "9px Consolas,monospace";
        ctx.fillStyle = "#738278";
        ctx.fillText("0", left, h);
        ctx.textAlign = "right";
        ctx.fillText(Math.round(len) + " m", right, h);
        if (w >= 200) {
            ctx.font = "9px \"Microsoft YaHei UI\",sans-serif";
            ctx.textAlign = "center";
            let last = -100;
            for (const mark of section.marks) {
                const p = mark[2];
                const at = p ? (p[0] - a[0]) * ux + (p[1] - a[1]) * uy : mark[0];
                if (at < 0 || at > len || p && Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) > 9) continue;
                const x = sx(at),
                    height = ground[Math.round(at / len * n)],
                    text = mark[1];
                if (height === undefined || x - last < ctx.measureText(text).width + 6) continue;
                ctx.fillStyle = "#556955";
                ctx.fillText(text, x, Math.max(13, sy(height) - 9));
                last = x;
            }
        }
    }
}
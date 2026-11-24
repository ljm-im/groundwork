import { type Section, type Point } from "../core/design/v5.ts";
import { type ProjectView } from "../core/project.ts";
import { distance, mixPoint, sampleDefined } from "../core/math/geometry.ts";
import { canvasText, palette, sectionColors } from "./palette.ts";
import { displayNumber } from "../app/state/numbers.ts";

const sectionCuts = new WeakMap<Section, { a: Point; b: Point; len: number; n: number; stations: Point[] }>();

function sectionCut(section: Section) {
    const [a, b] = section.points, last = sectionCuts.get(section);
    if (last?.a === a && last.b === b) return last;
    const len = distance(a, b), n = Math.max(2, Math.round(len * 2));
    const stations = Array.from({ length: n + 1 }, (_, i) => mixPoint(a, b, i / n));
    const cut = { a, b, len, n, stations };
    sectionCuts.set(section, cut);
    return cut;
}

export function drawSections(container: HTMLElement, project: ProjectView) {
    const { design: d, terrain: t } = project;
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
        if (name.textContent !== section.label) name.textContent = section.label;
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
        const [a, b] = section.points, { len, n, stations } = sectionCut(section);
        const ux = (b[0] - a[0]) / len,
            uy = (b[1] - a[1]) / len;
        const ground = stations.map(p => sampleDefined(t.grid, t.heights, t.defined, ...p));
        const left = 17,
            right = w - 5,
            base = h - 15,
            ys = Math.min((h - 27) / Math.max(28, ...ground.filter(v => v !== undefined)), 3.4);
        const sx = (v: number) => left + v / len * (right - left),
            sy = (v: number) => base - v * ys;
        ctx.font = canvasText.xs + "px " + canvasText.font;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        for (const level of [0, 10, 20, 30]) {
            const y = sy(level);
            if (y < 4) continue;
            ctx.fillStyle = palette.textSecondary;
            ctx.fillText(String(level), left - 3, y);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.strokeStyle = palette.border;
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
            ctx.fillStyle = sectionColors.ground;
            ctx.fill();
            ctx.strokeStyle = sectionColors.groundOutline;
            ctx.lineWidth = .8;
            ctx.stroke();
        }
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = palette.textSecondary;
        ctx.fillText("0", left, h);
        ctx.textAlign = "right";
        ctx.fillText(displayNumber(len, 1, "m"), right, h);
        if (w >= 200) {
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
                ctx.fillStyle = palette.textSecondary;
                ctx.fillText(text, x, Math.max(13, sy(height) - 9));
                last = x;
            }
        }
    }
}
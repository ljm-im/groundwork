import { type Section, type Point } from "../core/design/v5.ts";
import { heightId } from "../core/design/defaults.ts";
import { sampleField, type Terrain } from "../core/design/results.ts";
import { distance, mixPoint } from "../core/math/geometry.ts";
import { canvasText, interfaceColors, sectionColors, type Theme } from "./palette.ts";
import { displaySteps, markParameters } from "../core/design/functionTable.ts";
import { displayReading } from "../core/design/display.ts";

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

export function drawSection(ctx: CanvasRenderingContext2D, w: number, h: number, section: Section, terrain: Terrain, theme: Theme) {
    const colors = interfaceColors[theme];
    ctx.clearRect(0, 0, w, h);
    const { len, n, stations } = sectionCut(section);
    const ground = stations.map(p => sampleField(terrain, heightId, p));
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
        ctx.fillStyle = colors.textSecondary;
        ctx.fillText(String(level), left - 3, y);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.strokeStyle = colors.border;
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
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText("0", left, h);
    ctx.textAlign = "right";
    ctx.fillText(displayReading(len, displaySteps.section, markParameters.scale.unit), right, h);
}
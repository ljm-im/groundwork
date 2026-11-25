import { type Section, type Point } from "../core/design/v5.ts";
import { pixelGridSpacing } from "../core/edit/display.ts";
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

export function drawSection(ctx: CanvasRenderingContext2D, w: number, h: number, section: Section, terrain: Terrain,
    field: string, precision: number, theme: Theme) {
    const colors = interfaceColors[theme];
    ctx.clearRect(0, 0, w, h);
    const { len, n, stations } = sectionCut(section);
    const values = stations.map(p => sampleField(terrain, field, p));
    let min = Infinity, max = -Infinity;
    for (const value of values) if (value !== undefined) {
        min = Math.min(min, value); max = Math.max(max, value);
    }
    if (min === Infinity) min = max = 0;
    const rows = Math.max(2, Math.min(6, Math.floor((h - 22) / 26)));
    const span = Math.max(precision, max - min, Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON * rows * 8);
    const step = Math.max(precision, pixelGridSpacing(rows / span, 1));
    const first = Math.ceil(min / step) - 1, last = Math.max(first + 2, Math.ceil(max / step));
    const ticks = Array.from({ length: last - first + 1 }, (_, i) => displayReading((first + i) * step, precision));
    ctx.font = canvasText.xs + "px " + canvasText.font;
    const left = Math.min(w / 2, Math.ceil(Math.max(...ticks.map(text => ctx.measureText(text).width))) + 5);
    const right = w - 5, base = h - 17;
    const sx = (v: number) => left + v / (len || 1) * (right - left);
    const sy = (v: number) => base - (v / step - first) / (last - first) * (base - 7);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const [i, text] of ticks.entries()) {
        const y = base - i / (last - first) * (base - 7);
        ctx.fillStyle = colors.textSecondary;
        ctx.fillText(text, left - 3, y, left - 3);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = .7;
        ctx.stroke();
    }
    for (let i = 0; i <= n;) {
        if (values[i] === undefined) {
            i++; continue;
        }
        const start = i;
        ctx.beginPath();
        ctx.moveTo(sx(len * i / n), sy(values[i]!));
        while (++i <= n && values[i] !== undefined) ctx.lineTo(sx(len * i / n), sy(values[i]!));
        ctx.lineTo(sx(len * (i - 1) / n), base);
        ctx.lineTo(sx(len * start / n), base);
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
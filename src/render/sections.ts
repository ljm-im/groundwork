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

export function sectionAxis(values: (number | undefined)[], precision: number, height: number) {
    let min = Infinity, max = -Infinity;
    for (const value of values) if (value !== undefined) {
        min = Math.min(min, value); max = Math.max(max, value);
    }
    if (min === Infinity) min = max = 0;
    const rows = Math.max(2, Math.min(6, Math.floor((height - 22) / 26)));
    const span = Math.max(10 * precision, max - min, Math.max(Math.abs(min), Math.abs(max)) * Number.EPSILON * rows * 8);
    const padding = (span - (max - min)) / 2;
    // Leave room for both endpoints to move out to strictly enclosing ticks.
    const unitSpan = span / precision;
    const quotient = unitSpan / (rows - 1);
    const multiple = Math.max(Math.floor(quotient * (1 + 2 * Number.EPSILON)) + 1, Math.round(pixelGridSpacing(rows / unitSpan, 1)));
    const step = multiple * precision;
    function snapIndex(value: number) {
        const index = value / step, integer = Math.round(index);
        return Math.abs(index - integer) <= Math.abs(index) * Number.EPSILON * 2 ? integer : index;
    }
    const first = Math.min(Math.floor(snapIndex(min - padding)), Math.ceil(snapIndex(min)) - 1);
    const last = Math.max(first + 2, Math.ceil(snapIndex(max + padding)), Math.floor(snapIndex(max)) + 1);
    const ticks = Array.from({ length: last - first + 1 }, (_, i) => displayReading((first + i) * step, precision));
    return { first, last, step, ticks };
}

export function drawSection(ctx: CanvasRenderingContext2D, w: number, h: number, section: Section, terrain: Terrain,
    field: string, precision: number, theme: Theme) {
    const colors = interfaceColors[theme];
    ctx.clearRect(0, 0, w, h);
    const { len, n, stations } = sectionCut(section);
    const values = stations.map(p => sampleField(terrain, field, p));
    const { first, last, step, ticks } = sectionAxis(values, precision, h);
    ctx.font = canvasText.xs + "px " + canvasText.font;
    const left = Math.min(w / 2, Math.ceil(Math.max(...ticks.map(text => ctx.measureText(text).width))) + 5);
    const right = w - 5;
    const lengthText = displayReading(len, displaySteps.section, markParameters.scale.unit);
    ctx.textBaseline = "alphabetic";
    const xMetrics = ["0", lengthText].map(text => ctx.measureText(text));
    const labelY = h - Math.ceil(Math.max(...xMetrics.map(m => m.actualBoundingBoxDescent)));
    const floor = labelY - Math.ceil(Math.max(...xMetrics.map(m => m.actualBoundingBoxAscent))) - 4;
    ctx.textBaseline = "middle";
    const yMetrics = ticks.map(text => ctx.measureText(text));
    const top = Math.ceil(Math.max(...yMetrics.map(m => m.actualBoundingBoxAscent))) + 1;
    const bottom = floor - Math.ceil(Math.max(...yMetrics.map(m => m.actualBoundingBoxDescent))) - 2;
    if (bottom <= top) return;
    const sx = (v: number) => left + v / (len || 1) * (right - left);
    const sy = (v: number) => bottom - (v / step - first) / (last - first) * (bottom - top);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const [i, text] of ticks.entries()) {
        const y = bottom - i / (last - first) * (bottom - top);
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
        ctx.lineTo(sx(len * (i - 1) / n), floor);
        ctx.lineTo(sx(len * start / n), floor);
        ctx.closePath();
        ctx.fillStyle = sectionColors.ground;
        ctx.fill();
        ctx.strokeStyle = sectionColors.groundOutline;
        ctx.lineWidth = .8;
        ctx.stroke();
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText("0", left, labelY);
    ctx.textAlign = "right";
    ctx.fillText(lengthText, right, labelY);
}
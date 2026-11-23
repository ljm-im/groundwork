import { type Terrain } from "../core/design/results.ts";
import { type Point } from "../core/design/v5.ts";
import { niceStep } from "../core/math/interval.ts";

export function fieldContours(t: Terrain, name: string) {
    const field = t.fields[name], g = t.grid;
    let low = Infinity, high = -Infinity;
    for (let k = 0; k < field.length; k++) if (t.defined[k]) {
        low = Math.min(low, field[k]); high = Math.max(high, field[k]);
    }
    const step = niceStep((high - low) / 10);
    const lines: { value: number; path: Path2D; label?: Point }[] = [];
    if (low >= high) return { lines, constant: low === high ? low : undefined };
    for (let n = Math.floor(low / step) + 1; n * step <= high; n++) {
        const value = n * step, path = new Path2D();
        let label: Point | undefined;
        for (let j = 0; j + 1 < g.height; j++) for (let i = 0; i + 1 < g.width; i++) {
            const k = i + j * g.width, cells = [k, k + 1, k + 1 + g.width, k + g.width];
            if (cells.some(k => !t.defined[k])) continue;
            const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
            let start = true;
            for (let a = 0; a < 4; a++) {
                const b = (a + 1) % 4, va = field[cells[a]], vb = field[cells[b]];
                if ((va >= value) === (vb >= value)) continue;
                const fraction = (value - va) / (vb - va);
                const x = g.x(i + corners[a][0] + fraction * (corners[b][0] - corners[a][0]));
                const y = g.y(j + corners[a][1] + fraction * (corners[b][1] - corners[a][1]));
                if (start) path.moveTo(x, y);
                else path.lineTo(x, y);
                if (!label || (j * g.width + i + n * 31) % 113 === 0) label = [x, y];
                start = !start;
            }
        }
        lines.push({ value, path, label: n % 3 === 0 ? label : undefined });
    }
    return { lines, constant: undefined };
}
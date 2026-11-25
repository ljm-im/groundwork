import { type Design, type Point } from "../design/v5.ts";
import { heightId } from "../design/defaults.ts";
import { functionTable } from "../design/functionTable.ts";
import { type Issue, type Terrain } from "../design/results.ts";

const untreatedHeightLimit = .5;

export function terrainIssues(d: Design, t: Terrain): Issue[] {
    const { values: heights, defined } = t.fields[heightId], { width, height, size } = t.grid, covered = new Uint8Array(size), issues: Issue[] = [];
    const nodes = d.geoNodes.filter(n => !n.disabled && n.field === heightId && !functionTable[n.function.type].initial);
    for (const n of d.geoNodes) {
        if (!n.disabled && n.field === heightId && n.construction.type === "strip") for (const k of t.regions.get(n.id)!.cells) covered[k] = 1;
    }
    for (const n of nodes) {
        const region = t.regions.get(n.id)!;
        let count = 0, max = 0, point: Point = [0, 0];
        const measure = (k: number, other: number) => {
            if (!defined[other] || covered[other]) return;
            const delta = Math.abs(heights[k] - heights[other]);
            if (delta <= untreatedHeightLimit) return;
            count++;
            if (delta > max) {
                max = delta;
                const a = t.grid.point(k), b = t.grid.point(other);
                point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            }
        };
        // A region covering the canvas has no neighbouring cells outside its mask.
        if (region.cells.length < size) {
            const { left, top, width: columns, height: rows, cells, mask } = region;
            for (let index = 0; index < cells.length; index++) {
                const k = cells[index];
                if (!defined[k] || covered[k]) continue;
                const col = k % width, row = Math.floor(k / width), i = col - left, j = row - top, at = j * columns + i;
                if (col > 0 && (!i || !mask[at - 1])) measure(k, k - 1);
                if (col + 1 < width && (i + 1 === columns || !mask[at + 1])) measure(k, k + 1);
                if (row > 0 && (!j || !mask[at - columns])) measure(k, k - width);
                if (row + 1 < height && (j + 1 === rows || !mask[at + columns])) measure(k, k + width);
            }
        }
        if (count) issues.push({ kind: "untreated-height", severity: "warning", point, geoNode: n.id, label: n.label,
            message: `未处理高差共 ${count} 处，最大 ${max.toFixed(2)} m（${point.join(", ")}）` });
        const residual = t.batterResiduals.get(n.id);
        if (residual) issues.push({ kind: "short-batter", severity: "warning", geoNode: n.id, label: n.label, point: residual.point,
            message: `放坡不到底，最大残留陡坎 ${residual.height.toFixed(2)} m（${residual.point.map(x => +x.toFixed(2)).join(", ")}）` });
    }
    return issues;
}
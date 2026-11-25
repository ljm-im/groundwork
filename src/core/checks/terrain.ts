import { type Design, type Point } from "../design/v5.ts";
import { heightId } from "../design/defaults.ts";
import { functionTable } from "../design/functionTable.ts";
import { regionMaskAt } from "../design/regions.ts";
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
            if (regionMaskAt(region, other) || !defined[other] || covered[other]) return;
            const delta = Math.abs(heights[k] - heights[other]);
            if (delta <= untreatedHeightLimit) return;
            count++;
            if (delta > max) {
                max = delta;
                const a = t.grid.point(k), b = t.grid.point(other);
                point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            }
        };
        for (const k of region.cells) {
            if (!defined[k] || covered[k]) continue;
            if (k % width > 0) measure(k, k - 1);
            if (k % width + 1 < width) measure(k, k + 1);
            if (k >= width) measure(k, k - width);
            if (k < width * (height - 1)) measure(k, k + width);
        }
        if (count) issues.push({ kind: "untreated-height", severity: "warning", point, geoNode: n.id, label: n.label,
            message: `未处理高差共 ${count} 处，最大 ${max.toFixed(2)} m（${point.join(", ")}）` });
        const residual = t.batterResiduals.get(n.id);
        if (residual) issues.push({ kind: "short-batter", severity: "warning", geoNode: n.id, label: n.label, point: residual.point,
            message: `放坡不到底，最大残留陡坎 ${residual.height.toFixed(2)} m（${residual.point.map(x => +x.toFixed(2)).join(", ")}）` });
    }
    return issues;
}
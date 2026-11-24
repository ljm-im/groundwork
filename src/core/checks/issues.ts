import { type Issue } from "../design/results.ts";
import { type Point } from "../math/geometry.ts";

export function objectIssues(project: { issues: Issue[] }, selection?: { kind: string; id: string } | null) {
    return selection?.kind === "geoNode" ? project.issues.filter(i => i.geoNode === selection.id) : [];
}

export function issueView(issue: Issue, w: number, h: number, baseScale: number) {
    return { center: [...issue.point] as Point, zoom: Math.max(.5, Math.min(7, (w * .40) / (12 * baseScale), (h * .38) / (9 * baseScale))) };
}
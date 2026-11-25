import { type Issue } from "../design/results.ts";

export function objectIssues(project: { issues: Issue[] }, selection?: { kind: string; id: string } | null) {
    return selection?.kind === "geoNode" ? project.issues.filter(i => i.geoNode === selection.id) : [];
}
import { type IslandMap } from "./map.ts";
import { geoControls, geometryPath, linePoints, pathEntries, type GeoControl } from "../core/edit/geoControls.ts";
import { flattenPath } from "../core/terrain/path.ts";
import { type Point, type GeoNode } from "../core/design/v5.ts";
import { type Segment } from "../core/design/regions.ts";

export function drawGeoOverlay(map: IslandMap) {
    const ctx = map.ctx, scale = map.scale, d = map.island.design, draft = map.draft;
    const edges = (segments: Segment[], color: string, width: number, dash: number[] = []) => {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
        for (const { a, b } of segments) {
            ctx.moveTo(...map.screen(a)); ctx.lineTo(...map.screen(b));
        }
        ctx.stroke(); ctx.setLineDash([]);
    };
    const dot = (p: Point, color: string, active = false, radius = 3.5) => {
        ctx.beginPath(); ctx.arc(...map.screen(p), radius, 0, Math.PI * 2);
        ctx.fillStyle = active ? color : "#fffdf2"; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
    };
    function controls(n: GeoNode) {
        for (const [i, path] of pathEntries(n)) {
            if (i === -1 || map.dragNode) edges(flattenPath(path, .6 / scale), i === -1 ? "#894a86" : "#12696a", 2, i === -1 ? [6, 4] : []);
        }
        for (const pts of linePoints(n)) edges(pts.slice(1).map((b, i) => ({ a: pts[i], b })), "#894a86", 2.5, [6, 4]);
        for (const c of geoControls(n)) {
            const param = c.role === "parameter" || c.path === -1;
            if (c.role === "in" || c.role === "out") edges([{ a: geometryPath(n, c.path)!.nodes[c.index].p, b: c.point }], "#377973", 1);
            const active = map.vertex && (["path", "role", "index"] as (keyof GeoControl)[]).every(k => map.vertex![k] === c[k]);
            dot(c.point, param ? "#894a86" : "#12696a", !!active, c.role === "vertex" || param ? 4 : 3);
        }
    }
    ctx.save();
    const owner = map.selection?.kind === "geoNode" ? d.geoNodes.find(n => n.id === map.selection!.id) : undefined;
    if (owner && !draft) controls(map.dragNode ?? owner);
    if (draft) {
        if (draft.tool === "strip") {
            edges(draft.spine ?? [], "#d37627", 3);
            const upper = d.geoNodes.findLast(n => draft.ids.includes(n.id));
            if (upper?.construction.type === "free") for (const path of upper.construction.paths) for (const v of path.nodes)
                dot(v.p, "#855021", draft.anchors.includes(v.id), 4.5);
        }
        else {
            if (draft.path) edges(flattenPath(draft.path, .5 / scale), "#12696a", 2, [5, 3]);
            else {
                const pts = [...(draft.start ? [draft.start] : []), ...draft.nodes.map(v => v.p), ...(draft.cursor ? [draft.cursor] : [])];
                edges(pts.slice(1).map((b, i) => ({ a: pts[i], b })), "#894a86", 2, [5, 3]);
            }
            for (const v of draft.nodes) dot(v.p, "#12696a");
        }
    }
    if (map.profilePoint) dot(map.profilePoint, "#b24933", false, 6);
    ctx.restore();
}
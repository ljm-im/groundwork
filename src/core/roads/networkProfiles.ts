import { type Alignment, type Route, type Terrain } from "../design/results.ts";
import { nodePose } from "../design/model.ts";
import { padCell } from "../design/shapes.ts";
import { type Design } from "../design/v5.ts";
import { sampleDefined } from "../math/geometry.ts";
import { profile } from "./profiles.ts";

// Edges share their node's survey elevation even when a fillet moves a horizontal endpoint.
function nodeElevations(design: Design, terrain: Terrain) {
    const { grid, heights, defined } = terrain;
    const elevations = new Map<string, number>(), doors = new Set<string>();
    for (const node of design.nodes) {
        const building = node.type === "door" ? design.buildings.findIndex(b => b.id === node.building) : -1;
        if (building >= 0 && terrain.pads[building].length) {
            doors.add(node.id);
            elevations.set(node.id, heights[padCell(grid, terrain.pads[building], design.buildings[building].center)]);
        }
        else elevations.set(node.id, sampleDefined(grid, heights, defined, ...nodePose(design, node).point) ?? 0);
    }

    // Connected deck spans share one level, including ordinary roads at either end.
    // Prefer an attached threshold, otherwise use the first span's start in design order.
    const adjacent = new Map<string, string[]>();
    for (const { levelDeck, from, to } of design.edges) if (levelDeck) {
        if (!adjacent.has(from)) adjacent.set(from, []);
        if (!adjacent.has(to)) adjacent.set(to, []);
        adjacent.get(from)!.push(to);
        adjacent.get(to)!.push(from);
    }
    const visited = new Set<string>();
    for (const start of adjacent.keys()) {
        if (visited.has(start)) continue;
        const group = [start];
        visited.add(start);
        for (const id of group) for (const next of adjacent.get(id)!) {
            if (!visited.has(next)) {
                visited.add(next);
                group.push(next);
            }
        }
        const height = elevations.get(group.find(id => doors.has(id)) ?? start)!;
        for (const id of group) elevations.set(id, height);
    }
    return elevations;
}

export function networkProfiles(design: Design, terrain: Terrain, alignments: (Alignment | Route)[], refresh?: (r: Route) => boolean) {
    const elevations = nodeElevations(design, terrain);
    return alignments.map(r => {
        const start = elevations.get(r.edge.from)!, end = elevations.get(r.edge.to)!;
        if ("h" in r && r.h[0] === start && r.h.at(-1) === end && !refresh?.(r)) return r;
        return profile(design, terrain, r, [start, end]);
    });
}
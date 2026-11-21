import { bearing, bounds, distance, radians } from "../../math/geometry.ts";
import { nodePose, zonePolygon } from "../shapes.ts";
import { type ImportDesign } from "./legacy.ts";
import { type Point } from "../types.ts";

// Older terrain files kept the opening in the grove relative to a particular door.
export function upgradeLandscape(d: ImportDesign) {
    if (d?.version !== 2)
        return d;
    const rules = d.vegetation, view = rules.view;
    for (const [i, peak] of d.peaks.entries()) {
        peak.id ??= "peak-" + (i + 1);
        peak.name ??= peak.id;
    }
    for (const ridge of d.ridges)
        ridge.name ??= ridge.id;
    for (const [i, clearing] of rules.clearings.entries()) {
        clearing.id ??= "clearing-" + (i + 1);
        clearing.name ??= (d.zones.find(z => z.id === clearing.zone)?.name ?? "") + "空地";
    }
    if (view) {
        const origin = d.nodes.find(n => n.id === view.from) ??
      (d.buildings.some(b => b.id === view.building && b.doors.some(door => door.id === view.door))
          ? { type: "door" as const, building: view.building, door: view.door } : null);
        const target = d.zones.find(z => z.id === view.targetZone)?.shape;
        if (origin && target && rules.grove) {
            const center = nodePose(d, origin).point.slice() as Point, box = bounds(zonePolygon(target));
            const angle = bearing(center, ("center" in target ? target.center : undefined) ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]) / radians;
            const home = d.zones.find(z => z.id === rules.grove!.zone)!.shape;
            const homeCenter = (home as { center: Point }).center;
            const radius = Math.max(view.length, distance(homeCenter, center) + rules.grove.radius[1]);
            let id = "grove-opening";
            while (rules.clearings.some(c => c.id === id))
                id += "-1";
            rules.clearings.push({ id, name: "家旁林间空地", cover: "ambient", shape: {
                type: "sector", center, outer: radius, inner: 0, start: angle - view.halfAngle, end: angle + view.halfAngle, samples: 24
            } });
        }
        d.labels = d.labels.filter(label => label.building || label.name !== "家的视线");
        delete rules.view;
    }
    rules.plantings ??= [];
    d.version = 3;
    return d;
}
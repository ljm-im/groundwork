import { defaultInputRange, seedId, seedLabel } from "./defaults.ts";
import { type Design, type Point } from "./v5.ts";

export function newDesign(scalePoint: Point = [0, 0]): Design {
    const min = -32, max = 32;
    const points: Point[] = [[min, min], [max, min], [max, max], [min, max]];
    return { version: 5, grid: { step: 1 }, fields: {},
        inputs: { [seedId]: { label: seedLabel, value: 1, range: defaultInputRange(seedId) }, base: { value: 2, label: "地面标高", range: [0, 20, .5] } },
        geoNodes: [{ id: "ground", label: "地面", function: { type: "ground", value: "{input:base}" },
            construction: { type: "free", paths: [{ closed: true, nodes: points.map((p, i) => ({ id: String(i), mode: "corner", next: "line", p })) }] } }],
        sections: [], marks: [{ id: "mark-1", kind: "scale", label: "比例尺", point: scalePoint, follow: "screen", length: 10 }] };
}
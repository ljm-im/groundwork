import { heightId, reserved } from "./defaults.ts";
import { gridStep, markParameters } from "./functionTable.ts";
import { defaultFollow, type Design, type Point } from "./v5.ts";

export function newDesign(scalePoint: Point = [0, 0]): Design {
    const min = -32, max = 32;
    const points: Point[] = [[min, min], [max, min], [max, max], [min, max]];
    return { version: 5, grid: { step: gridStep.default as number }, fields: structuredClone(reserved.field), curves: {},
        inputs: { ...structuredClone(reserved.input), base: { value: 2, label: "地面标高", range: [0, 20, .5] } },
        geoNodes: [{ id: "ground", label: "地面", field: heightId, function: { type: "ground", value: "{input:base}" },
            construction: { type: "outline", outlines: [{ curve: { closed: true, nodes: points.map((p, i) => ({ id: String(i), mode: "corner", p })) } }] } }],
        sections: [], marks: [{ id: "mark-1", kind: "scale", label: "比例尺", point: scalePoint, follow: defaultFollow("scale"), length: markParameters.scale.default }] };
}
import { heightId, reserved } from "./defaults.ts";
import { gridStep, markParameters } from "./functionTable.ts";
import { defaultFollow, type Design, type Point } from "./v5.ts";

export function newDesign(screen: Point = [0, 0], point: Point = [0, 0]): Design {
    const min = -32, max = 32;
    const points: Point[] = [[min, min], [max, min], [max, max], [min, max]];
    const design: Design = { version: 5, grid: { step: gridStep.default as number }, fields: structuredClone(reserved.field), geometry: {},
        inputs: { ...structuredClone(reserved.input), base: { value: 2, label: "地面标高", range: [0, 20, .5] } },
        geoNodes: [], sections: [], marks: [] };
    const curve = "curve-1", scale = "point-1";
    design.geometry[curve] = { label: "曲线 1", curve: { closed: true, nodes: points.map((p, i) => ({ id: String(i), mode: "corner", p })) } };
    design.geometry[scale] = { label: "点 1", point };
    design.geoNodes.push({ id: "ground", label: "地面", field: heightId, function: { type: "ground", value: "{input:base}" },
        construction: { type: "outline", outlines: [{ curve }] } });
    design.marks.push({ id: "mark-1", kind: "scale", label: "比例尺", point: { point: scale }, screen,
        follow: defaultFollow("scale"), length: markParameters.scale.default });
    return design;
}
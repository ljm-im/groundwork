import { routingDefaults, unrestrictedRampGrade } from "./defaults.ts";
import { type Design, type Point, type RoadClass } from "./v5.ts";

export function newDesign(): Design {
    const points: Point[] = [[-32, -32], [32, -32], [32, 32], [-32, 32]];
    const rule: RoadClass = { name: "步道", width: 2, comfort: .12, maxGrade: .45, corridor: 12,
        rampLimit: .16, allowStairs: true, stairLimit: .68, enter: .2, exit: .12, minRun: 3,
        keep: .26, shoulder: 2, minRadius: 4, cornerRadius: 2 };
    return { version: 5, grid: { step: 1 }, fields: {}, variables: { seed: { label: "种子", value: 1 }, base: { value: 2, label: "地面标高", range: [0, 20, .5] } },
        geoNodes: [{ id: "ground", name: "地面", function: { type: "ground", value: "{var:base}" },
            construction: { type: "free", paths: [{ closed: true, nodes: points.map((p, i) => ({ id: String(i), mode: "corner", next: "line", p })) }] } }],
        sections: [], labels: [], buildings: [], nodes: [], edges: [],
        roadClasses: { path: rule, street: { ...rule, name: "街道", minRadius: 7, allowStairs: false, rampLimit: .09 },
            stair: { ...rule, name: "台阶", minRadius: 2, maxGrade: .68, rampLimit: unrestrictedRampGrade } },
        routing: { ...routingDefaults },
        vegetation: { density: { natural: 0 }, rooms: [], yardTree: { center: [0, 0], radius: 0 }, plantings: [], clearings: [] } };
}
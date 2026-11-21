import { advance, bearing, bounds, mixPoint, nearest, radians, spline } from "../math/geometry.ts";
import { noise } from "../math/noise.ts";
import { gateFraction, gatePose } from "../edit/yards.js";

const designNoise = noise(99);
export const zoneNoise = (x, y) => designNoise(x / 9 + 50, y / 9 - 20);
export const elevation = (rule, levels) => typeof rule === "number" ? rule : (levels[rule.level] ?? 0) + (rule.offset ?? 0);

export function zonePolygon(shape) {
    if (shape.type === "polygon") return shape.smooth ? spline(shape.points, true, shape.smooth) : shape.points;
    if (shape.type === "band") {
        const left = [],
            right = [],
            p = shape.points;
        for (let i = 0; i < p.length; i++) {
            const a = p[Math.max(0, i - 1)],
                b = p[Math.min(p.length - 1, i + 1)];
            const normal = bearing(a, b) + Math.PI / 2;
            left.push(advance(p[i], normal, shape.width / 2));
            right.push(advance(p[i], normal, -shape.width / 2));
        }
        return left.concat(right.reverse());
    }
    const [cx, cy] = shape.center, points = [];
    if (shape.type === "sector") {
        for (const outer of [true, false]) {
            for (let k = 0; k <= shape.samples; k++) {
                const t = (outer ? k : shape.samples - k) / shape.samples;
                const angle = shape.start + (shape.end - shape.start) * t;
                const r = outer ? shape.outer + (shape.outerNoise ?? 0) * designNoise(angle / 14, 3.1) :
                    shape.inner + (shape.innerNoise ?? 0) * designNoise(angle / 11, 8.7);
                points.push(advance(shape.center, angle * radians, r));
            }
        }
    }
    else {
        for (let i = 0; i < shape.samples; i++) {
            const angle = 2 * Math.PI * i / shape.samples,
                c = Math.cos(angle),
                s = Math.sin(angle);
            if (shape.type === "ellipse") points.push([cx + shape.radii[0] * c, cy + shape.radii[1] * s]);
            else {
                const r = shape.radius + shape.amplitude * designNoise(c * 1.3 + cx / 7, s * 1.3 + cy / 7);
                points.push([cx + r * c, cy + r * s]);
            }
        }
    }
    return points;
}

export function corners(b) {
    const [w, h] = b.size, a = b.angle * radians, c = Math.cos(a), s = Math.sin(a);
    return [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2]
    ].map(([x, y]) => [b.center[0] + x * c - y * s, b.center[1] + x * s + y * c]);
}

export function buildingShape(b) {
    const polygon = b.shape === "rect" ? corners(b) : null;
    const [x, y] = b.center, r = b.radius;
    const box = polygon ? bounds(polygon) : [x - r, y - r, x + r, y + r];
    const angle = (b.angle ?? 0) * radians,
        c = Math.cos(angle),
        s = Math.sin(angle);
    const signedDistance = (px, py) => {
        const dx = px - x,
            dy = py - y;
        if (polygon) {
            const u = Math.abs(dx * c + dy * s) - b.size[0] / 2;
            const v = Math.abs(-dx * s + dy * c) - b.size[1] / 2;
            return Math.sqrt(Math.max(0, u) ** 2 + Math.max(0, v) ** 2) + Math.min(Math.max(u, v), 0);
        }
        const radius = Math.sqrt(dx * dx + dy * dy);
        return b.shape === "ring" ? Math.max(radius - r, b.inner - radius) : radius - r;
    };
    return { data: b, polygon, box, signedDistance };
}

export function areaBoundary(design, area) {
    if (area.points) return area;
    const shape = design.zones.find(z => z.id === area.zone).shape;
    return { ...area, points: zonePolygon(shape), ellipse: shape.type === "ellipse" ? shape : null };
}

function attachedPose(design, node) {
    if (node.type === "gate") {
        const area = design.yards.find(y => y.id === node.yard);
        return gatePose(areaBoundary(design, area), node.at);
    }
    if (node.type !== "door") return { point: node.point, angle: null };
    const b = design.buildings.find(b => b.id === node.building),
        door = b.doors.find(d => d.id === node.door);
    if (b.shape !== "rect") return { point: advance(b.center, door.angle * radians, b.radius), angle: door.angle * radians };
    const walls = corners(b),
        a = walls[door.wall],
        end = walls[(door.wall + 1) % 4];
    return { point: mixPoint(a, end, door.t), angle: bearing(a, end) - Math.PI / 2 };
}

export function nodePose(design, node) {
    if (typeof node === "string") node = design.nodes.find(n => n.id === node);
    const pose = attachedPose(design, node);
    if (node.type === "door" || node.type === "gate") pose.normal = pose.angle;
    if (node.direction != null) pose.angle = node.direction * radians;
    return pose;
}

export function moveNode(design, node, p) {
    if (node.type === "gate") {
        node.at = gateFraction(areaBoundary(design, design.yards.find(y => y.id === node.yard)), p);
        return;
    }
    if (node.type !== "door") {
        node.point = p;
        return;
    }
    const b = design.buildings.find(b => b.id === node.building),
        door = b.doors.find(d => d.id === node.door);
    if (b.shape !== "rect") door.angle = bearing(b.center, p) / radians;
    else {
        const hit = nearest(...p, corners(b), true);
        door.wall = hit.segment;
        door.t = hit.t;
    }
}

export function clearingShape(d, area) {
    return area.shape ?? { type: "ellipse", center: d.zones.find(z => z.id === area.zone).shape.center, radii: area.radii, samples: 48 };
}
import { random } from "./noise.js";

export function erode(grid, land, surface, config, seed) {
    const { width, height, size, step } = grid;
    const scaled = Float32Array.from(surface, h => h / 30);
    const flow = new Float32Array(size),
        delta = new Float32Array(size);
    const radius = config.radius / step,
        rim = Math.ceil(radius) + 1,
        offsets = [],
        weights = [];
    let sum = 0;
    for (let y = -Math.floor(radius); y <= radius; y++)
        for (let x = -Math.floor(radius); x <= radius; x++) {
            const d = Math.hypot(x, y);
            if (d <= radius) {
                offsets.push(y * width + x);
                weights.push(1 - d / (radius + .01));
                sum += weights.at(-1);
            }
        }
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
    const next = random(seed + 7),
        lifetime = Math.ceil(config.lifetime / step);
    const { inertia, capacity, minCapacity, deposition, erosion, evaporation, gravity } = config;
    for (let drop = 0; drop < config.droplets; drop++) {
        let x = next() * (width - 2 * rim) + rim,
            y = next() * (height - 2 * rim) + rim;
        let dx = 0,
            dy = 0,
            speed = 1,
            water = 1,
            sediment = 0;
        for (let age = 0; age < lifetime; age++) {
            const col = Math.floor(x),
                row = Math.floor(y),
                fx = x - col,
                fy = y - row,
                k = row * width + col;
            const a = scaled[k],
                b = scaled[k + 1],
                c = scaled[k + width],
                d = scaled[k + width + 1];
            if (a < .012 || !land[k]) break;
            const gx = (b - a) * (1 - fy) + (d - c) * fy,
                gy = (c - a) * (1 - fx) + (d - b) * fx;
            const old = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
            dx = dx * inertia - gx * (1 - inertia);
            dy = dy * inertia - gy * (1 - inertia);
            const len = Math.hypot(dx, dy);
            if (len < 1e-7) break;
            dx /= len;
            dy /= len;
            x += dx;
            y += dy;
            if (x < rim || y < rim || x >= width - rim || y >= height - rim) break;
            flow[k] += water;
            const j = Math.floor(y) * width + Math.floor(x),
                ax = x % 1,
                ay = y % 1;
            const dh = scaled[j] * (1 - ax) * (1 - ay) + scaled[j + 1] * ax * (1 - ay) +
        scaled[j + width] * (1 - ax) * ay + scaled[j + width + 1] * ax * ay - old;
            const cap = Math.max(-dh * speed * water * capacity, minCapacity);
            if (sediment > cap || dh > 0) {
                const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposition;
                sediment -= amount;
                scaled[k] += amount * (1 - fx) * (1 - fy);
                scaled[k + 1] += amount * fx * (1 - fy);
                scaled[k + width] += amount * (1 - fx) * fy;
                scaled[k + width + 1] += amount * fx * fy;
            }
            else {
                const amount = Math.min((cap - sediment) * erosion, -dh);
                for (let i = 0; i < offsets.length; i++) {
                    const cell = k + offsets[i],
                        taken = Math.min(scaled[cell], amount * weights[i]);
                    scaled[cell] -= taken;
                    sediment += taken;
                }
            }
            speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
            water *= 1 - evaporation;
        }
    }
    for (let k = 0; k < size; k++)
        if (land[k] && surface[k] > 0) delta[k] = Math.max(-7, Math.min(3, scaled[k] * 30 - surface[k]));
    return { flow, delta };
}
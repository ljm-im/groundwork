import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { fixtureOptions, readFixture } from "../configs/read-fixture.ts";
import { previewLevels } from "../src/app/state/levelPreview.ts";
import { elevation, parseDesign, serializeDesign } from "../src/core/design/model.ts";
import { type Design } from "../src/core/design/types.ts";
import { placeBuilding, removeBuildingPart, resizeRadius, rotateBuilding, setShape } from "../src/core/edit/buildings.ts";
import { History } from "../src/core/edit/history.ts";
import { addFeature } from "../src/core/edit/landforms.ts";
import { exportIsland, serializeExport } from "../src/core/export.ts";
import { Island } from "../src/core/island.ts";
import { TerrainCache } from "../src/core/terrain/cache.ts";
import { generateTerrain } from "../src/core/terrain/terrain.ts";
import { syntheticDesign } from "./scenarios.ts";

const digest = (input: string | Uint8Array) => createHash("sha256").update(input).digest("hex");

// Compare every typed view as raw bytes (including signed zero), and compare the authored and
// computed objects independent of insertion order. Grid and distance functions are closures.
function fingerprint(value: unknown) {
    return digest(JSON.stringify(value, (_, v: unknown) => {
        if (ArrayBuffer.isView(v)) return [v.constructor.name, v.byteLength, digest(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))];
        if (typeof v === "number" && (Object.is(v, -0) || !Number.isFinite(v))) return ["number", Object.is(v, -0) ? "-0" : String(v)];
        if (v && typeof v === "object" && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
        return v;
    }));
}

function compareIsland(actual: Island, step: string) {
    const text = serializeDesign(actual.design), expected = new Island(parseDesign(text));
    for (const field of ["terrain", "routes", "treeCandidates", "trees", "graded", "issues"] as const)
        assert.equal(fingerprint(actual[field]), fingerprint(expected[field]), step + " " + field);
    for (const [i, b] of actual.terrain.buildings.entries()) {
        const other = expected.terrain.buildings[i];
        for (const p of [b.data.center, [b.box[0], b.box[1]], [b.box[2], b.box[3]]])
            assert.equal(b.signedDistance(p[0], p[1]), other.signedDistance(p[0], p[1]), step + " building distance");
    }
    const source = { sha256: digest(text), commit: "0".repeat(40) };
    assert.equal(digest(serializeExport(exportIsland(actual, source))), digest(serializeExport(exportIsland(expected, source))), step + " export bytes");
}

function sampleDesign() {
    const d = syntheticDesign();
    d.levels.B = 18;
    d.levelControls.B = ["B", 0, 30, 1];
    addFeature(d, "ridge", [[-16, 7], [5, 2]], [{ level: "B", offset: 1 }, 12]);
    addFeature(d, "peak", [[8, 9]], { level: "B", offset: 2 });
    d.zones.push({ id: "Z2", name: "Z2", priority: 2, shape: { type: "polygon", points: [[4, -8], [14, -8], [14, -2], [4, -2]] },
        height: { level: "A", endRise: { level: "A", center: [0, 0], start: 20, inSpan: 30, end: 260, outSpan: 30, fade: [3, 16] } } });
    d.yards = [{ id: "Y", name: "Y", zone: "Z2", buildings: [], points: [[5, -7], [13, -7], [13, -3], [5, -3]] }];
    return parseDesign(serializeDesign(d));
}

function editSequence(design: Design) {
    const cache = new TerrainCache(), history = new History(design);
    type Miss = ReturnType<TerrainCache["missing"]>;
    function rebuild(label: string, miss: Miss, site: number) {
        const before = { ...cache.counts };
        assert.equal(cache.missing(design), miss, label + " preflight");
        const island = new Island(design, cache);
        assert.deepEqual(cache.counts, { base: before.base + Number(miss === "base"),
            erosion: before.erosion + Number(miss !== null), site: before.site + site }, label);
        compareIsland(island, label);
        return island;
    }
    rebuild("open", "base", 1);
    // The public uncached entry point has the same arrays before the router adds its workspace.
    assert.equal(fingerprint(cache.generate(design)), fingerprint(generateTerrain(design)));
    function edit(label: string, change: () => void, miss: Miss = null, site = 1) {
        change();
        const island = rebuild(label, miss, site);
        assert(history.record(design), label);
        return island;
    }
    const building = design.buildings.find(b => b.shape === "rect")!;
    edit("move building", () => building.center[0] += 1);
    edit("resize building", () => building.size![0] += 1);
    edit("building height", () => building.height += 1, null, 0);
    edit("rotate rectangle", () => rotateBuilding(building, building.angle! + 15));
    edit("change footprint", () => setShape(design, building, "circle"));
    edit("building radius", () => resizeRadius(building, building.radius! + 1));
    edit("rotate circular building", () => rotateBuilding(building, building.angle! + 15), null, 0);
    edit("remove building", () => removeBuildingPart(design, building));
    edit("place building", () => placeBuilding(design, [...building.center]));
    const shape = design.zones.map(z => z.shape).find(s => s.type === "polygon")!;
    edit("zone control", () => shape.points[0][1] += .5);
    const boundary = design.yards!.find(y => y.points)!.points!;
    edit("yard control", () => boundary[0][1] -= .5);
    const rise = design.zones.find(z => z.height.endRise)!.height.endRise!;
    edit("street end rise", () => rise.fade[1] += 1);

    const verts = design.ridges.flatMap(r => r.points);
    const crest = verts.map(p => p.height).find(h => typeof h !== "number")!.level;
    const referenced = new Set([...verts, ...design.peaks].map(p => p.height).flatMap(h => typeof h === "number" ? [] : [h.level]));
    const zone = design.zones.map(z => z.height.level).find(key => key && !referenced.has(key))!;
    assert(zone && crest);
    edit("zone-only elevation", () => design.levels[zone] += 1);
    edit("ridge elevation", () => design.levels[crest] += 1, "natural");
    edit("coast control", () => design.coast.points[0][0] += 1, "base");
    design = history.step(false)!;
    rebuild("undo coast", null, 0);
    design = history.step(true)!;
    rebuild("redo coast", null, 0);
    edit("ridge control", () => design.ridges[0].points[0].point[0] -= 1, "base");
    edit("peak center", () => design.peaks[0].center[1] += 1, "base");
    edit("seed", () => design.seed++, "base");
    edit("erosion", () => design.erosion.droplets++, "natural");
    design = history.step(false)!;
    const island = rebuild("undo erosion", null, 0);

    for (const [key, cost] of [[zone, 0], [crest, 1]] as const) {
        // Hold every resident entry, even one that a later release legitimately evicts.
        const entries = [...cache["bases"].values(), ...cache["grounds"].values(), ...cache["sites"].values()];
        const oldBytes = entries.map(fingerprint), before = { ...cache.counts };
        const originalNatural = island.terrain.natural;
        design.levels[key] += 2;
        previewLevels(island, new Set([key]));
        assert.equal(island.terrain.natural === originalNatural, !cost);
        assert.deepEqual(entries.map(fingerprint), oldBytes, key + " preview mutated a cached entry");
        assert.deepEqual(cache.counts, before);
        island.levels(true);
        assert.deepEqual(cache.counts, { base: before.base, erosion: before.erosion + cost, site: before.site + 1 });
        assert.deepEqual(entries.map(fingerprint), oldBytes, key + " release mutated a cached entry");
        compareIsland(island, key + " release");
    }
}

test("Cached edits and level previews reproduce a freshly reopened synthetic island", () => editSequence(sampleDesign()));
test("Cached edits and level previews reproduce a freshly reopened archival island", fixtureOptions("round6.json"), async () =>
    editSequence(parseDesign(await readFixture("round6.json"))));

test("Cache hits bind geometry and distance functions to the current design objects", () => {
    const d = sampleDesign(), cache = new TerrainCache();
    const first = cache.generate(d), next = parseDesign(serializeDesign(d));
    for (const item of [...next.ridges, ...next.peaks, ...next.zones, ...next.buildings, ...next.yards!]) item.name += "2";
    next.zones[0].prompt = "B";
    next.buildings[0].height++;
    const peak = next.peaks[0];
    peak.height = elevation(peak.height, next.levels);
    const t = cache.generate(next);
    assert.deepEqual(cache.counts, { base: 1, erosion: 1, site: 1 });
    assert.equal(fingerprint(t), fingerprint(generateTerrain(next)));
    assert.equal(t.ridges[0].points, next.ridges[0].points);
    assert.equal(t.peaks[0].center, next.peaks[0].center);
    assert.equal(t.zones[0].height, next.zones[0].height);
    const zone = next.zones.find(z => z.shape.type === "polygon")!;
    assert(zone.shape.type === "polygon");
    assert.equal(t.zones.find(z => z.id === zone.id)!.polygon, zone.shape.points);
    zone.shape.points[0][0]++;
    assert.equal(fingerprint(cache.generate(d)), fingerprint(first));
    assert.equal(t.buildings[0].data, next.buildings[0]);
    assert.equal(t.yards[0].yard, next.yards![0]);
    assert.notEqual(t.heights, first.heights);
    assert.equal(t.natural, first.natural);
    next.buildings[0].size![0] += 8;
    const at = next.buildings[0].center;
    assert.notEqual(t.buildings[0].signedDistance(at[0] + 5, at[1]), first.buildings[0].signedDistance(at[0] + 5, at[1]));
});

test("Geometry and natural surfaces independently evict the least recently used of four", () => {
    const cache = new TerrainCache(), original = sampleDesign();
    const designs = Array.from({ length: 5 }, (_, i) => ({ ...original, seed: original.seed + i }));
    for (const d of designs.slice(0, 4)) cache.generate(d);
    cache.generate(designs[0]);
    assert.equal(cache.missing(designs[1]), null);
    cache.generate(designs[4]);
    assert.deepEqual(designs.map(d => cache.missing(d)), [null, "base", null, null, null]);
    const variants = Array.from({ length: 5 }, (_, i) => ({ ...original, erosion: { ...original.erosion, droplets: original.erosion.droplets + i } }));
    for (const d of variants.slice(0, 4)) cache.generate(d);
    cache.generate(variants[0]);
    cache.generate(variants[4]);
    assert.deepEqual(variants.map(d => cache.missing(d)), [null, "natural", null, null, null]);
    assert.equal(cache.counts.base, 5);
    cache.clear();
    assert.equal(cache.missing(original), "base");
    assert.deepEqual([cache["bases"].size, cache["grounds"].size, cache["sites"].size], [0, 0, 0]);
});
import { type Building, type Clearing, type Peak, type Planting, type Ridge, type Sector, type Species } from "../../core/design/types.ts";
import { type Feature } from "../../core/edit/types.ts";
import { elevation } from "../../core/design/model.ts";
import { featureOf } from "../../core/edit/landforms.ts";
import { doorRoads, resizeRadius, rotateBuilding, setShape } from "../../core/edit/buildings.ts";
import { setSegment } from "../../core/edit/topology.ts";
import * as session from "./session.svelte.ts";
import { checked, numeric, type Editable, type Layer, type Selection } from "../types.ts";

function changeFeature(editor: session.Editor, input: Editable, h: Selection, item: Feature) {
    const d = editor.island.design, key = input.dataset.featureField;
    const at = input.dataset.heightMode ?? input.dataset.heightValue;
    if (!input.validity.valid) {
        editor.revision++;
        return;
    }
    const v = numeric(input);
    if (at != null) {
        const target = at === "peak" ? item as Peak : (item as Ridge).points[Number(at)];
        const mode = input.dataset.heightMode != null ? input.value : typeof target.height === "number" ? undefined : target.height.level;
        const absolute = elevation(target.height, d.levels);
        if (input.dataset.heightMode != null)
            target.height = mode ? { level: mode, offset: absolute - d.levels[mode] } : absolute;
        else if (Number.isFinite(v))
            target.height = mode ? { level: mode, offset: v } : v;
        else {
            editor.revision++;
            return;
        }
    }
    else if (key === "name")
        item.name = input.value.trim() || item.name;
    else if (key === "species")
        (item as Planting).species = input.value as Species;
    else if (key === "ambient") {
        if (checked(input))
            (item as Clearing).cover = "ambient";
        else
            delete (item as Clearing).cover;
    }
    else if (key === "rows" || key === "natural")
        (item as Planting)[key] = checked(input);
    else if (key === "limitZones") {
        if (checked(input)) (item as Planting).zones = [];
        else delete (item as Planting).zones;
    }
    else if (!Number.isFinite(v)) {
        editor.revision++;
        return;
    }
    else if (key === "minSize" || key === "maxSize")
        (item as Planting).size[key === "minSize" ? 0 : 1] = v;
    else if (key === "left" || key === "right")
        (item as Ridge).widths[key === "left" ? 0 : 1] = v;
    else if (key === "outer")
        ((item as Clearing).shape as Sector).outer = v;
    else
        Object.assign(item, { [key!]: v });
    editor.finishFeature(h.kind);
}

export function changeField(editor: session.Editor, input: Editable) {
    if (editor.busy) return;
    const d = editor.island.design,
        h = editor.selection;
    if (input.dataset.layer) {
        editor.layer(input.dataset.layer as Layer, checked(input));
        return;
    }
    if (input.dataset.level) {
        editor.flushPending();
        editor.terrainWork(d, () => {
            session.timed("terrain-editor:level-release", () => {
                editor.island.levels(true);
                editor.refresh();
            });
            editor.record();
        });
        return;
    }
    if (input.id === "seed") {
        if (!Number.isSafeInteger(numeric(input))) {
            editor.revision++;
            return;
        }
        d.seed = numeric(input);
        editor.rebuild();
        return;
    }
    if (input.dataset.density) {
        if (input.validity.valid && Number.isFinite(numeric(input))) {
            d.vegetation.density[input.dataset.density] = numeric(input);
            editor.finishFeature("planting");
        }
        else editor.revision++;
        return;
    }
    if (input.dataset.riseRadius != null && h?.kind === "zone") {
        const rise = d.zones.find(z => z.id === h.id)!.height.endRise!, index = Number(input.dataset.riseRadius);
        const fade: [number, number] = [...rise.fade];
        fade[index] = numeric(input);
        if (!Number.isFinite(fade[index]) || fade[0] < 0 || fade[1] <= fade[0]) {
            editor.message("内半径须为非负数，外半径须大于内半径");
            editor.revision++;
            return;
        }
        rise.fade = fade;
        editor.rebuild();
        return;
    }
    const item = featureOf(d, h);
    if (input.dataset.plantZone && h?.kind === "planting") {
        (item as Planting).zones = d.zones.filter(z => z.id === input.dataset.plantZone ? checked(input) : (item as Planting).zones!.includes(z.id)).map(z => z.id);
        editor.finishFeature("planting");
        return;
    }
    if (item && (input.dataset.featureField || input.dataset.heightMode != null || input.dataset.heightValue != null)) {
        changeFeature(editor, input, h!, item);
        return;
    }
    if (h?.kind === "building") {
        const b = d.buildings.find(item => item.id === h.id)!, key = input.dataset.buildingParam;
        if (input.dataset.doorWall) {
            b.doors.find(door => door.id === input.dataset.doorWall)!.wall = Number(input.value);
            editor.reroute(new Set(doorRoads(d, b, undefined).map((e: { id: string }) => e.id)));
            return;
        }
        if (key) {
            if (!input.validity.valid) {
                editor.revision++;
                return;
            }
            if (key === "name" || key === "showTitle") {
                if (key === "name") b.name = input.value.trim() || b.name;
                else b.showTitle = checked(input);
                editor.record();
                editor.revision++;
                editor.map.draw();
                return;
            }
            if (key === "shape") setShape(d, b, input.value as Building["shape"]);
            else {
                const v = numeric(input);
                if (!Number.isFinite(v)) {
                    editor.revision++;
                    return;
                }
                if (key === "length" || key === "width") b.size![key === "length" ? 0 : 1] = v;
                else if (key === "angle") rotateBuilding(b, v);
                else if (key === "radius") resizeRadius(b, v);
                else b.height = v;
            }
            editor.rebuild();
            return;
        }
    }
    if (h && (input.dataset.mode || input.hasAttribute("data-part-index") || input.hasAttribute("data-exact-via"))) {
        const edge = d.edges.find(e => e.id === h.id)!;
        if (input.hasAttribute("data-part-index")) {
            editor.select({ kind: "edge", id: edge.id, index: Number(input.value) });
            return;
        }
        if (input.dataset.mode === "edge") edge.mode = input.value as typeof edge.mode;
        else if (input.dataset.mode === "segment") setSegment(edge, h.index ?? 0, "mode", input.value as typeof edge.mode);
        else setSegment(edge, h.index!, "exactEnd", checked(input));
        editor.reroute(new Set([edge.id]));
        return;
    }
    if (input.dataset.param && h) {
        const edge = d.edges.find(e => e.id === h.id)!,
            k = input.dataset.param;
        if (k === "name") {
            edge.name = input.value.trim() || edge.name;
            editor.record();
            editor.revision++;
            return;
        }
        if (k === "grade") {
            edge.grade = input.value;
            const rule = d.roadClasses[edge.grade];
            for (const key of ["width", "comfort", "maxGrade", "corridor"] as const) edge[key] = rule[key];
        }
        else if (input.validity.valid && Number.isFinite(numeric(input))) edge[k as "width" | "comfort" | "maxGrade" | "corridor"] = numeric(input) / (["comfort", "maxGrade"].includes(k) ? 100 : 1);
        else {
            editor.revision++;
            return;
        }
        editor.reroute(new Set([edge.id]));
    }
    if (input.dataset.nodeParam && h) {
        const node = d.nodes.find(n => n.id === h.id)!,
            k = input.dataset.nodeParam;
        if (k === "name") {
            node.name = input.value.trim() || node.name;
            editor.record();
            editor.revision++;
            editor.map.draw();
            return;
        }
        if (k === "type") {
            node.type = input.value as typeof node.type;
            if (node.type !== "junction") {
                delete node.through;
                delete node.otherThrough;
            }
        }
        if (k === "direction") {
            if (!input.validity.valid) {
                editor.revision++;
                return;
            }
            if (input.value === "") delete node.direction;
            else node.direction = numeric(input);
        }
        editor.reroute(new Set(d.edges.filter(e => e.from === node.id || e.to === node.id).map(e => e.id)));
    }
}
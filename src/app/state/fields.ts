import { type Building } from "../../core/design/v5.ts";
import { doorRoads, resizeRadius, rotateBuilding, setShape } from "../../core/edit/buildings.ts";
import { setSegment } from "../../core/edit/topology.ts";
import * as session from "./session.svelte.ts";
import { checked, numeric, type Editable, type Layer } from "../types.ts";

export function changeField(editor: session.Editor, input: Editable) {
    if (editor.busy) return;
    const d = editor.island.design,
        h = editor.selection;
    if (input.dataset.layer) {
        editor.layer(input.dataset.layer as Layer, checked(input));
        return;
    }
    if (input.dataset.variable) {
        editor.flushPending();
        editor.terrainWork(d, () => {
            session.timed("terrain-editor:level-release", () => {
                editor.island.variables(true);
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
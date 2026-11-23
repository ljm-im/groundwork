import { type Building } from "../../core/design/v5.ts";
import { setShape } from "../../core/edit/buildings.ts";
import { setSegment } from "../../core/edit/topology.ts";
import { type GridDisplay } from "./layers.ts";
import * as session from "./session.svelte.ts";
import { checked, type Editable, type Layer } from "../types.ts";

export function changeField(editor: session.Editor, input: Editable) {
    if (editor.busy) return;
    const h = editor.selection, key = input.dataset;
    if (key.layer) {
        editor.layer(key.layer as Layer, checked(input));
        return;
    }
    if (key.gridSetting) {
        const setting = key.gridSetting as keyof GridDisplay;
        if (!editor.setGrid(setting, input.value)) input.value = String(editor.displayGrid[setting]);
        return;
    }
    if (!h) return;
    if (h.kind === "building" && key.buildingParam) {
        editor.edit(d => {
            const b = d.buildings.find(item => item.id === h.id)!;
            if (key.buildingParam === "shape") setShape(d, b, input.value as Building["shape"]);
        });
        return;
    }
    if (h.kind === "edge" || h.kind === "via") {
        if (key.partIndex !== undefined) {
            editor.select({ kind: "edge", id: h.id, index: Number(input.value) });
            return;
        }
        if (key.param === "grade") {
            editor.edit(d => {
                const edge = d.edges.find(e => e.id === h.id)!;
                edge.grade = input.value;
                const rule = d.roadClasses[edge.grade];
                for (const k of ["width", "comfort", "maxGrade", "corridor"] as const) edge[k] = rule[k];
            });
        }
        else if (key.mode || key.exactVia !== undefined) {
            const edge = editor.island.design.edges.find(e => e.id === h.id)!;
            if (key.mode === "edge") edge.mode = input.value as typeof edge.mode;
            else if (key.mode === "segment") setSegment(edge, h.index ?? 0, "mode", input.value as typeof edge.mode);
            else setSegment(edge, h.index!, "exactEnd", checked(input));
            editor.reroute(new Set([edge.id]));
        }
    }
    if (h.kind === "node" && key.nodeParam === "type") {
        const d = editor.island.design, node = d.nodes.find(n => n.id === h.id)!;
        node.type = input.value as typeof node.type;
        if (node.type !== "junction") {
            delete node.through;
            delete node.otherThrough;
        }
        editor.reroute(new Set(d.edges.filter(e => e.from === node.id || e.to === node.id).map(e => e.id)));
    }
}
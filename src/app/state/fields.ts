import { type Building } from "../../core/design/v5.ts";
import { setShape } from "../../core/edit/buildings.ts";
import { setSegment } from "../../core/edit/topology.ts";
import { type GridDisplay } from "./layers.ts";
import * as session from "./session.svelte.ts";
import { type Layer } from "../types.ts";

export function changeField(editor: session.Editor, input: HTMLInputElement) {
    if (editor.busy) return;
    const key = input.dataset, h = editor.selection;
    if (key.layer) editor.layer(key.layer as Layer, input.checked);
    if (key.gridSetting) {
        const setting = key.gridSetting as keyof GridDisplay;
        if (!editor.setGrid(setting, input.value)) input.value = String(editor.displayGrid[setting]);
    }
    if (key.exactVia !== undefined && h?.kind === "via") {
        const edge = editor.island.design.edges.find(e => e.id === h.id)!;
        setSegment(edge, h.index!, "exactEnd", input.checked);
        editor.reroute(new Set([edge.id]));
    }
}

export function changeChoice(editor: session.Editor, key: Record<string, string>, value: string) {
    if (editor.busy) return;
    const h = editor.selection;
    if (!h) return;
    if (h.kind === "building" && key.buildingParam === "shape") {
        editor.edit(d => {
            const b = d.buildings.find(item => item.id === h.id)!;
            setShape(d, b, value as Building["shape"]);
        });
    }
    if (h.kind === "edge" || h.kind === "via") {
        if (key.partIndex !== undefined) {
            editor.select({ kind: "edge", id: h.id, index: Number(value) });
            return;
        }
        if (key.param === "grade") {
            editor.edit(d => {
                const edge = d.edges.find(e => e.id === h.id)!;
                edge.grade = value;
                const rule = d.roadClasses[edge.grade];
                for (const k of ["width", "comfort", "maxGrade", "corridor"] as const) edge[k] = rule[k];
            });
        }
        else if (key.mode) {
            const edge = editor.island.design.edges.find(e => e.id === h.id)!;
            if (key.mode === "edge") edge.mode = value as typeof edge.mode;
            else setSegment(edge, h.index ?? 0, "mode", value as typeof edge.mode);
            editor.reroute(new Set([edge.id]));
        }
    }
    if (h.kind === "node" && key.nodeParam === "type") {
        const d = editor.island.design, node = d.nodes.find(n => n.id === h.id)!;
        node.type = value as typeof node.type;
        if (node.type !== "junction") {
            delete node.through;
            delete node.otherThrough;
        }
        editor.reroute(new Set(d.edges.filter(e => e.from === node.id || e.to === node.id).map(e => e.id)));
    }
}
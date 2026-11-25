import { composingKey } from "./numbers.ts";
import { commitFocusedInput } from "./pendingInput.ts";
import { defaultFollow } from "../../core/design/v5.ts";
import { heightId } from "../../core/design/defaults.ts";
import { distance, onCanvas } from "../../core/math/geometry.ts";
import { moveHandle, sectionHandlePoint } from "../../core/edit/controls.ts";
import { editControl, geometryPath, hitControl, hitPathSegment, type GeoControl } from "../../core/edit/geoControls.ts";
import { setNodeMode } from "../../core/edit/paths.ts";
import { doubleClickTools, draftPointer, geoAt, snapPoint, updatePreview } from "./geoTools.ts";
import { type GeoDraft } from "../../core/edit/types.ts";
import { hasSamples } from "../../render/map.ts";
import { errorText, type Point } from "../types.ts";
import * as session from "./session.svelte.ts";

declare global {
    interface HTMLElementEventMap {
        gesturestart: MouseEvent & { scale: number };
        gesturechange: MouseEvent & { scale: number };
        gestureend: MouseEvent & { scale: number };
    }
}

export function attachController(editor: session.Editor, canvas: HTMLCanvasElement) {
    const map = editor.map, listeners = new AbortController(), signal = listeners.signal;
    function localPoint(ev: MouseEvent): Point {
        const box = canvas.getBoundingClientRect();
        return [ev.clientX - box.left, ev.clientY - box.top];
    }
    let lastWheel = -Infinity, wheelMode = "pan", pinchScale = 0;
    let hoverFrame = 0, hoverPoint: Point, hoverAlternate = false;
    canvas.addEventListener("wheel", ev => {
        ev.preventDefault();
        if (!editor.project || pinchScale) return;
        if (ev.ctrlKey || ev.metaKey) {
            map.zoomAt(Math.exp(-Math.max(-100, Math.min(100, ev.deltaY)) * .012), ...localPoint(ev));
            lastWheel = -Infinity;
            return;
        }
        const y = Math.abs(ev.deltaY);
        if (ev.deltaX) wheelMode = "pan";
        else if (ev.timeStamp - lastWheel > 150) {
            const ticks = y > 0 && (y % 100 === 0 || y % 120 === 0 ||
        ((ev as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY && Math.abs((ev as WheelEvent & { wheelDeltaY: number }).wheelDeltaY) % 120 === 0 && y >= 40));
            wheelMode = ev.deltaMode || ticks ? "zoom" : "pan";
        }
        lastWheel = ev.timeStamp;
        if (wheelMode === "zoom") {
            const delta = ev.deltaY * (ev.deltaMode === 1 ? 32 : ev.deltaMode === 2 ? map.height : 1);
            map.zoomAt(Math.exp(-Math.max(-500, Math.min(500, delta)) * .0015), ...localPoint(ev));
        }
        else {
            map.panTo([map.center[0] + ev.deltaX / map.scale, map.center[1] - ev.deltaY / map.scale]);
        }
    }, { passive: false, signal });
    canvas.addEventListener("gesturestart", ev => {
        ev.preventDefault();
        pinchScale = ev.scale || 1;
    }, { signal });
    canvas.addEventListener("gesturechange", ev => {
        ev.preventDefault();
        if (editor.project && pinchScale && ev.scale > 0) map.zoomAt(ev.scale / pinchScale, ...localPoint(ev));
        pinchScale = ev.scale;
    }, { signal });
    canvas.addEventListener("gestureend", ev => {
        ev.preventDefault();
        pinchScale = 0;
    }, { signal });

    function beginPan(ev: PointerEvent, screen: Point, click?: () => void) {
        ev.preventDefault();
        editor.gesture = { pan: true, middle: ev.button === 1, screen, center: map.center.slice(), pointer: ev.pointerId, click };
    }

    function pick(screen: Point, alt = false, context = false) {
        const view = editor.mapView!, p = map.world(...screen), h = map.hitHandle(view, ...screen);
        const selected = editor.selection?.kind === "geoNode" && editor.mapProject.design.geoNodes.find(n => n.id === editor.selection!.id);
        const control = selected && hitControl(selected, p, map.scale, editor.mapProject.design.grid.step / 8, editor.geometry);
        const geo = selected && control ? { kind: "geo" as const, id: selected.id, control } : undefined;
        if (geo && (context || control && control.role !== "segment")) return geo;
        const mark = !alt && map.hitMark(...screen);
        if (mark) return { kind: "handle" as const, h: mark };
        const hits = map.issueHits(view, screen);
        if (hits.length && !alt && !context) return { kind: "issues" as const, hits };
        if (!alt && !context) {
            const parameter = map.hitParameter(view, p);
            if (parameter) return parameter;
        }
        if (geo) return geo;
        if (h && !alt) return { kind: "handle" as const, h };
        const section = !alt && map.hitSection(view, p);
        if (section) return { kind: "section" as const, section };
        if (context) {
            const { terrain, design } = editor.mapProject, margin = 5 / map.scale;
            for (const node of design.geoNodes.toReversed()) {
                if (hasSamples(terrain) && (node.disabled || !editor.layers.geoNodes && !node.outline && !node.fill)) continue;
                const box = terrain.regions.get(node.id)?.shape.box;
                if (!box || p[0] < box[0] - margin || p[0] > box[2] + margin || p[1] < box[1] - margin || p[1] > box[3] + margin) continue;
                const control = hitPathSegment(node, p, map.scale, design.grid.step / 8);
                if (control) return { kind: "geo" as const, id: node.id, control };
            }
        }
        const node = map.pickGeo(view.project, p, alt && selected ? selected.id : undefined);
        if (node) return { kind: "geo" as const, id: node.id,
            control: { role: "body", path: 0, index: 0, point: p } as GeoControl };
    }
    function updateHover() {
        hoverFrame = 0;
        if (editor.tool !== "select" || editor.gesture || editor.busy) return;
        const hit = pick(hoverPoint, hoverAlternate);
        if (hit?.kind === "geo") editor.hoverSelection({ kind: "geoNode", id: hit.id });
        else if (hit?.kind === "handle") editor.hoverSelection(hit.h);
        else if (hit?.kind === "section") editor.hoverSelection(hit.section);
        else editor.hoverSelection();
    }
    canvas.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        if (!editor.project || editor.busy || editor.geoDraft) return;
        const hit = pick(localPoint(ev), false, true);
        editor.menu = null;
        if (!hit || hit.kind === "issues") return;
        if (hit.kind === "geo")
            editor.openMenu({ kind: "geoNode", id: hit.id }, ev.clientX, ev.clientY, true, hit.control);
        else editor.openMenu(hit.kind === "section" ? hit.section : hit.h, ev.clientX, ev.clientY, true);
    }, { signal });
    function beginPointer(ev: PointerEvent) {
        const screen = localPoint(ev), p = map.world(...screen);
        if (ev.button === 1) {
            beginPan(ev, screen);
            return;
        }
        if (editor.geoDraft) {
            ev.preventDefault();
            try {
                draftPointer(editor, "down", p, ev);
            }
            catch (error) {
                editor.message(errorText(error));
            }
            return;
        }
        if (editor.tool === "textMark" || editor.tool === "scaleMark") {
            const tool = editor.tool, kind = tool === "scaleMark" ? "scale" : "text";
            const point = map.markCoordinate(screen, defaultFollow(kind));
            beginPan(ev, screen, () => {
                if (editor.tool === tool) void editor.addMark(kind, point);
            });
            return;
        }
        const label = !ev.altKey && !map.hitMark(...screen) && map.hitLabel(...screen);
        if (label) {
            ev.preventDefault();
            const { kind, id, point } = label;
            editor.gesture = { label: { kind, id }, offset: [point[0] - p[0], point[1] - p[1]], screen, pointer: ev.pointerId };
            canvas.setPointerCapture(ev.pointerId);
            return;
        }
        selectAt(screen, ev.altKey, ev);
    }
    function selectAt(screen: Point, alternate: boolean, ev?: PointerEvent) {
        const hit = pick(screen, alternate);
        if (hit?.kind === "geo") {
            if (alternate && hit.control.role === "segment") {
                editor.insertNode(hit.id, hit.control); return;
            }
            editor.select({ kind: "geoNode", id: hit.id });
            const n = geoAt(editor.project.design, hit.id), c = hit.control;
            if (c.role === "parameter" || c.role === "parameterSegment" || c.path < 0)
                editor.focusFunctionGeometry(n, c);
            else if (c.role === "vertex") editor.pickVertex(c);
            if (ev && c.role !== "segment" && c.role !== "parameterSegment" && (c.role !== "body" || n.construction.type === "free"))
                editor.gesture = { geo: n, control: c, screen, pointer: ev.pointerId };
            return;
        }
        if (hit?.kind === "handle") {
            const h = hit.h;
            editor.select(h);
            if (ev) {
                const mark = h.kind === "mark" ? editor.project.design.marks.find(m => m.id === h.id)! : undefined;
                const at = mark ? map.markCoordinate(screen, mark.follow) : map.world(...screen);
                editor.gesture = { handle: h, offset: [h.point[0] - at[0], h.point[1] - at[1]], screen, pointer: ev.pointerId };
            }
            return;
        }
        const click = hit?.kind === "issues" ? () => editor.pickMarkers(hit.hits) :
            () => editor.select(hit?.kind === "section" ? hit.section : null);
        if (ev) beginPan(ev, screen, click);
        else click();
    }

    type DrawingClick = { draft: GeoDraft; nodeCount: number };
    let firstClick: DrawingClick | undefined;
    let press: { down: PointerEvent; drawing?: DrawingClick; state: "active" | "pending" | "double"; up?: PointerEvent } | undefined;
    canvas.addEventListener("pointerdown", ev => {
        if (!editor.project || editor.busy || editor.gesture || (ev.button !== 0 && ev.button !== 1)) return;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(ev.pointerId);
        const draft = editor.geoDraft;
        const drawing = ev.button === 0 && draft && doubleClickTools.includes(draft.tool) ? { draft, nodeCount: draft.nodes.length } : undefined;
        // The first click may already have closed the path and switched tools.
        press = { down: ev, drawing, state: ev.button === 0 && firstClick ? "pending" : "active" };
        if (press.state === "active") beginPointer(ev);
    }, { signal });
    canvas.addEventListener("mousedown", ev => {
        if (press?.state !== "pending" || press.up || ev.button !== 0) return;
        // Mouse clicks report their count on press. Touch taps can report it only after release.
        ev.preventDefault();
        if (ev.detail === 2) press.state = "double";
        else {
            firstClick = undefined;
            press.state = "active";
            beginPointer(press.down);
        }
    }, { signal });
    canvas.addEventListener("click", ev => {
        const current = press;
        press = undefined;
        if (ev.detail === 2 && firstClick) return;
        firstClick = ev.detail === 1 ? current?.drawing : undefined;
        if (current?.up && editor.project && !editor.busy) {
            if (current.state !== "active") beginPointer(current.down);
            void finishGesture(current.up);
        }
    }, { signal });
    canvas.addEventListener("dblclick", ev => {
        const first = firstClick;
        firstClick = undefined;
        if (!editor.project || editor.busy || ev.button !== 0) return;
        const draft = first?.draft ?? editor.geoDraft;
        if (draft && doubleClickTools.includes(draft.tool)) {
            ev.preventDefault();
            if (editor.geoDraft === draft) {
                draft.down = draft.downRaw = undefined;
                if (first) draft.nodes.splice(first.nodeCount);
                updatePreview(editor, draft);
                void editor.completeDrawing();
            }
            return;
        }
        if (ev.altKey || editor.tool !== "select") return;
        ev.preventDefault();
        const screen = localPoint(ev), hit = pick(screen);
        if (hit?.kind === "geo") {
            const c = hit.control;
            if (c.role === "segment") editor.insertNode(hit.id, c);
            if (c.role === "vertex") editor.editNode(hit.id, n => {
                const path = geometryPath(n, c.path)!;
                setNodeMode(path, c.index, path.nodes[c.index].mode === "auto" ? "corner" : "auto");
            });
        }
    }, { signal });
    canvas.addEventListener("pointermove", ev => {
        if (!editor.project) return;
        const screen = localPoint(ev),
            p = map.world(...screen),
            d = editor.project.design;
        editor.readPosition(p);
        if (press && press.state !== "active" && press.down.pointerId === ev.pointerId && !press.up) {
            if (press.state === "double" || distance(screen, localPoint(press.down)) <= 3) return;
            press.state = "active";
            beginPointer(press.down);
        }
        if (editor.geoDraft && !editor.gesture && !editor.busy) {
            try {
                draftPointer(editor, "move", p, ev);
            }
            catch (error) {
                editor.message(errorText(error));
            }
            return;
        }
        if (!editor.gesture) {
            canvas.style.cursor = editor.tool === "select" ? "default" : "crosshair";
            if (editor.tool === "select") {
                hoverPoint = screen; hoverAlternate = ev.altKey;
                hoverFrame ||= requestAnimationFrame(updateHover);
            }
            return;
        }
        if (editor.gesture.pointer !== ev.pointerId) return;
        if ("pan" in editor.gesture) {
            if (!editor.gesture.changed && distance(screen, editor.gesture.screen) < 3) return;
            editor.gesture.changed = true;
            if (!editor.gesture.middle) return;
            canvas.style.cursor = "grabbing";
            map.panTo([editor.gesture.center[0] - (screen[0] - editor.gesture.screen[0]) / map.scale,
                editor.gesture.center[1] + (screen[1] - editor.gesture.screen[1]) / map.scale]);
            return;
        }
        if (!editor.gesture.changed && distance(screen, editor.gesture.screen) < 2) return;
        editor.gesture.changed = true;
        if ("label" in editor.gesture) {
            const { label, offset } = editor.gesture;
            editor.dragLabel = map.labelOffset(editor.mapProject, label, [p[0] + offset[0], p[1] + offset[1]]);
            return;
        }
        if ("geo" in editor.gesture) {
            const { geo, control } = editor.gesture, copy = structuredClone(geo);
            const at = control.role === "vertex" && !ev.ctrlKey ? snapPoint(editor.mapProject.terrain, editor.mapProject.design, p, map.scale, geo.id) : p;
            editControl(copy, control, at, ev.altKey);
            editor.dragNode = copy; return;
        }
        const h = editor.gesture.handle, mark = h.kind === "mark" ? d.marks.find(m => m.id === h.id)! : undefined;
        const at = mark ? map.markCoordinate(screen, mark.follow) : p;
        const target: Point = [at[0] + editor.gesture.offset[0], at[1] + editor.gesture.offset[1]];
        if (mark) {
            editor.dragMark = { id: h.id, point: target }; return;
        }
        const { grid, fields } = editor.project.terrain;
        if (!onCanvas(grid, fields[heightId].defined, ...target)) return;
        const section = d.sections.find(s => s.id === h.id)!, index = h.index!;
        const point = sectionHandlePoint(section, index, target);
        if (point) editor.dragSection = { id: h.id, index, point };
    }, { signal });

    canvas.addEventListener("pointerleave", () => {
        cancelAnimationFrame(hoverFrame); hoverFrame = 0;
        editor.hoverSelection();
    }, { signal });

    async function finishGesture(ev: PointerEvent) {
        if (editor.geoDraft?.down && !editor.gesture) {
            if (ev.type !== "pointercancel") {
                try {
                    draftPointer(editor, "up", map.world(...localPoint(ev)), ev);
                }
                catch (error) {
                    editor.message(errorText(error));
                }
            }
            return;
        }
        if (!editor.gesture || editor.gesture.pointer !== ev.pointerId) return;
        const g = editor.gesture;
        editor.gesture = null;
        if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
        canvas.style.cursor = "";
        if ("pan" in g) {
            if (!g.changed && ev.type === "pointerup") g.click?.();
            return;
        }
        try {
            if (ev.type !== "pointerup") return;
            if ("label" in g) {
                const drag = editor.dragLabel;
                if (drag) await editor.moveLabel(g.label, drag.offset);
                else if (!g.changed) selectAt(g.screen, false);
            }
            else if ("geo" in g) {
                const copy = editor.dragNode;
                if (copy) {
                    editor.dragCommitting = true;
                    await editor.editNode(copy.id, n => Object.assign(n, copy));
                }
            }
            else {
                const drag = g.handle.kind === "mark" ? editor.dragMark : editor.dragSection;
                if (drag) await editor.edit(d => moveHandle(d, g.handle, drag.point));
            }
        }
        finally {
            editor.dragNode = editor.dragMark = editor.dragLabel = editor.dragSection = undefined;
            editor.dragCommitting = false;
        }
    }
    canvas.addEventListener("pointerup", ev => {
        if (firstClick && press?.down.pointerId === ev.pointerId) {
            const moved = distance(localPoint(ev), localPoint(press.down)) > 3;
            if (press.state === "double" || (!moved && (press.state === "pending" || press.drawing?.draft === firstClick.draft))) {
                press.up = ev;
                return;
            }
            if (press.state === "pending") beginPointer(press.down);
        }
        void finishGesture(ev);
    }, { signal });
    canvas.addEventListener("pointercancel", ev => {
        press = undefined; firstClick = undefined;
        if (editor.tool !== "select") editor.cancelDrawing();
        void finishGesture(ev);
    }, { signal });
    canvas.addEventListener("auxclick", ev => ev.preventDefault(), { signal });
    document.addEventListener("keydown", ev => {
        if (composingKey(ev) || ev.defaultPrevented && !(ev.key === "Escape" && editor.tool !== "select")) return;
        const save = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s";
        if (save) ev.preventDefault();
        if (!editor.project || editor.busy || editor.draft || editor.fileRequest || editor.removal) return;
        const input = ev.target instanceof Element && ev.target.closest("input, select, textarea, [contenteditable=true]");
        if (save) {
            void editor.files.save();
            return;
        }
        const undo = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z";
        if (undo && (!input || editor.tool !== "select")) {
            ev.preventDefault();
            firstClick = undefined;
            editor.navigate(ev.shiftKey);
            return;
        }
        const draft = editor.geoDraft;
        if (draft && (!input || ev.key === "Escape")) {
            if (ev.key === "Escape") {
                ev.preventDefault(); editor.cancelDrawing(); return;
            }
            if (ev.key === "Enter" && !(ev.target instanceof HTMLButtonElement)) {
                ev.preventDefault();
                if (editor.drawing?.finish) void editor.completeDrawing();
                return;
            }
            if (ev.key === "Backspace") {
                ev.preventDefault();
                if (draft.tool === "strip" && !draft.anchors.length && !draft.owner) draft.ids.pop();
                else {
                    draft.nodes.pop(); draft.anchors.pop();
                }
                updatePreview(editor, draft); return;
            }
            if (ev.key === "Tab" && draft.tool === "strip") {
                ev.preventDefault(); draft.reverse = !draft.reverse; updatePreview(editor, draft); return;
            }
        }
        if (ev.key === "Escape" && (!input || editor.tool !== "select")) {
            ev.preventDefault();
            canvas.focus({ preventScroll: true });
            editor.cancelDrawing();
            return;
        }
        if (input) return;
        if (ev.key === "Delete") {
            ev.preventDefault();
            if (!editor.gesture) editor.removeSelected();
        }
    }, { signal });

    window.addEventListener("beforeunload", ev => {
        commitFocusedInput();
        if (editor.dirty || editor.busy) {
            ev.preventDefault();
            ev.returnValue = true;
        }
    }, { signal });
    return () => {
        cancelAnimationFrame(hoverFrame);
        listeners.abort();
    };
}
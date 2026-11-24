import { displayNumber } from "./numbers.ts";
import { defaultFollow } from "../../core/design/v5.ts";
import { distance, onCanvas, sampleDefined } from "../../core/math/geometry.ts";
import { moveHandle } from "../../core/edit/controls.ts";
import { editControl, geometryPath, hitControl, insertPathNode, type GeoControl } from "../../core/edit/geoControls.ts";
import { setNodeMode } from "../../core/edit/paths.ts";
import { nodeIds } from "../../core/edit/geoNodes.ts";
import { doubleClickTools, draftPointer, geoAt, snapPoint, updatePreview } from "./geoTools.ts";
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
            map.center[0] += ev.deltaX / map.scale;
            map.center[1] -= ev.deltaY / map.scale;
            map.draw();
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
        canvas.setPointerCapture(ev.pointerId);
    }

    function pick(screen: Point, alt = false, context = false) {
        const p = map.world(...screen), h = map.hitHandle(...screen);
        const selected = editor.selection?.kind === "geoNode" && map.project.design.geoNodes.find(n => n.id === editor.selection!.id);
        const control = selected && hitControl(selected, p, map.scale, map.project.design.grid.step / 8, map.geometry);
        const geo = selected && control ? { kind: "geo" as const, id: selected.id, control } : undefined;
        if (geo && (context || control && control.role !== "segment")) return geo;
        const mark = !alt && map.hitMark(...screen);
        if (mark) return { kind: "handle" as const, h: mark };
        const hits = map.issueHits(screen);
        if (hits.length && !alt && !context) return { kind: "issues" as const, hits };
        if (geo) return geo;
        if (h && !alt) return { kind: "handle" as const, h };
        const section = !alt && map.hitSection(p);
        if (section) return { kind: "section" as const, section };
        const nodes = map.geoHits(p), index = alt && selected && nodes.length ? (nodes.findIndex(n => n.id === selected.id) + 1) % nodes.length : 0;
        if (nodes[index]) return { kind: "geo" as const, id: nodes[index].id,
            control: { role: "body", path: 0, index: 0, point: p } as GeoControl };
    }
    function updateHover() {
        hoverFrame = 0;
        if (editor.tool !== "select" || editor.gesture || editor.busy) return;
        const hit = pick(hoverPoint, hoverAlternate);
        if (hit?.kind === "geo") map.hoverSelection({ kind: "geoNode", id: hit.id });
        else if (hit?.kind === "handle") map.hoverSelection(hit.h);
        else if (hit?.kind === "section") map.hoverSelection(hit.section);
        else map.hoverSelection();
    }
    function insertGeo(id: string, control: GeoControl) {
        editor.edit(d => {
            insertPathNode(geometryPath(geoAt(d, id), control.path)!, control.index, control.point, nodeIds(d)());
        });
    }
    canvas.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        if (!editor.project || editor.busy || map.draft) return;
        const hit = pick(localPoint(ev), false, true);
        editor.menu = null;
        if (!hit || hit.kind === "issues") return;
        if (hit.kind === "geo")
            editor.openMenu({ kind: "geoNode", id: hit.id }, ev.clientX, ev.clientY, true, hit.control);
        else editor.openMenu(hit.kind === "section" ? hit.section : hit.h, ev.clientX, ev.clientY, true);
    }, { signal });
    canvas.addEventListener("pointerdown", ev => {
        if (!editor.project || editor.busy || editor.gesture) return;
        if (ev.button !== 0 && ev.button !== 1) return;
        canvas.focus({ preventScroll: true });
        const screen = localPoint(ev),
            p = map.world(...screen),
            d = editor.project.design;
        if (ev.button === 1) {
            beginPan(ev, screen);
            return;
        }
        if (map.draft) {
            ev.preventDefault(); canvas.setPointerCapture(ev.pointerId);
            try {
                draftPointer(editor, "down", p, ev);
            }
            catch (error) {
                editor.message(errorText(error));
            }
            return;
        }
        if (editor.tool === "textMark" || editor.tool === "scaleMark") {
            const kind = editor.tool === "scaleMark" ? "scale" : "text";
            const point = map.markCoordinate(screen, defaultFollow(kind));
            beginPan(ev, screen, () => editor.addMark(kind, point, ev.shiftKey));
            return;
        }
        const hit = pick(screen, ev.altKey);
        if (hit?.kind === "geo") {
            if (ev.altKey && hit.control.role === "segment") {
                insertGeo(hit.id, hit.control); return;
            }
            editor.select({ kind: "geoNode", id: hit.id }, true, ev.shiftKey);
            if (ev.shiftKey) return;
            const n = geoAt(d, hit.id), c = hit.control;
            if (c.role === "vertex" || c.role === "parameter") editor.pickVertex(c);
            if (c.role === "segment" || c.role === "body" && n.construction.type !== "free") return;
            editor.gesture = { geo: n, control: c, screen, pointer: ev.pointerId };
            canvas.setPointerCapture(ev.pointerId);
            return;
        }
        if (hit?.kind === "handle") {
            const h = hit.h;
            editor.select(h);
            const mark = h.kind === "mark" ? d.marks.find(m => m.id === h.id)! : undefined;
            const at = mark ? map.markCoordinate(screen, mark.follow) : p;
            editor.gesture = { handle: h, offset: [h.point[0] - at[0], h.point[1] - at[1]], screen, pointer: ev.pointerId };
            canvas.setPointerCapture(ev.pointerId);
            return;
        }
        if (hit?.kind === "issues") {
            beginPan(ev, screen, () => editor.pickMarkers(hit.hits)); return;
        }
        beginPan(ev, screen, () => editor.select(hit?.kind === "section" ? hit.section : null));
    }, { signal });
    canvas.addEventListener("dblclick", ev => {
        if (!editor.project || editor.busy || ev.button !== 0) return;
        if (map.draft && doubleClickTools.includes(map.draft.tool)) {
            ev.preventDefault();
            if (map.draft.clickNode && map.draft.clickNode === map.draft.nodes.at(-1)?.id) map.draft.nodes.pop();
            editor.completeDrawing(ev.shiftKey);
            return;
        }
        if (ev.altKey || editor.tool !== "select") return;
        ev.preventDefault();
        const screen = localPoint(ev), hit = pick(screen);
        if (hit?.kind === "geo") {
            const c = hit.control;
            if (c.role === "segment") insertGeo(hit.id, c);
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
        const height = sampleDefined(map.project.terrain.grid, map.project.terrain.heights, map.project.terrain.defined, ...p);
        editor.position = "X " + displayNumber(p[0], .1) + "   Y " + displayNumber(p[1], .1) + "   H " + displayNumber(height ?? NaN, .1, "m");
        if (map.draft && !editor.gesture && !editor.busy) {
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
            map.center = [editor.gesture.center[0] - (screen[0] - editor.gesture.screen[0]) / map.scale, editor.gesture.center[1] + (screen[1] - editor.gesture.screen[1]) / map.scale];
            map.draw();
            return;
        }
        if (!editor.gesture.changed && distance(screen, editor.gesture.screen) < 2) return;
        editor.gesture.changed = true;
        if ("geo" in editor.gesture) {
            const { geo, control } = editor.gesture, copy = structuredClone(geo);
            const at = control.role === "vertex" && !ev.ctrlKey ? snapPoint(map.project.terrain, map.project.design, p, map.scale, geo.id) : p;
            editControl(copy, control, at, ev.altKey);
            map.dragNode = copy; map.draw(); return;
        }
        const h = editor.gesture.handle, mark = h.kind === "mark" ? d.marks.find(m => m.id === h.id)! : undefined;
        const at = mark ? map.markCoordinate(screen, mark.follow) : p;
        const target: Point = [at[0] + editor.gesture.offset[0], at[1] + editor.gesture.offset[1]];
        if (mark) {
            map.dragMark = { id: h.id, point: target }; map.draw(); return;
        }
        const { grid, defined } = editor.project.terrain;
        if (!onCanvas(grid, defined, ...target)) return;
        moveHandle(d, h, target);
        editor.schedule();
    }, { signal });

    canvas.addEventListener("pointerleave", () => {
        cancelAnimationFrame(hoverFrame); hoverFrame = 0;
        map.hoverSelection();
    }, { signal });

    function finishGesture(ev: PointerEvent) {
        if (map.draft?.down && !editor.gesture) {
            if (ev.type === "pointercancel") editor.cancelDrawing();
            else {
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
        if ("geo" in g) {
            const copy = map.dragNode; map.dragNode = undefined;
            if (g.changed && copy && ev.type === "pointerup") editor.editNode(copy.id, n => Object.assign(n, copy));
            else map.draw();
            return;
        }
        if (g.handle.kind === "mark") {
            const drag = map.dragMark;
            map.dragMark = undefined;
            if (drag && ev.type === "pointerup") return editor.edit(d => moveHandle(d, g.handle, drag.point));
            map.draw(); return;
        }
        if (g.changed) {
            if (ev.type === "pointercancel")
                editor.project.design.sections.find(s => s.id === g.handle.id)!.points[g.handle.index!] = g.handle.point;
            editor.flushPending();
            editor.revision++;
            if (ev.type === "pointerup") editor.record();
        }
    }
    canvas.addEventListener("pointerup", finishGesture, { signal });
    canvas.addEventListener("pointercancel", finishGesture, { signal });
    canvas.addEventListener("auxclick", ev => ev.preventDefault(), { signal });
    document.addEventListener("keydown", ev => {
        const save = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s";
        if (save) ev.preventDefault();
        if (!editor.project || editor.busy || editor.draft || editor.fileRequest || editor.removal) return;
        const input = ev.target instanceof Element && ev.target.closest("input, select, textarea, [contenteditable=true]");
        if (save) {
            if (ev.target instanceof HTMLTextAreaElement && ev.target.hasAttribute("data-prompt")) ev.target.blur();
            void editor.files.save();
            return;
        }
        if (editor.menu && ev.key === "Escape") {
            editor.menu = null; return;
        }
        const draft = map.draft;
        if (draft && (!input || ev.key === "Escape")) {
            if (ev.key === "Escape") {
                ev.preventDefault(); editor.cancelDrawing(); return;
            }
            if (ev.key === "Enter") {
                ev.preventDefault(); if (!["rect", "circle", "sector"].includes(draft.tool)) editor.completeDrawing(ev.shiftKey); return;
            }
            if (ev.key === "Backspace") {
                ev.preventDefault(); draft.nodes.pop(); draft.anchors.pop(); updatePreview(editor, draft); return;
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
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
            ev.preventDefault();
            editor.navigate(ev.shiftKey);
            return;
        }
        if (ev.key === "Delete") {
            ev.preventDefault();
            if (!editor.gesture) editor.removeSelected();
        }
    }, { signal });

    window.addEventListener("beforeunload", ev => {
        const field = document.activeElement;
        if (field instanceof HTMLTextAreaElement && field.hasAttribute("data-prompt")) field.blur();
        if (editor.dirty) {
            ev.preventDefault();
            ev.returnValue = true;
        }
    }, { signal });
    return () => {
        cancelAnimationFrame(hoverFrame);
        listeners.abort();
    };
}
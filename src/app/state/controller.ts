import { composingKey } from "./numbers.ts";
import { commitFocusedInput, isEditableText } from "./pendingInput.ts";
import { distance } from "../../core/math/geometry.ts";
import { moveHandle, moveSection, sectionHandlePoint } from "../../core/edit/controls.ts";
import { commitControl, controlPreview } from "../../core/edit/geoControls.ts";
import { selectionLayers, type SelectionPath } from "../../core/edit/selection.ts";
import { doubleClickTools, draftPointer, updatePreview } from "./geoTools.ts";
import { controlSnap, sectionSnap, type SnapModifiers } from "./mapSnaps.ts";
import { type GeoDraft } from "../../core/edit/types.ts";
import { dragMapHit, mapControlDrag, nextMapHit, type MapHit } from "../../render/map.ts";
import { errorText, type Point } from "../types.ts";
import * as session from "./session.svelte.ts";

declare global {
    interface HTMLElementEventMap {
        gesturestart: MouseEvent & { scale: number };
        gesturechange: MouseEvent & { scale: number };
        gestureend: MouseEvent & { scale: number };
    }
}

function firstEditableHit(hits: Iterable<MapHit>, active: SelectionPath | null) {
    if (!selectionLayers(active).geometry) return;
    for (const hit of hits) if (selectionLayers(hit.path).part) return hit;
}

export function attachController(editor: session.Editor, canvas: HTMLCanvasElement) {
    const map = editor.map, listeners = new AbortController(), signal = listeners.signal;
    function localPoint(ev: MouseEvent): Point {
        const box = canvas.getBoundingClientRect();
        return [ev.clientX - box.left, ev.clientY - box.top];
    }
    let lastWheel = -Infinity, wheelMode = "pan", pinchScale = 0;
    const dragThreshold = 3;
    let hoverFrame = 0, hoverPoint: Point | undefined, hoverAlternate = false;
    let pointerInside = false, spaceHeld = false;
    let lastPointer: { screen: Point; pointerId: number } | undefined;
    canvas.addEventListener("pointerenter", () => pointerInside = true, { signal });
    canvas.addEventListener("wheel", ev => {
        ev.preventDefault();
        if (!editor.project || pinchScale) return;
        const horizontal = ev.shiftKey && !ev.deltaY && !!ev.deltaX;
        const deltaY = horizontal ? ev.deltaX : ev.deltaY, speed = ev.shiftKey ? .25 : 1;
        if (ev.ctrlKey || ev.metaKey) {
            map.zoomAt(Math.exp(-Math.max(-100, Math.min(100, deltaY)) * .012 * speed), ...localPoint(ev));
            lastWheel = -Infinity;
            return;
        }
        const y = Math.abs(deltaY);
        if (ev.deltaX && !horizontal) wheelMode = "pan";
        else if (horizontal || ev.timeStamp - lastWheel > 150) {
            const ticks = y > 0 && (y % 100 === 0 || y % 120 === 0 ||
        ((ev as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY && Math.abs((ev as WheelEvent & { wheelDeltaY: number }).wheelDeltaY) % 120 === 0 && y >= 40));
            wheelMode = ev.deltaMode || ticks ? "zoom" : "pan";
        }
        lastWheel = ev.timeStamp;
        if (wheelMode === "zoom") {
            const delta = deltaY * (ev.deltaMode === 1 ? 32 : ev.deltaMode === 2 ? map.height : 1);
            map.zoomAt(Math.exp(-Math.max(-500, Math.min(500, delta)) * .0015 * speed), ...localPoint(ev));
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

    function beginPan(ev: PointerEvent, screen: Point, pan: "middle" | "space" | "stationary", click?: () => void) {
        ev.preventDefault();
        editor.hoverSelection();
        editor.gesture = { pan, screen, center: map.center.slice(), pointer: ev.pointerId, click };
    }
    function stopSpacePan() {
        if (!spaceHeld) return;
        spaceHeld = false;
        const gesture = editor.gesture;
        if (gesture && "pan" in gesture && gesture.pan === "space") gesture.pan = "stationary";
        if (!gesture || !("pan" in gesture) || gesture.pan !== "middle") canvas.style.cursor = "";
        if (hoverPoint) hoverFrame ||= requestAnimationFrame(updateHover);
    }

    function pick(screen: Point, alternate: boolean) {
        const view = editor.mapView!;
        const hit = nextMapHit(map.objectHits(view, screen), view.selectionPath, alternate);
        if (!alternate && (!hit || hit.path.length === 1 || editor.tab === "issues") &&
            hit?.path[0].kind !== "mark" && !selectionLayers(hit?.path).part) {
            const issues = map.issueHits(view, screen);
            if (issues.length) return { issues };
        }
        return hit;
    }
    function updateHover() {
        hoverFrame = 0;
        if (!editor.mapView || !editor.mapCurrent || !hoverPoint || editor.tool !== "select" || editor.gesture || editor.busy || spaceHeld) return;
        const hit = pick(hoverPoint, hoverAlternate);
        if (!hit || "issues" in hit) return editor.hoverSelection();
        const role = selectionLayers(hit.path).part && hit.control?.role;
        editor.hoverSelectionPath(hit.path, role === "in" || role === "out" || role === "arc" ? role : undefined);
    }
    function hoverModifier(ev: KeyboardEvent) {
        if (ev.key !== "Alt" || hoverAlternate === ev.altKey) return;
        hoverAlternate = ev.altKey;
        if (hoverPoint) hoverFrame ||= requestAnimationFrame(updateHover);
    }
    canvas.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        if (!editor.project || !editor.mapCurrent || editor.busy || editor.geoDraft) return;
        editor.menu = null;
        const view = editor.mapView!, screen = localPoint(ev);
        const hit = map.objectHits(view, screen).next().value;
        if (hit && (hit.path[0].kind === "mark" || selectionLayers(hit.path).part || !map.issueHits(view, screen).length))
            editor.openMapMenu(hit.path, ev, hit.control);
    }, { signal });
    function beginPointer(ev: PointerEvent) {
        const screen = localPoint(ev), p = map.world(...screen);
        if (ev.button === 1) {
            beginPan(ev, screen, "middle");
            return;
        }
        if (editor.busy) return;
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
            beginPan(ev, screen, "stationary", () => {
                if (editor.tool === tool) void editor.addMark(kind, screen);
            });
            return;
        }
    }
    function selectClick(screen: Point, alternate: boolean) {
        if (!editor.mapCurrent) return;
        const hit = pick(screen, alternate);
        if (hit && "issues" in hit) editor.pickMarkers(hit.issues);
        else editor.selectPath(hit?.path ?? null);
        if (hoverPoint) hoverFrame ||= requestAnimationFrame(updateHover);
    }
    function beginSelectionDrag(down: PointerEvent, screen: Point) {
        if (!editor.mapCurrent) return;
        const view = editor.mapView!, p = map.world(...screen), pointer = down.pointerId;
        const hit = dragMapHit(map.objectHits(view, screen), view.selectionPath);
        const label = !selectionLayers(hit?.path).part && !map.markHits(...screen).next().value && map.hitLabel(...screen);
        if (label) {
            const { kind, id, point } = label;
            editor.gesture = { label: { kind, id }, offset: [point[0] - p[0], point[1] - p[1]], screen, pointer };
            return;
        }
        if (!hit) return;
        editor.selectPath(hit.path);
        const { root, leaf } = selectionLayers(hit.path);
        if (!root || !leaf) return;
        const { design, resolved } = editor.project, { handle: h } = hit;
        if (leaf.kind === "section") {
            const section = resolved.sections.find(s => s.id === root.id)!;
            editor.gesture = { section, screen, pointer };
        }
        else if (h) {
            const mark = root.kind === "mark" ? design.marks.find(m => m.id === root.id) : undefined;
            const at = mark ? map.markCoordinate(screen, mark.follow) : p, movePoint = leaf.kind === "geometry";
            const pointPreview = movePoint ? controlPreview(design, resolved, editor.curves, root,
                { role: "parameter", path: h.index ?? 0, index: h.index ?? 0, point: h.point }, false) : undefined;
            editor.gesture = { handle: h, offset: [h.point[0] - at[0], h.point[1] - at[1]], movePoint, pointPreview,
                snap: sectionSnap(editor, h), screen, pointer };
        }
        else {
            const action = mapControlDrag(hit, view, p);
            if (!action) return;
            const { selection, control } = action, independent = down.altKey;
            const preview = controlPreview(design, resolved, editor.curves, selection, control, independent);
            if (preview) editor.gesture = { preview, selection, control, independent, origin: p,
                snap: controlSnap(editor, selection, control), screen, pointer };
        }
    }

    type DrawingClick = { draft: GeoDraft; nodeCount: number };
    type Press = { down: PointerEvent; drawing?: DrawingClick; selectFrom?: Point; dragged?: boolean; spacePan?: boolean;
        state: "active" | "pending" | "double"; up?: PointerEvent };
    let firstClick: DrawingClick | undefined, spaceClick = false;
    let press: Press | undefined;
    canvas.addEventListener("pointerdown", ev => {
        if (!editor.project || editor.gesture || (ev.button !== 0 && ev.button !== 1)) return;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(ev.pointerId);
        if (spaceHeld && ev.button === 0) {
            firstClick = undefined;
            press = { down: ev, state: "active", spacePan: true };
            beginPan(ev, localPoint(ev), "space");
            return;
        }
        const draft = editor.geoDraft;
        const drawing = !editor.busy && ev.button === 0 && draft && doubleClickTools.includes(draft.tool) ? { draft, nodeCount: draft.nodes.length } : undefined;
        // The first click may already have closed the path and switched tools.
        press = { down: ev, drawing, state: ev.button === 0 && firstClick ? "pending" : "active",
            selectFrom: ev.button === 0 && editor.tool === "select" ? localPoint(ev) : undefined };
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
        if (current?.spacePan) {
            spaceClick = true;
            return;
        }
        if (ev.detail === 1) spaceClick = false;
        if (ev.detail === 2 && firstClick) return;
        firstClick = ev.detail === 1 ? current?.drawing : undefined;
        if (current?.up && editor.project) {
            if (current.state !== "active") beginPointer(current.down);
            releasePointer(current.up, current);
        }
    }, { signal });
    canvas.addEventListener("dblclick", ev => {
        const first = firstClick;
        firstClick = undefined;
        // Chrome can count a Space-pan click as one of the clicks in a double-click.
        if (spaceHeld || spaceClick || !editor.project || !editor.mapCurrent || editor.busy || ev.button !== 0) return;
        const draft = first?.draft ?? editor.geoDraft;
        if (draft && doubleClickTools.includes(draft.tool)) {
            ev.preventDefault();
            if (editor.geoDraft === draft) {
                draft.down = draft.downRaw = draft.handle = undefined;
                if (first) draft.nodes.splice(first.nodeCount);
                updatePreview(editor, draft);
                void editor.completeDrawing();
            }
            return;
        }
        if (ev.altKey || editor.tool !== "select") return;
        ev.preventDefault();
        const view = editor.mapView!;
        const hit = firstEditableHit(map.objectHits(view, localPoint(ev)), view.selectionPath);
        const control = hit?.control;
        if (hit && control) {
            editor.selectPath(hit.path);
            if (control.role === "segment") editor.insertNode(hit.path[0].id, control);
            if (control.role === "vertex") editor.pathNodeMode(control);
            if (control.role === "in" || control.role === "out") editor.retractHandle(control, control.role);
        }
    }, { signal });
    canvas.addEventListener("pointermove", ev => {
        if (!editor.project) return;
        const screen = localPoint(ev), p = map.world(...screen);
        lastPointer = { screen, pointerId: ev.pointerId };
        pointerInside = screen[0] >= 0 && screen[0] < map.width && screen[1] >= 0 && screen[1] < map.height;
        editor.readPosition(pointerInside ? p : undefined);
        if (editor.tool === "select" && pointerInside) {
            hoverPoint = screen; hoverAlternate = ev.altKey;
        }
        if (spaceHeld && !editor.gesture) return;
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
        if (press?.selectFrom && press.down.pointerId === ev.pointerId && !press.up && !press.dragged) {
            if (distance(screen, press.selectFrom) <= dragThreshold) return;
            press.dragged = true;
            if (editor.tool === "select" && !editor.busy) {
                editor.hoverSelection();
                beginSelectionDrag(press.down, press.selectFrom);
            }
        }
        if (!editor.gesture) {
            if (editor.tool === "select" && pointerInside) hoverFrame ||= requestAnimationFrame(updateHover);
            return;
        }
        moveGesture(ev, screen, p);
    }, { signal });
    function moveGesture(ev: SnapModifiers & { pointerId: number }, screen: Point, p: Point) {
        if (!editor.gesture) return;
        if (editor.gesture.pointer !== ev.pointerId) return;
        if ("pan" in editor.gesture) {
            if (!editor.gesture.changed && distance(screen, editor.gesture.screen) < 3) return;
            editor.gesture.changed = true;
            if (editor.gesture.pan === "stationary") return;
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
        if ("preview" in editor.gesture) {
            const { control, origin, preview, snap } = editor.gesture;
            const target: Point = [control.point[0] + (p[0] - origin[0]), control.point[1] + (p[1] - origin[1])];
            const result = snap?.(target, ev);
            const at = result?.point ?? target;
            editor.snapGuides = result?.guides;
            editor.dragPreview = preview(at);
            editor.gesture.target = at;
            return;
        }
        if ("section" in editor.gesture) {
            const { section, screen: origin } = editor.gesture, start = map.world(...origin);
            const dx = p[0] - start[0], dy = p[1] - start[1];
            const [a, b] = section.points;
            editor.dragSection = { id: section.id, points: [[a[0] + dx, a[1] + dy], [b[0] + dx, b[1] + dy]] };
            return;
        }
        const d = editor.project.design, h = editor.gesture.handle, mark = h.kind === "mark" ? d.marks.find(m => m.id === h.id)! : undefined;
        const at = mark ? map.markCoordinate(screen, mark.follow) : p;
        const target: Point = [at[0] + editor.gesture.offset[0], at[1] + editor.gesture.offset[1]];
        if (mark) {
            editor.dragMark = { id: h.id, point: target };
            editor.dragPreview = editor.gesture.pointPreview?.(target);
            return;
        }
        const section = editor.project.resolved.sections.find(s => s.id === h.id)!, index = h.index!;
        const result = editor.gesture.snap?.(target, ev);
        const [a, b] = d.sections.find(s => s.id === h.id)!.points;
        const point = sectionHandlePoint(section, index, result?.point ?? target, ev.shiftKey && !ev.ctrlKey || !!result?.snapped,
            editor.gesture.movePoint && a.point === b.point);
        editor.snapGuides = point ? result?.guides : undefined;
        if (point) {
            const points = [...section.points] as typeof section.points;
            points[index] = point;
            editor.dragSection = { id: h.id, points };
            editor.dragPreview = editor.gesture.pointPreview?.(point);
        }
    }

    canvas.addEventListener("pointerleave", () => {
        pointerInside = false;
        if (!editor.gesture && !editor.geoDraft?.down) editor.snapGuides = undefined;
        cancelAnimationFrame(hoverFrame); hoverFrame = 0;
        hoverPoint = undefined;
        editor.readPosition();
        const pick = editor.geoDraft?.curve?.pick;
        if (pick) pick.hovered = undefined;
        editor.hoverSelection();
    }, { signal });

    async function finishGesture(ev: PointerEvent) {
        if (!editor.busy && editor.geoDraft?.down && !editor.gesture) {
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
        editor.snapGuides = undefined;
        if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
        canvas.style.cursor = spaceHeld ? "grab" : "";
        if ("pan" in g) {
            if (pointerInside && hoverPoint) hoverFrame ||= requestAnimationFrame(updateHover);
            if (!g.changed && ev.type === "pointerup") g.click?.();
            return;
        }
        try {
            if (ev.type !== "pointerup") return;
            if ("label" in g) {
                const drag = editor.dragLabel;
                if (drag) await editor.moveLabel(g.label, drag.offset);
            }
            else if ("preview" in g) {
                if (g.target) {
                    editor.dragCommitting = true;
                    await editor.edit(d => {
                        commitControl(d, g.selection, g.control, g.target!, g.independent);
                    });
                }
            }
            else {
                const drag = editor.dragSection;
                if (drag) await editor.edit(d => {
                    if ("section" in g) {
                        const [a] = g.section.points, [b] = drag.points;
                        moveSection(d, drag.id, [b[0] - a[0], b[1] - a[1]]);
                    }
                    else if ("handle" in g) moveHandle(d, g.handle, drag.points[g.handle.index!], g.movePoint);
                });
                if ("handle" in g && editor.dragMark) {
                    const mark = editor.project.resolved.marks.find(m => m.id === g.handle.id), point = editor.dragMark.point;
                    await editor.edit(d => moveHandle(d, g.handle, mark?.follow === "screen" ? map.visibleMarkPoint({ ...mark, point }) : point, g.movePoint));
                }
            }
        }
        finally {
            clearDrag();
        }
    }
    function clearDrag() {
        editor.dragMark = editor.dragLabel = editor.dragSection = undefined;
        editor.dragPreview = undefined;
        editor.dragCommitting = false;
        if (pointerInside && hoverPoint) hoverFrame ||= requestAnimationFrame(updateHover);
    }
    function releasePointer(ev: PointerEvent, current = press) {
        if (current?.selectFrom && current.down.pointerId === ev.pointerId && editor.tool === "select") {
            const screen = localPoint(ev);
            if (!current.dragged && distance(screen, current.selectFrom) <= dragThreshold)
                selectClick(current.selectFrom, ev.altKey);
            else if (!editor.busy) {
                if (!current.dragged) beginSelectionDrag(current.down, current.selectFrom);
                moveGesture(ev, screen, map.world(...screen));
            }
        }
        void finishGesture(ev);
    }
    canvas.addEventListener("pointerup", ev => {
        if (!editor.gesture || editor.gesture.pointer === ev.pointerId) editor.snapGuides = undefined;
        if (firstClick && press?.down.pointerId === ev.pointerId) {
            const moved = distance(localPoint(ev), localPoint(press.down)) > 3;
            if (press.state === "double" || (!moved && (press.state === "pending" || press.drawing?.draft === firstClick.draft))) {
                press.up = ev;
                return;
            }
            if (press.state === "pending") beginPointer(press.down);
        }
        releasePointer(ev);
    }, { signal });
    canvas.addEventListener("pointercancel", ev => {
        const spacePan = press?.spacePan;
        press = undefined; firstClick = undefined;
        if (!spacePan && editor.tool !== "select") editor.cancelDrawing();
        void finishGesture(ev);
    }, { signal });
    canvas.addEventListener("auxclick", ev => ev.preventDefault(), { signal });
    document.addEventListener("keydown", hoverModifier, { signal });
    document.addEventListener("keyup", hoverModifier, { signal });
    function refreshSnap(ev: KeyboardEvent) {
        if ((ev.key !== "Shift" && ev.key !== "Control") || !lastPointer || editor.busy || spaceHeld) return;
        const { screen, pointerId } = lastPointer, at = map.world(...screen), gesture = editor.gesture;
        if (gesture && "snap" in gesture && gesture.snap && gesture.changed)
            moveGesture({ pointerId, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey }, screen, at);
        else if (pointerInside && editor.geoDraft && !gesture && (!press || press.state === "active")) {
            try {
                draftPointer(editor, "move", at, ev);
            }
            catch (error) {
                editor.message(errorText(error));
            }
        }
    }
    document.addEventListener("keydown", refreshSnap, { signal });
    document.addEventListener("keyup", refreshSnap, { signal });
    document.addEventListener("keyup", ev => {
        if (ev.key === " ") stopSpacePan();
    }, { signal });
    window.addEventListener("blur", stopSpacePan, { signal });
    document.addEventListener("keydown", ev => {
        if (composingKey(ev) || ev.defaultPrevented && !(ev.key === "Escape" && editor.tool !== "select")) return;
        const save = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s";
        if (save) ev.preventDefault();
        if (!editor.project || editor.fileRequest || editor.removal) return;
        if (ev.key === " " && !isEditableText(ev.target)) {
            if (!spaceHeld) {
                if (!pointerInside || editor.gesture || press && canvas.hasPointerCapture(press.down.pointerId) ||
                    ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey) return;
                spaceHeld = true;
                canvas.style.cursor = "grab";
                editor.hoverSelection();
            }
            ev.preventDefault();
            return;
        }
        if (editor.busy) return;
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
            if (editor.penNodeMode && ev.key.toLowerCase() === "s" && !ev.altKey && !ev.repeat) {
                ev.preventDefault();
                editor.choosePenNode(editor.penNodeMode === "corner" ? "auto" : "corner");
                return;
            }
            if (ev.key === "Escape") {
                ev.preventDefault();
                firstClick = press = undefined;
                editor.cancelDrawing();
                return;
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
            if (editor.gesture) {
                const { pointer } = editor.gesture;
                editor.gesture = null;
                editor.snapGuides = undefined;
                if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
                canvas.style.cursor = spaceHeld ? "grab" : "";
                press = undefined;
                clearDrag();
            }
            else if (editor.tool !== "select") editor.cancelDrawing();
            else {
                const pointer = press?.down.pointerId;
                press = undefined;
                if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
                editor.stepSelectionOut();
            }
            return;
        }
        if (input) return;
        if (ev.key === "Delete") {
            ev.preventDefault();
            if (!editor.gesture) editor.removeSelected();
        }
    }, { signal });

    window.addEventListener("beforeunload", () => {
        commitFocusedInput();
        editor.rememberPendingEdit();
    }, { signal });
    return () => {
        cancelAnimationFrame(hoverFrame);
        listeners.abort();
    };
}
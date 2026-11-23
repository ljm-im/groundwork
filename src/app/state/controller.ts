import { displayNumber } from "./numbers.ts";
import { nodePose } from "../../core/design/model.ts";
import { distance, onCanvas, sampleDefined } from "../../core/math/geometry.ts";
import { moveHandle } from "../../core/edit/controls.ts";
import { editControl, geometryPath, hitControl, insertPathNode, type GeoControl } from "../../core/edit/geoControls.ts";
import { nodeIds } from "../../core/edit/geoNodes.ts";
import { draftPointer, geoAt, snapPoint, updatePreview } from "./geoTools.ts";
import { addNode, connect, insertVia, splitRoad } from "../../core/edit/topology.ts";
import { canPlaceBuilding, doorRoads, nearbyWall, placeBuilding } from "../../core/edit/buildings.ts";
import { errorText, type Design, type Point, type RoadNode, type Selection } from "../types.ts";
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
        if (!editor.island || pinchScale) return;
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
        if (editor.island && pinchScale && ev.scale > 0) map.zoomAt(ev.scale / pinchScale, ...localPoint(ev));
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

    function canPlace(p: Point) {
        const t = editor.island.terrain;
        if (onCanvas(t.grid, t.defined, ...p)) return true;
        editor.message("请在画布内放置节点");
        return false;
    }

    function nodeAt(d: Design, h: Selection | null, p: Point) {
        const wall = nearbyWall(d, p);
        if (wall)
            return editor.openWallDoor(d, wall);
        return h?.kind === "node" ? d.nodes.find(n => n.id === h.id) : null;
    }

    function completeLink(d: Design, h: Selection | null, p: Point, allowNew: boolean) {
        const from = d.nodes.find(n => n.id === editor.linkFrom);
        let to = nodeAt(d, h, p);
        let dirty: string[] = [];
        if (!to && editor.forkFromDoor) {
            const hit = map.hitRoad(p);
            if (hit) {
                to = splitRoad(d, hit.route, hit.point, hit.index);
                dirty = to?.through ?? [];
            }
            if (!to) {
                editor.message("请单击道路中部建立分岔");
                return;
            }
        }
        if (!to) {
            if (!allowNew) {
                editor.message("请单击路网节点或建筑外墙");
                return;
            }
            if (!canPlace(p))
                return;
            to = addNode(d, p);
        }
        if (to === from) {
            editor.message("请选择另一个节点");
            return;
        }
        const edge = connect(d, from!, to);
        editor.setTool("select");
        editor.select({ kind: "edge", id: edge.id });
        editor.reroute(new Set([edge.id, ...dirty]));
    }

    function beginWallLink(d: Design, wall: NonNullable<ReturnType<typeof nearbyWall>>, fork: boolean) {
        const node = editor.openWallDoor(d, wall);
        editor.linkFrom = node.id;
        editor.forkFromDoor = fork;
        editor.select({ kind: "node", id: node.id });
        editor.reroute(new Set());
        editor.hint = fork ? "单击道路中部建立分岔，Esc 完成开门" : "单击终点节点或建筑外墙，Esc 完成开门";
    }

    function insertWaypoint(screen: Point) {
        const hit = map.hitRoad(map.world(...screen));
        if (!hit) {
            editor.message("请单击要添加途经点的道路", screen);
            return;
        }
        const e = editor.island.design.edges.find(e => e.id === hit.route.id)!;
        const existing = e.via.findIndex((p: Point) => distance(p, hit.point) * map.scale < 3);
        if (existing >= 0) {
            editor.select({ kind: "via", id: e.id, index: existing });
            return;
        }
        if ([hit.route.points[0], hit.route.points.at(-1)!].some(p => distance(p, hit.point) < 1e-6)) {
            editor.message("请单击两个端点之间的路面", screen);
            return;
        }
        insertVia(e, hit.index, hit.point);
        editor.setSelection({ kind: "via", id: e.id, index: hit.index });
        editor.tab = "network";
        editor.reroute(new Set([e.id]));
    }

    function pick(screen: Point, alt = false) {
        const p = map.world(...screen), h = map.hitHandle(...screen), building = map.hitBuilding(...screen), road = map.hitRoad(p);
        const selected = editor.selection?.kind === "geoNode" && map.island.design.geoNodes.find(n => n.id === editor.selection!.id);
        const control = selected && hitControl(selected, p, map.scale, map.island.design.grid.step / 8, map.geometry);
        const nodes = map.geoHits(p);
        let index = 0;
        if (alt && selected && nodes.length) index = (nodes.findIndex(n => n.id === selected.id) + 1) % nodes.length;
        const geo = selected && control ? { kind: "geo" as const, id: selected.id, control } : nodes[index] ?
            { kind: "geo" as const, id: nodes[index].id, control: { role: "body", path: 0, index: 0, point: p } as GeoControl } : null;
        const mark = !alt && map.hitMark(...screen);
        if (mark && !control) return { kind: "handle" as const, h: mark };
        const handle = h && { kind: "handle" as const, h };
        const body = building && { kind: "handle" as const, h: building };
        const edge = road && { kind: "road" as const, road };
        const hits = map.issueHits(screen), markers = hits.length ? { kind: "issues" as const, hits } : null;
        if (map.objectGeometry && handle) return handle;
        if (editor.tab === "terrain" && geo) return geo;
        if (editor.tab === "buildings" && (h?.kind === "building" || h?.kind === "door" || body)) return h?.kind === "building" || h?.kind === "door" ? handle : body;
        if (editor.tab === "network" && (h?.kind === "node" || h?.kind === "via" || edge)) return h?.kind === "node" || h?.kind === "via" ? handle : edge;
        if (editor.tab === "issues" && markers) return markers;
        return handle ?? body ?? markers ?? edge ?? geo;
    }
    function updateHover() {
        hoverFrame = 0;
        if (editor.tool !== "select" || editor.gesture || editor.busy) return;
        const hit = pick(hoverPoint, hoverAlternate);
        if (hit?.kind === "geo") map.hoverSelection({ kind: "geoNode", id: hit.id });
        else if (hit?.kind === "road") map.hoverSelection({ kind: "edge", id: hit.road.route.id });
        else if (hit?.kind === "handle") {
            const { h } = hit;
            map.hoverSelection(h.kind === "via" ? { kind: "edge", id: h.id } : h.kind === "door" ? { kind: "building", id: h.id } : h);
        }
        else map.hoverSelection();
    }
    function insertGeo(id: string, control: GeoControl) {
        editor.edit(d => {
            insertPathNode(geometryPath(geoAt(d, id), control.path)!, control.index, control.point, nodeIds(d)());
        });
    }
    canvas.addEventListener("contextmenu", ev => {
        ev.preventDefault();
        if (!editor.island || editor.busy || map.draft) return;
        const hit = pick(localPoint(ev));
        editor.menu = null;
        if (!hit || hit.kind === "issues") return;
        const h: Selection = hit.kind === "geo" ? { kind: "geoNode", id: hit.id } : hit.kind === "road" ? { kind: "edge", id: hit.road.route.id } : hit.h;
        if (h.kind === "section") return;
        editor.setTool("select");
        editor.select(h.kind === "door" ? { ...h, kind: "building", role: "door:" + h.role } : h);
        editor.menu = { x: ev.clientX, y: ev.clientY, map: true, segment: hit.kind === "geo" && hit.control.role === "segment" ? hit.control : undefined };
    }, { signal });
    canvas.addEventListener("pointerdown", ev => {
        if (!editor.island || editor.busy || editor.gesture) return;
        if (ev.button !== 0 && ev.button !== 1) return;
        canvas.focus({ preventScroll: true });
        const screen = localPoint(ev),
            p = map.world(...screen),
            d = editor.island.design;
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
        if (editor.tool === "via") {
            beginPan(ev, screen, () => insertWaypoint(screen)); return;
        }
        const h = map.hitHandle(...screen);
        if (editor.tool === "textMark" || editor.tool === "scaleMark") {
            const kind = editor.tool === "scaleMark" ? "scale" : "text";
            beginPan(ev, screen, () => editor.addMark(kind, p));
            return;
        }
        if (editor.tool === "building") {
            beginPan(ev, screen, () => {
                if (!canPlaceBuilding(editor.island, p)) {
                    editor.message("请在空地上放置建筑", screen);
                    return;
                }
                const b = placeBuilding(d, p.map(v => +v.toFixed(2)) as Point);
                editor.setTool("select");
                editor.select({ kind: "building", id: b.id });
                editor.rebuild();
            });
            return;
        }
        if (editor.tool === "node" || editor.tool === "door") {
            beginPan(ev, screen, () => {
                const wall = nearbyWall(d, p);
                if (!wall && editor.tool === "door") {
                    editor.message("请单击建筑外墙（2 m 以内）", screen);
                    return;
                }
                if (!wall && !canPlace(p)) return;
                const n = wall ? editor.openWallDoor(d, wall) : addNode(d, p.map(v => +v.toFixed(2)) as Point);
                editor.setTool("select");
                editor.select({ kind: "node", id: n.id });
                editor.reroute(new Set());
            });
            return;
        }
        if (editor.tool === "edge") {
            if (!editor.linkFrom) {
                const wall = editor.tool === "edge" && nearbyWall(d, p);
                if (wall) {
                    beginPan(ev, screen, () => beginWallLink(d, wall, false));
                    return;
                }
                if (h?.kind !== "node") {
                    beginPan(ev, screen, () => editor.message("请先单击路网节点或建筑外墙"));
                    return;
                }
                editor.linkFrom = h.id;
                editor.select(h);
                editor.hint = "单击终点节点或建筑外墙，Esc 取消";
            }
            else beginPan(ev, screen, () => completeLink(d, h, p, false));
            return;
        }
        if (editor.tool === "fork") {
            if (!editor.linkFrom) {
                const wall = nearbyWall(d, p);
                if (wall) {
                    beginPan(ev, screen, () => beginWallLink(d, wall, true));
                    return;
                }
                const hit = map.hitRoad(p);
                if (!hit) {
                    beginPan(ev, screen, () => editor.message("请在可选线的道路上分岔"));
                    return;
                }
                const junction = splitRoad(d, hit.route, hit.point, hit.index) as RoadNode | null;
                if (!junction) {
                    editor.message("请在两个端点之间分岔");
                    return;
                }
                editor.linkFrom = junction.id;
                editor.setSelection({ kind: "node", id: junction.id });
                editor.tab = "network";
                editor.reroute(new Set(junction.through));
                editor.hint = "拖出或单击支路终点，单击空白新建终点，Esc 完成拆分";
            }
            else if (h?.id !== editor.linkFrom) {
                if (h?.kind === "node") completeLink(d, h, p, true);
                else beginPan(ev, screen, () => completeLink(d, h, p, true));
                return;
            }
            editor.gesture = { branch: true, screen, pointer: ev.pointerId };
            canvas.setPointerCapture(ev.pointerId);
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
            if (c.role === "vertex" || c.role === "parameter") {
                map.vertex = c; if (c.role === "vertex" && c.path >= 0) editor.pathIndex = c.path;
                map.draw();
            }
            if (c.role === "segment" || c.role === "body" && n.construction.type !== "free") return;
            editor.gesture = { geo: n, control: c, screen, pointer: ev.pointerId };
            canvas.setPointerCapture(ev.pointerId);
            return;
        }
        if (hit?.kind === "handle") {
            const h = hit.h;
            const building = editor.selection?.kind === "building" && editor.selection.id;
            const linkedDoor = h.kind === "node" && d.nodes.find(n => n.id === h.id && n.type === "door" && n.building === building);
            if (!linkedDoor) editor.select(h.kind === "door" ? { kind: "building", id: h.id } : h);
            const offset = h.kind === "mark" || h.kind === "building" && ["center", "body", "title"].includes(h.role) ? [h.point[0] - p[0], h.point[1] - p[1]] : [0, 0];
            editor.gesture = { handle: h, offset, screen, pointer: ev.pointerId, changed: false, hits: [] };
            canvas.setPointerCapture(ev.pointerId);
            return;
        }
        if (hit?.kind === "issues") {
            beginPan(ev, screen, () => editor.pickMarkers(hit.hits)); return;
        }
        if (hit?.kind === "road") {
            if (ev.altKey) insertWaypoint(screen);
            else editor.select({ kind: "edge", id: hit.road.route.id, index: hit.road.index });
        }
        else beginPan(ev, screen, () => editor.select(null));
    }, { signal });
    canvas.addEventListener("dblclick", ev => {
        if (!editor.island || editor.busy || ev.button !== 0 || ev.altKey || editor.tool !== "select") return;
        ev.preventDefault();
        const screen = localPoint(ev), hit = pick(screen);
        if (hit?.kind === "geo") {
            const c = hit.control;
            if (c.role === "segment") insertGeo(hit.id, c);
            if (c.role === "vertex") editor.editNode(hit.id, n => {
                const v = geometryPath(n, c.path)!.nodes[c.index];
                v.mode = v.mode === "auto" ? "corner" : "auto"; delete v.in; delete v.out;
            });
        }
        else if (hit?.kind === "road" || hit?.kind === "handle" && hit.h.kind === "via") insertWaypoint(screen);
    }, { signal });
    canvas.addEventListener("pointermove", ev => {
        if (!editor.island) return;
        const screen = localPoint(ev),
            p = map.world(...screen),
            d = editor.island.design;
        const height = sampleDefined(map.island.terrain.grid, map.island.graded.heights, map.island.terrain.defined, ...p);
        editor.position = "X " + displayNumber(p[0], .1) + "   Y " + displayNumber(p[1], .1) + "   H " + displayNumber(height ?? NaN, .1, "m");
        if (map.draft && !editor.gesture) {
            try {
                draftPointer(editor, "move", p, ev);
            }
            catch (error) {
                editor.message(errorText(error));
            }
            return;
        }
        if (editor.linkFrom && ["edge", "fork"].includes(editor.tool) && !(editor.gesture && "pan" in editor.gesture)) {
            map.linkPreview = [nodePose(editor.island.resolved, editor.linkFrom).point, p];
            map.draw();
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
        if ("branch" in editor.gesture) {
            if (distance(screen, editor.gesture.screen) >= 3) editor.gesture.changed = true;
            return;
        }
        if (!editor.gesture.changed && distance(screen, editor.gesture.screen) < 2) return;
        editor.gesture.changed = true;
        if ("geo" in editor.gesture) {
            const { geo, control } = editor.gesture, copy = structuredClone(geo);
            const at = control.role === "vertex" && !ev.ctrlKey ? snapPoint(map.island.terrain, map.island.design, p, map.scale, geo.id) : p;
            editControl(copy, control, at, ev.altKey);
            map.dragNode = copy; map.draw(); return;
        }
        const h = editor.gesture.handle;
        const target: Point = [p[0] + editor.gesture.offset[0], p[1] + editor.gesture.offset[1]];
        if (h.kind === "mark") {
            map.dragMark = { id: h.id, point: target }; map.draw(); return;
        }
        const { grid, defined } = editor.island.terrain;
        if (!onCanvas(grid, defined, ...target)) return;
        moveHandle(d, h, target);
        if (h.kind === "via") editor.pendingEdges.add(h.id);
        if (h.kind === "node" || h.kind === "door") {
            const node = h.kind === "node" ? d.nodes.find(n => n.id === h.id) : d.nodes.find(n => n.building === h.id && n.door === h.role);
            if (node?.type === "door") {
                const b = d.buildings.find(b => b.id === node.building);
                for (const e of doorRoads(d, b!, b!.doors.find(door => door.id === node.door))) editor.pendingEdges.add(e.id);
            }
            else if (node) {
                for (const e of d.edges) if (e.from === node.id || e.to === node.id) editor.pendingEdges.add(e.id);
            }
        }
        editor.schedule();
    }, { signal });

    canvas.addEventListener("pointerleave", () => {
        cancelAnimationFrame(hoverFrame); hoverFrame = 0;
        map.hoverSelection();
    }, { signal });

    function offerDoorConversion(h: Selection, p: Point) {
        const d = editor.island.design, node = d.nodes.find(n => n.id === h.id);
        if (!node || node.type === "door")
            return false;
        const edges = d.edges.filter(e => e.from === node.id || e.to === node.id);
        const wall = edges.length && nearbyWall(d, p);
        if (!wall)
            return false;
        editor.offerConversion(node, wall, edges);
        return true;
    }

    function finishGesture(ev: PointerEvent) {
        if (map.draft?.down && !editor.gesture) {
            if (ev.type === "pointercancel") editor.setTool("select");
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
        if ("branch" in g) {
            if (editor.linkFrom && g.changed && ev.type === "pointerup") {
                const screen = localPoint(ev);
                completeLink(editor.island.design, map.hitHandle(...screen), map.world(...screen), true);
            }
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
        if (!g.changed) {
            if (g.hits?.length && ev.type === "pointerup") editor.pickMarkers(g.hits);
            return;
        }
        editor.flushPending();
        if (g.handle.kind === "node" && ev.type === "pointerup" && offerDoorConversion(g.handle, map.world(...localPoint(ev)))) return;
        if (g.handle.kind === "building" && g.handle.role === "title") {
            editor.revision++;
            editor.record();
            return;
        }
        if (g.handle.kind === "building") {
            editor.rebuild();
            return;
        }
        editor.revision++;
        editor.record();
    }
    canvas.addEventListener("pointerup", finishGesture, { signal });
    canvas.addEventListener("pointercancel", finishGesture, { signal });
    canvas.addEventListener("auxclick", ev => ev.preventDefault(), { signal });
    document.addEventListener("keydown", ev => {
        const save = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s";
        if (save) ev.preventDefault();
        if (!editor.island || editor.busy || editor.draft || editor.fileRequest || editor.removal || editor.conversion) return;
        const input = ev.target instanceof Element && ev.target.matches("input,select,textarea,[contenteditable=true]");
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
                ev.preventDefault(); editor.setTool("select"); return;
            }
            if (ev.key === "Enter") {
                ev.preventDefault(); if (!["rect", "circle", "sector"].includes(draft.tool)) editor.completeDrawing(); return;
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
            editor.setTool("select");
            editor.select(null);
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
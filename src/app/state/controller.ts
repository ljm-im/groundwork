import { areaBoundary, clearingShape, nodePose } from "../../core/design/model.ts";
import { distance, nearest, sample } from "../../core/math/geometry.ts";
import { moveHandle } from "../../core/edit/controls.js";
import { drawingTarget, featureHit, featureOf, insertVertex } from "../../core/edit/landforms.js";
import { addGate, addNode, connect, insertVia, splitRoad } from "../../core/edit/topology.js";
import { canPlaceBuilding, doorRoads, nearbyWall, openDoorAt, placeBuilding } from "../../core/edit/buildings.js";
import { insidePolygon } from "../../core/math/polygon.ts";
import { errorText, type Design, type Point, type RoadNode, type Selection, type Yard } from "../types";
import * as session from "./session.svelte";

declare global {
    interface HTMLElementEventMap {
        gesturestart: MouseEvent & { scale: number };
        gesturechange: MouseEvent & { scale: number };
        gestureend: MouseEvent & { scale: number };
    }
}

export function attachController(editor: session.Editor, canvas: HTMLCanvasElement) {
    const map = editor.map, listeners = new AbortController(), signal = listeners.signal;
    let space = false;

    function insertFeaturePoint(p: Point) {
        const d = editor.island.design, h = editor.selection, item = featureOf(d, h);
        if (!h || !item || !(h!.kind === "ridge" || h.kind === "planting" || h.kind === "clearing" && clearingShape(d, item).type === "polygon"))
            return false;
        const hit = featureHit(d, h.kind, item, p);
        if (hit.distance * map.scale > 10)
            return false;
        try {
            const index = insertVertex(d, h, hit);
            if (index != null) {
                editor.select({ kind: h.kind, id: h.id, role: "vertex", index });
                editor.finishFeature(h.kind);
            }
        }
        catch (e) {
            editor.message(errorText(e));
        }
        return true;
    }

    function localPoint(ev: MouseEvent): Point {
        const box = canvas.getBoundingClientRect();
        return [ev.clientX - box.left, ev.clientY - box.top];
    }
    let lastWheel = -Infinity, wheelMode = "pan", pinchScale = 0;
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
        if (pinchScale && ev.scale > 0) map.zoomAt(ev.scale / pinchScale, ...localPoint(ev));
        pinchScale = ev.scale;
    }, { signal });
    canvas.addEventListener("gestureend", ev => {
        ev.preventDefault();
        pinchScale = 0;
    }, { signal });

    function beginPan(ev: PointerEvent, screen: Point, click?: () => void) {
        ev.preventDefault();
        editor.gesture = { pan: true, screen, center: map.center.slice(), pointer: ev.pointerId, click };
        canvas.setPointerCapture(ev.pointerId);
    }

    function canPlace(d: Design, p: Point) {
        const g = d.grid;
        if (p[0] < g.xMin || p[0] > g.xMax || p[1] < g.yMin || p[1] > g.yMax) {
            editor.message("请在网格范围内放置节点");
            return false;
        }
        if ((d.yards ?? []).some(y => insidePolygon(areaBoundary(d, y), p))) {
            editor.message("请使用区域边界上的入口连接外部道路");
            return false;
        }
        return true;
    }

    function nodeAt(d: Design, h: Selection | null, p: Point) {
        const wall = nearbyWall(d, p);
        if (wall)
            return openDoorAt(d, wall, undefined);
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
            if (!canPlace(d, p))
                return;
            to = addNode(d, p);
        }
        if (to === from) {
            editor.message("请选择另一个节点");
            return;
        }
        const edge = connect(d, from, to);
        editor.setTool("select");
        editor.select({ kind: "edge", id: edge.id });
        editor.reroute(new Set([edge.id, ...dirty]));
    }

    function beginWallLink(d: Design, wall: NonNullable<ReturnType<typeof nearbyWall>>, fork: boolean) {
        const node = openDoorAt(d, wall, undefined);
        editor.linkFrom = node.id;
        editor.forkFromDoor = fork;
        editor.select({ kind: "node", id: node.id });
        editor.reroute(new Set());
        editor.hint = fork ? "单击道路中部建立分岔，Esc 完成开门" : "单击终点节点或建筑外墙，Esc 完成开门";
    }

    function finishGate(d: Design, yard: Yard, other: RoadNode, gateFirst: boolean) {
        if (other.yard === yard.id || insidePolygon(yard, nodePose(d, other).point)) {
            editor.message("请选择区域外的节点");
            return;
        }
        const { gate, edge } = addGate(d, yard, other, gateFirst);
        editor.setTool("select");
        editor.selection = { kind: "node", id: gate.id };
        editor.tab = "network";
        editor.reroute(new Set([edge.id]));
    }

    function insertWaypoint(screen: Point) {
        const hit = map.hitRoad(map.world(...screen));
        if (!hit) {
            editor.message("请单击要添加途经点的道路", screen);
            return;
        }
        const e = hit.route.edge;
        const existing = e.via.findIndex((p: Point) => distance(p, hit.point) * map.scale < 3);
        if (existing >= 0) {
            editor.select({ kind: "via", id: e.id, index: existing });
            return;
        }
        if ([hit.route.points[0], hit.route.points.at(-1)].some(p => distance(p, hit.point) < 1e-6)) {
            editor.message("请单击两个端点之间的路面", screen);
            return;
        }
        insertVia(e, hit.index, hit.point);
        editor.selection = { kind: "via", id: e.id, index: hit.index };
        editor.tab = "network";
        editor.reroute(new Set([e.id]));
    }

    canvas.addEventListener("pointerdown", ev => {
        if (!editor.island || editor.busy || editor.gesture) return;
        if (ev.button !== 0 && ev.button !== 1) return;
        canvas.focus({ preventScroll: true });
        const screen = localPoint(ev),
            p = map.world(...screen),
            d = editor.island.design;
        if (ev.button === 1 || space) {
            beginPan(ev, screen);
            return;
        }
        if (map.drawing) {
            const drawing = map.drawing;
            beginPan(ev, screen, () => {
                if (map.drawing === drawing) editor.drawVertex(p);
            });
            return;
        }
        if (editor.tool === "peak") {
            beginPan(ev, screen, () => editor.createFeature("peak", [p]));
            return;
        }
        if (editor.tool === "via" || ev.altKey) {
            beginPan(ev, screen, () => {
                if (editor.tool !== "select" || !insertFeaturePoint(p)) insertWaypoint(screen);
            });
            return;
        }
        let h = map.hitHandle(...screen);
        if (editor.tool === "building") {
            beginPan(ev, screen, () => {
                if (!canPlaceBuilding(editor.island, p)) {
                    editor.message("请在空地上放置建筑", screen);
                    return;
                }
                const b = placeBuilding(d, p.map(v => +v.toFixed(2)), editor.island.terrain.zones[editor.island.terrain.zoneAt[editor.island.terrain.grid.index(...p)]]?.id);
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
                if (!wall && !canPlace(d, p)) return;
                const n = wall ? openDoorAt(d, wall, undefined) : addNode(d, p.map(v => +v.toFixed(2)));
                editor.setTool("select");
                editor.select({ kind: "node", id: n.id });
                editor.reroute(new Set());
            });
            return;
        }
        if (editor.tool === "edge" || editor.tool === "gate") {
            const yardAtPoint = () => (d.yards ?? []).map(y => areaBoundary(d, y)).find(y => insidePolygon(y, p) || nearest(...p, y.points, true).distance * map.scale < 8);
            if (editor.linkYard) {
                if (h?.kind === "node") finishGate(d, editor.linkYard, d.nodes.find(n => n.id === h!.id)!, true);
                else beginPan(ev, screen, () => editor.message("请单击区域外的终点节点"));
                return;
            }
            if (!editor.linkFrom) {
                const wall = editor.tool === "edge" && nearbyWall(d, p);
                if (wall) {
                    beginPan(ev, screen, () => beginWallLink(d, wall, false));
                    return;
                }
                if (h?.kind !== "node") {
                    beginPan(ev, screen, () => {
                        const yard = editor.tool === "gate" ? yardAtPoint() : null;
                        if (yard) {
                            editor.linkYard = yard;
                            editor.hint = yard.name + " → 单击区域外终点，Esc 取消";
                        }
                        else editor.message(editor.tool === "gate" ? "请单击院落、广场或外部节点" : "请先单击路网节点");
                    });
                    return;
                }
                editor.linkFrom = h.id;
                editor.select(h);
                editor.hint = editor.tool === "gate" ? "单击院落或广场放置入口，Esc 取消" : "单击终点节点或建筑外墙，Esc 取消";
            }
            else if (editor.tool === "edge") {
                beginPan(ev, screen, () => completeLink(d, h, p, false));
            }
            else beginPan(ev, screen, () => {
                const yard = yardAtPoint();
                if (!yard) {
                    editor.message("请单击院落或广场");
                    return;
                }
                finishGate(d, yard, d.nodes.find(n => n.id === editor.linkFrom)!, false);
            });
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
                editor.selection = { kind: "node", id: junction.id };
                editor.tab = "network";
                editor.reroute(new Set(junction.through));
                editor.hint = "拖出或单击支路终点 · 单击空白新建终点 · Esc 完成拆分";
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
        const hits = map.issueHits(screen);
        const landscape = map.hitFeature(p);
        if (!h && landscape && (!hits.length || featureOf(d, editor.selection)?.id === landscape.id)) {
            beginPan(ev, screen, () => editor.select({ kind: landscape.kind, id: landscape.id }));
            return;
        }
        h ??= map.hitBuilding(...screen);
        if (h) {
            const building = editor.selection?.kind === "building" && editor.selection.id;
            const linkedDoor = h.kind === "node" && d.nodes.find(n => n.id === h.id && n.type === "door" && n.building === building);
            if (!linkedDoor) editor.select(h.kind === "door" ? { kind: "building", id: h.id } : h);
            const offset = h.kind === "building" && ["center", "body", "title"].includes(h.role) ? [h.point[0] - p[0], h.point[1] - p[1]] : [0, 0];
            editor.gesture = { handle: h, offset, screen, pointer: ev.pointerId, changed: false, hits };
            canvas.setPointerCapture(ev.pointerId);
            return;
        }
        if (hits.length) {
            beginPan(ev, screen, () => editor.pickMarkers(hits));
            return;
        }
        const road = map.hitRoad(p);
        if (road) editor.select({ kind: "edge", id: road.route.id, index: road.index });
        else beginPan(ev, screen, () => editor.select(null));
    }, { signal });
    canvas.addEventListener("dblclick", ev => {
        if (!editor.island || editor.busy || ev.button !== 0 || space || ev.altKey) return;
        ev.preventDefault();
        if (map.drawing) {
            editor.finishDrawing();
            return;
        }
        const screen = localPoint(ev);
        if (editor.tool === "select" && !insertFeaturePoint(map.world(...screen))) insertWaypoint(screen);
    }, { signal });
    canvas.addEventListener("pointermove", ev => {
        if (!editor.island) return;
        const screen = localPoint(ev),
            p = map.world(...screen),
            d = editor.island.design;
        editor.position = "X " + p[0].toFixed(1) + "   Y " + p[1].toFixed(1) + "   H " + sample(editor.island.terrain.grid, editor.island.graded.heights, ...p).toFixed(1) + " m";
        if (map.drawing && !(editor.gesture && "pan" in editor.gesture)) {
            const drawing = map.drawing;
            drawing.cursor = p;
            drawing.hover = !drawing.points.length && !drawing.extension ? drawingTarget(d, drawing.kind, p, map.scale) : null;
            map.draw();
        }
        if (editor.linkFrom && ["edge", "fork"].includes(editor.tool) && !(editor.gesture && "pan" in editor.gesture)) {
            map.linkPreview = [nodePose(d, editor.linkFrom).point, p];
            map.draw();
        }
        if (!editor.gesture) {
            canvas.style.cursor = space || editor.tool === "select" ? "grab" : "crosshair";
            return;
        }
        if (editor.gesture.pointer !== ev.pointerId) return;
        if ("pan" in editor.gesture) {
            if (!editor.gesture.changed && distance(screen, editor.gesture.screen) < 3) return;
            editor.gesture.changed = true;
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
        const h = editor.gesture.handle;
        moveHandle(d, h, [p[0] + editor.gesture.offset[0], p[1] + editor.gesture.offset[1]]);
        if (h.kind === "via") editor.pendingEdges.add(h.id);
        if (h.kind === "node" || h.kind === "door") {
            const node = h.kind === "node" ? d.nodes.find(n => n.id === h.id) : d.nodes.find(n => n.building === h.id && n.door === h.role);
            if (node?.type === "door") {
                const b = d.buildings.find(b => b.id === node.building);
                for (const e of doorRoads(d, b, b!.doors.find(door => door.id === node.door))) editor.pendingEdges.add(e.id);
            }
            else if (node) {
                for (const e of d.edges) if (e.from === node.id || e.to === node.id) editor.pendingEdges.add(e.id);
            }
        }
        editor.schedule();
    }, { signal });

    function offerDoorConversion(h: Selection, p: Point) {
        const d = editor.island.design, node = d.nodes.find(n => n.id === h.id);
        if (!node || node.type === "door" || node.type === "gate")
            return false;
        const edges = d.edges.filter(e => e.from === node.id || e.to === node.id);
        const wall = edges.length && nearbyWall(d, p);
        if (!wall)
            return false;
        editor.offerConversion(node, wall, edges);
        return true;
    }

    function finishGesture(ev: PointerEvent) {
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
        if (!g.changed) {
            if (g.hits?.length && ev.type === "pointerup") editor.pickMarkers(g.hits);
            return;
        }
        editor.flushPending();
        if (g.handle.kind === "node" && ev.type === "pointerup" && offerDoorConversion(g.handle, map.world(...localPoint(ev)))) return;
        if (g.handle.kind === "planting" || g.handle.kind === "clearing") {
            editor.finishFeature(g.handle.kind);
            return;
        }
        if (g.handle.kind === "building" && g.handle.role === "title") {
            editor.revision++;
            editor.record();
            return;
        }
        if (["coast", "ridge", "zone", "yard", "building", "peak"].includes(g.handle.kind)) {
            editor.rebuild();
            return;
        }
        editor.revision++;
        editor.record();
    }
    canvas.addEventListener("pointerup", finishGesture, { signal });
    canvas.addEventListener("pointercancel", finishGesture, { signal });
    canvas.addEventListener("pointerleave", () => {
        if (map.drawing) {
            map.drawing.hover = null;
            map.drawing.cursor = null;
            map.draw();
        }
    }, { signal });
    canvas.addEventListener("auxclick", ev => ev.preventDefault(), { signal });
    document.addEventListener("keydown", ev => {
        if (editor.removal || editor.conversion) return;
        const input = ev.target instanceof Element && ev.target.matches("input,select,textarea,[contenteditable=true]");
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
            ev.preventDefault();
            if (!editor.busy) editor.files.save();
            return;
        }
        if (editor.busy || editor.draft) return;
        if (ev.key === "Escape" && (!input || editor.tool !== "select")) {
            ev.preventDefault();
            canvas.focus({ preventScroll: true });
            if (map.drawing?.extension) {
                editor.setTool("ridge");
                map.draw();
                return;
            }
            editor.setTool("select");
            editor.select(null);
            return;
        }
        if (input) return;
        if (ev.key === "Enter" && map.drawing) {
            ev.preventDefault();
            editor.finishDrawing();
            return;
        }
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") {
            ev.preventDefault();
            editor.navigate(ev.shiftKey);
            return;
        }
        if (ev.code === "Space") {
            ev.preventDefault();
            space = true;
            canvas.style.cursor = "grab";
        }
        if (ev.key === "Delete") {
            ev.preventDefault();
            if (!editor.gesture) editor.removeSelected();
        }
    }, { signal });

    function releaseSpace() {
        space = false;
        canvas.style.cursor = "";
    }
    document.addEventListener("keyup", ev => {
        if (ev.code === "Space") releaseSpace();
    }, { signal });
    window.addEventListener("blur", releaseSpace, { signal });
    return () => listeners.abort();
}
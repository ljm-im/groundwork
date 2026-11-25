import { isBuiltin } from "../../core/design/defaults.ts";
import { neighbor, segmentType } from "../../core/design/path.ts";
import { type Curve, type Design, type GeoNode } from "../../core/design/v5.ts";
import { type Issue } from "../../core/design/results.ts";
import { geometryPath, type GeoControl } from "../../core/edit/geoControls.ts";
import { canRemoveNode, canSetManual, segmentRemovalIndex } from "../../core/edit/paths.ts";
import { type Selection } from "../../core/edit/types.ts";
import { geoAt } from "./geoTools.ts";
import { nodeModes, segmentTypes } from "./inspector.ts";
type Editor = import("./session.svelte.ts").Editor;
type MenuItem = import("../components/Menu.svelte").MenuItem;

type Action = MenuItem & { run: (editor: Editor) => void };
interface Group { title: string; items: Action[] }

function geometryGroups(id: string, control: GeoControl, curve: Curve): Group[] {
    const groups: Group[] = [], { index } = control, node = curve.nodes[index];
    if (control.role === "vertex") {
        groups.push({ title: "节点类型", items: nodeModes.map(([id, name, icon]) => ({
            id, name, icon, selected: node.mode === id, disabled: id === "manual" && !canSetManual(curve, index),
            run: editor => editor.pathNodeMode(control, id)
        })) });
        if (canRemoveNode(curve)) groups.push({ title: "节点", items: [
            { id: "delete-node", name: "删除节点", icon: "delete", danger: true, run: editor => editor.removeGeo(id, control) }
        ] });
    }
    else {
        const type = segmentType(curve, index);
        const types: Action[] = segmentTypes.map(([id, name, icon]) => ({
            id, name, icon, selected: type === id, run: editor => editor.segment(control, id)
        }));
        if (type === "arc") types.push({ id: "tangent", name: "相切", icon: "tangent",
            disabled: neighbor(curve, index, -1) === undefined, run: editor => editor.segment(control, "tangent") });
        const items: Action[] = [{ id: "insert-node", name: "插入节点", icon: "nodeCorner", run: editor => editor.insertNode(id, control) }];
        if (segmentRemovalIndex(curve, index) !== undefined) items.push(
            { id: "delete-segment", name: "删除线段", icon: "delete", danger: true, run: editor => editor.removeGeo(id, control) });
        groups.push({ title: "线段类型", items: types }, { title: "线段", items });
    }
    groups.push({ title: curve.closed ? "闭合曲线" : "曲线", items: [
        { id: "curve-auto", name: "全部节点改为自动平滑", icon: "nodeAuto", run: editor => editor.wholeCurve(control, "auto") },
        { id: "curve-line", name: "全部线段改为直线", icon: "segmentLine", run: editor => editor.wholeCurve(control, "line") }
    ] });
    return groups;
}

function memberGroup(id: string, group: "ridges" | "peaks", index: number): Group {
    const name = group === "ridges" ? "山脊" : "山峰";
    return { title: name + " " + (index + 1), items: [
        { id: "copy-member", name: "复制" + name, icon: "copy", run: editor => editor.changeMember(id, group, index, true) },
        { id: "delete-member", name: "删除" + name, icon: "delete", danger: true, run: editor => editor.changeMember(id, group, index, false) }
    ] };
}

function geoGroups(node: GeoNode, control?: GeoControl): [Group[], Group[]] {
    const id = node.id, c = node.construction, f = node.function;
    const geometry = control?.role === "vertex" || control?.role === "segment" ? geometryPath(node, control.path) : undefined;
    const left = control && geometry ? geometryGroups(id, control, geometry) : [], right: Group[] = [];
    const outline = control && control.path >= 0 && (geometry || control.role === "outline") ? control.path : undefined;
    if (outline !== undefined && c.type === "free" && c.paths.length > 1) {
        const index = outline;
        right.push({ title: "轮廓 " + (index + 1), items: [
            { id: "delete-path", name: "删除轮廓", icon: "delete", danger: true, run: editor => editor.removePath(id, index) }
        ] });
    }
    if (!control || control.role === "body" || outline !== undefined) {
        const item: Action = c.type === "free"
            ? { id: "add-path", name: "添加轮廓", icon: "plus", run: editor => editor.setTool("addPath", id) }
            : { id: "reselect-strip", name: "重选边", icon: "strip", run: editor => editor.setTool("strip", id) };
        right.push({ title: "区域", items: [item] });
    }
    if (f.type === "mountain" && control) {
        if (geometry && control.path < 0) right.push(memberGroup(id, "ridges", -1 - control.path));
        if (control.role === "parameter" && f.peaks[control.path - f.ridges.length])
            right.push(memberGroup(id, "peaks", control.path - f.ridges.length));
    }
    return [left, right];
}

export function issueMenuColumns(issue: Issue): Group[][] {
    return [[{ title: issue.severity === "error" ? "错误" : "警告", items: [
        { id: "show-in-view", name: "在视野中显示", icon: "fit", run: editor => editor.issueAt(issue) }
    ] }]];
}

export function contextMenuColumns(design: Design, h: Selection, map: boolean, control?: GeoControl): Group[][] {
    const { kind, id } = h;
    if ((kind === "input" || kind === "field") && isBuiltin(kind, id)) return [];
    const node = kind === "geoNode" ? geoAt(design, id) : undefined;
    const [left, right] = node && map ? geoGroups(node, control) : [[], []];
    const items: Action[] = [];
    let title: string;
    if (!map && (kind === "geoNode" || kind === "mark" || kind === "section"))
        items.push({ id: "show-in-view", name: "在视野中显示", icon: "fit", run: editor => editor.showInView(h) });
    if (node) {
        title = "地件";
        items.push({ id: "copy", name: "复制地件", icon: "copy", run: editor => editor.duplicate(id) },
            { id: "exclude", name: node.disabled ? "启用地件" : "禁用地件", icon: "exclude",
                selected: !!node.disabled, run: editor => editor.toggle(id) });
    }
    else if (kind === "mark") {
        title = design.marks.find(mark => mark.id === id)?.kind === "scale" ? "比例尺" : "文字标记";
        items.push({ id: "copy", name: "复制" + title, icon: "copy", run: editor => editor.copyMark(id) });
    }
    else title = kind === "section" ? "剖面线" : kind === "input" ? "输入" : "场";
    items.push({ id: "delete", name: "删除" + title, icon: "delete", danger: true, run: editor => editor.removeElement(h) });
    right.push({ title, items });
    return left.length ? [left, right] : [right];
}
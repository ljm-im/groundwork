{#if menu && editor.selection}
    {#key menu}
        <Menu label="编辑菜单" variant="context-menu" point={menu} {groups}
            close={() => editor.menu = null} choose={choose} />
    {/key}
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { geoAt } from "../state/geoTools.ts";
    import { geometryPath } from "../../core/edit/geoControls.ts";
    import { neighbor, segmentType } from "../../core/design/path.ts";
    import { canRemoveNode, canSetManual } from "../../core/edit/paths.ts";
    import { nodeModes, segmentTypes } from "../state/inspector.ts";
    import Menu, { type MenuItem } from "./Menu.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let menu = $derived(editor.menu);
    type Action = MenuItem & { run: () => void };
    let groups = $derived.by(() => {
        const h = editor.selection;
        const result: { title?: string; items: Action[] }[] = [], actions: Action[] = [];
        if (!menu || !h) return result;
        const control = menu.control;
        if (h.kind === "geoNode") {
            const node = geoAt(editor.project.design, h.id);
            if (menu.map && node.construction.type === "free") {
                const items: Action[] = [{ id: "add-path", name: "添加边界", icon: "plus", run: () => editor.setTool("addPath", h.id) }];
                if (control && control.role !== "body" && control.role !== "parameter" && control.path >= 0 && node.construction.paths.length >= 2)
                    items.push({ id: "delete-path", name: "删除边界", icon: "delete", danger: true, run: () => editor.removePath(h.id, control.path) });
                result.push({ items });
            }
            if (control?.role === "vertex" || control?.role === "segment") {
                const curve = geometryPath(node, control.path), point = curve?.nodes[control.index];
                if (curve && point) {
                    result.push({ title: "节点类型", items: nodeModes.map(([id, name, icon]) => ({
                        id, name, icon, selected: point.mode === id, disabled: id === "manual" && !canSetManual(curve, control.index),
                        run: () => editor.pathNodeMode(control, id)
                    })) });
                    const type = segmentType(curve, control.index);
                    if (type) {
                        const items: Action[] = segmentTypes.map(([id, name, icon]) => ({
                            id, name, icon, selected: type === id, run: () => editor.segment(control, id)
                        }));
                        if (type === "arc") items.push({ id: "tangent", name: "相切", icon: "tangent",
                            disabled: neighbor(curve, control.index, -1) === undefined, run: () => editor.segment(control, "tangent") });
                        result.push({ title: "后一段", items });
                    }
                    result.push({ title: "整条曲线", items: [
                        { id: "curve-auto", name: "全部节点改为自动平滑", icon: "nodeAuto", run: () => editor.wholeCurve(control, "auto") },
                        { id: "curve-line", name: "全部线段改为直线", icon: "segmentLine", run: () => editor.wholeCurve(control, "line") }
                    ] });
                    if (control.role === "segment")
                        result.push({ items: [{ id: "insert-node", name: "插入节点", icon: "nodeCorner", run: () => editor.insertNode(h.id, control) }] });
                    else if (canRemoveNode(curve))
                        result.push({ items: [{ id: "delete-node", name: "删除节点", icon: "delete", danger: true, run: () => editor.removeGeo(h.id, control) }] });
                }
            }
            actions.push({ id: "copy", name: "复制", icon: "copy", run: () => editor.duplicate(h.id) },
                { id: "exclude", name: node.disabled ? "启用" : "禁用", icon: "exclude", selected: !!node.disabled, run: () => editor.toggle(h.id) });
        }
        else if (h.kind === "mark") actions.push({ id: "copy", name: "复制", icon: "copy", run: () => editor.copyMark(h.id) });
        if (!menu.map && (h.kind === "geoNode" || h.kind === "section" || h.kind === "mark"))
            actions.unshift({ id: "show-in-view", name: "在视野中显示", icon: "fit", run: () => editor.showInView(h) });
        if (editor.canRemove(h)) actions.push({ id: "delete", name: "删除", icon: "delete", danger: true, run: () => editor.removeElement(h) });
        if (actions.length) result.push({ items: actions });
        return result;
    });
    function choose(id: string) {
        const action = groups.flatMap(group => group.items).find(item => item.id === id);
        editor.menu = null;
        action?.run();
    }
</script>
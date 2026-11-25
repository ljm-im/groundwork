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
                const point = geometryPath(node, control.path)?.nodes[control.index];
                if (point) {
                    result.push({ title: "节点类型", items: nodeModes.map(([id, name, icon]) => ({
                        id, name, icon, selected: point.mode === id, run: () => editor.pathNodeMode(control, id)
                    })) });
                    const items: Action[] = segmentTypes.map(([id, name, icon]) => ({
                        id, name, icon, selected: (point.next ?? "curve") === id, run: () => editor.segment(control, id)
                    }));
                    if (point.next === "arc") items.push({ id: "tangent", name: "相切", icon: "tangent", run: () => editor.segment(control, "tangent") });
                    result.push({ title: "后一段", items });
                    result.push({ items: control.role === "vertex" ?
                        [{ id: "delete-node", name: "删除节点", icon: "delete", danger: true, run: () => editor.removeGeo(h.id, control) }] :
                            [{ id: "insert-node", name: "插入节点", icon: "nodeCorner", run: () => editor.insertNode(h.id, control) }] });
                }
            }
            actions.push({ id: "copy", name: "复制", icon: "copy", run: () => editor.duplicate(h.id) },
                { id: "exclude", name: node.disabled ? "启用" : "禁用", icon: "exclude", selected: !!node.disabled, run: () => editor.toggle(h.id) });
        }
        else if (h.kind === "mark") actions.push({ id: "copy", name: "复制", icon: "copy", run: () => editor.copyMark(h.id) });
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
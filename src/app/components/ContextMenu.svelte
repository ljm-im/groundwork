{#if menu && columns.length}
    {#key menu}
        <Menu label="编辑菜单" variant="context-menu" point={menu} surface={menu.map ? editor.map.canvas : undefined} {columns}
            close={() => editor.menu = null} choose={choose} />
    {/key}
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { contextMenuColumns, issueMenuColumns } from "../state/contextMenu.ts";
    import Menu from "./Menu.svelte";

    let { editor }: { editor: session.Editor } = $props();
    let menu = $derived(editor.menu);
    let columns = $derived(menu?.issue ? issueMenuColumns(menu.issue) :
        menu && editor.selection ? contextMenuColumns(editor.project.resolved, editor.selection, !!menu.map, menu.control) : []);
    function choose(id: string) {
        const action = columns.flat().flatMap(group => group.items).find(item => item.id === id);
        editor.menu = null;
        action?.run(editor);
    }
</script>
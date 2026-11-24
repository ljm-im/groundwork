<header class="topbar">
    <img class="brand" src="./groundwork.svg" alt="">
    <h1>Groundwork</h1>
    <div class="file-info">
        {#if editor.project}<i id="dirty-dot" class="dot" class:dirty={editor.saveState === "未保存"} class:saving={editor.saveState === "正在保存"} class:failed={editor.saveState === "保存失败"}></i>{/if}
        <span id="filename" data-tip={editor.filename}>{editor.filename}</span>
        {#if editor.project}<span class="saved-text" id="save-state" aria-live="polite">{editor.saveState}</span>{/if}
    </div>
    <div class="header-actions">
        <button class="icon-button" id="undo" data-tip="撤销" aria-label="撤销" disabled={!editor.canUndo} onclick={() => editor.navigate(false)}><Icon name="undo" /></button>
        <button class="icon-button" id="redo" data-tip="重做" aria-label="重做" disabled={!editor.canRedo} onclick={() => editor.navigate(true)}><Icon name="redo" /></button>
        <button id="new" disabled={unavailable} onclick={() => editor.files.choose("new")}><Icon name="new" />新建</button>
        <button id="open" disabled={unavailable} onclick={() => editor.files.choose("open")}><Icon name="open" />打开</button>
        <button id="save" class="primary" disabled={unavailable || !editor.project} onclick={() => editor.files.save()}><Icon name="save" />保存</button>
    </div>
</header>

<style>
    .topbar { height: var(--topbar-h); display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-4); border-bottom: 1px solid var(--border-region); background: var(--bg-sunken); }
    .brand { width: var(--icon-button); height: var(--icon-button); flex: none; }
    .file-info { min-width: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--text-secondary); font-size: var(--text-sm); }
    .dot { width: 6px; height: 6px; background: var(--accent); border-radius: var(--radius-round); display: inline-block; flex: none; }
    .dot.dirty { background: var(--warning); }
    .dot.saving { background: var(--text-secondary); }
    .dot.failed { background: var(--danger); }
    #filename { max-width: 28vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .saved-text { white-space: nowrap; }
    .header-actions { margin-left: auto; display: flex; align-items: center; gap: var(--space-1); }
    @media (max-width: 680px) {
        .topbar { height: auto; min-height: var(--topbar-h); flex-wrap: wrap; gap: var(--space-1); padding: var(--space-1) var(--space-2); }
        .file-info { gap: var(--space-1); }
        #filename { max-width: 15vw; }
        .header-actions { flex-wrap: wrap; justify-content: flex-end; }
    }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    let unavailable = $derived(!editor.files.supported || !!editor.draft);
</script>
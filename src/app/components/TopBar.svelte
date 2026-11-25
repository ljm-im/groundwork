<header class="topbar">
    <img class="brand" src="./groundwork.svg" alt="">
    <h1>Groundwork</h1>
    <div class="file-info">
        {#if editor.project}<i id="dirty-dot" class="dot" class:dirty={editor.saveState === "未保存"} class:saving={editor.saveState === "正在保存"} class:danger={editor.saveState === "保存失败"}></i>{/if}
        <span id="filename" data-tip={editor.filename}>{editor.filename}</span>
        {#if editor.project}<span class="saved-text" id="save-state" aria-live="polite">{editor.saveState}</span>{/if}
    </div>
    <div class="header-actions">
        <button class="icon-button" id="appearance" aria-label="外观" data-tip="外观" aria-haspopup="menu"
            aria-pressed={open} aria-expanded={open} bind:this={anchor}
            onclick={() => {
                openingKey = undefined; open = !open;
            }} onkeydown={openWithKey}>
            <Icon name={current.icon} />
        </button>
        <button class="icon-button" id="undo" data-tip="撤销" aria-label="撤销" disabled={editor.busy || !editor.canUndo} onclick={() => editor.navigate(false)}><Icon name="undo" /></button>
        <button class="icon-button" id="redo" data-tip="重做" aria-label="重做" disabled={editor.busy || !editor.canRedo} onclick={() => editor.navigate(true)}><Icon name="redo" /></button>
        <button id="new" disabled={unavailable} onclick={() => editor.files.choose("new")}><Icon name="new" />新建</button>
        <button id="open" disabled={unavailable} onclick={() => editor.files.choose("open")}><Icon name="open" />打开</button>
        <button id="save" class="primary" disabled={unavailable || !editor.project} onclick={() => editor.files.save()}><Icon name="save" />保存</button>
        <button id="export" disabled={unavailable || !editor.project} onpointerdown={e => {
            if (e.button === 0 && isEditableText(document.activeElement)) e.preventDefault();
        }} onclick={() => editor.files.export()}><Icon name="export" />导出</button>
    </div>
</header>
{#if open}
    <Menu label="外观" variant="appearance-menu" {anchor} {openingKey} {close}
        groups={[{ items: appearances.map(item => ({ ...item, selected: item === current })) }]} choose={choose} />
{/if}

<style>
    :global(.appearance-menu) { min-width: 140px; }
    .topbar { height: var(--topbar-h); display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-4); border-bottom: 1px solid var(--border-region); background: var(--bg-sunken); }
    .brand { width: var(--icon-button); height: var(--icon-button); flex: none; }
    .file-info { min-width: 0; display: flex; align-items: center; gap: var(--space-2); color: var(--text-secondary); font-size: var(--text-sm); }
    .dot { width: 6px; height: 6px; background: var(--accent); border-radius: var(--radius-round); display: inline-block; flex: none; }
    .dot.dirty { background: var(--warning); }
    .dot.saving { background: var(--text-secondary); }
    .dot.danger { background: currentColor; }
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
    import { isEditableText } from "../state/pendingInput.ts";
    import { menuDirection } from "../state/popup.ts";
    import { type Appearance } from "../state/theme.ts";
    import * as session from "../state/session.svelte.ts";
    import Icon, { type IconName } from "./Icon.svelte";
    import Menu from "./Menu.svelte";

    let { editor, appearance, chooseAppearance }: {
        editor: session.Editor; appearance: Appearance; chooseAppearance: (value: Appearance) => void;
    } = $props();
    let unavailable = $derived(editor.busy || !editor.files.supported);
    const appearances: readonly { id: Appearance; name: string; icon: IconName }[] = [
        { id: "system", name: "跟随系统", icon: "themeSystem" },
        { id: "light", name: "浅色", icon: "themeLight" },
        { id: "dark", name: "深色", icon: "themeDark" }
    ];
    let current = $derived(appearances.find(item => item.id === appearance)!);
    let anchor = $state<HTMLButtonElement>(null!), open = $state(false), openingKey = $state<string>();

    function close(focus = false, event?: KeyboardEvent) {
        event?.stopPropagation();
        open = false; openingKey = undefined;
        if (focus) anchor.focus({ preventScroll: true });
    }
    function openWithKey(e: KeyboardEvent) {
        if (!open && menuDirection(e)) {
            e.preventDefault();
            openingKey = e.key; open = true;
        }
    }
    function choose(id: string) {
        const item = appearances.find(item => item.id === id);
        if (item) chooseAppearance(item.id);
        close(true);
    }
</script>
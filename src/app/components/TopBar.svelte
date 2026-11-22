<header>
    <svg class="brand" viewBox="0 0 36 36" aria-hidden="true"><rect width="36" height="36" rx="7" fill="#285e50"/><path d="M3 24c7 3 9-1 10-8s5-10 11-10 7-1 9-3M3 28c9 3 13-2 14-10s5-8 10-8 5-1 6-2M5 32c10 3 15-3 16-12s6-5 12-8M12 33c9-2 11-6 13-12s5-3 8-5"/></svg>
    <h1>Groundwork</h1>
    <div class="file-info">
        {#if editor.island}<i id="dirty-dot" class="dot" class:dirty={editor.saveState === "未保存"} class:saving={editor.saveState === "正在保存"} class:failed={editor.saveState === "保存失败"}></i>{/if}
        <span class="mono" id="filename" title={editor.filename}>{editor.filename}</span>
        {#if editor.island}<span class="saved-text" id="save-state" aria-live="polite">{editor.saveState}</span>{/if}
    </div>
    <div class="header-actions">
        <button class="icon flat" id="undo" title="撤销（Ctrl+Z）" aria-label="撤销" disabled={!editor.canUndo || !!editor.busy} onclick={() => editor.navigate(false)}><Icon name="undo" /></button>
        <button class="icon flat" id="redo" title="重做（Ctrl+Shift+Z）" aria-label="重做" disabled={!editor.canRedo || !!editor.busy} onclick={() => editor.navigate(true)}><Icon name="redo" /></button>
        <i class="divider"></i>
        <button id="new" class="flat" disabled={unavailable} onclick={() => editor.files.choose("new")}><Icon name="new" />新建</button>
        <button id="open" class="flat" disabled={unavailable} onclick={() => editor.files.choose("open")}><Icon name="open" />打开</button>
        <button id="save" class="primary" disabled={unavailable || !editor.island} onclick={() => editor.files.save()}><Icon name="save" />保存</button>
    </div>
</header>

<style>
    :global {
        header {
            height: 63px;
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 0 21px;
            border-bottom: 1px solid var(--line);
            background: var(--paper);
        }
        .brand {
            width: 34px;
            height: 34px;
            flex: none;
        }
        .brand path {
            stroke: #eef2de;
            fill: none;
            stroke-width: 1.2;
        }
        h1 {
            font-size: 18px;
            letter-spacing: .035em;
            font-weight: 650;
            margin: 0;
        }
        .file-info {
            border-left: 1px solid var(--line);
            padding-left: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--muted);
            font-size: 12px;
        }
        .dot {
            width: 7px;
            height: 7px;
            background: #6a9074;
            border-radius: 50%;
            display: inline-block;
        }
        .dot.dirty {
            background: #ba853b;
        }
        .dot.saving {
            background: var(--teal);
        }
        .dot.failed {
            background: var(--red);
        }
        #filename {
            max-width: 28vw;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .header-actions {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        @media (max-width:900px) {
            header {
                gap: 9px;
                padding: 0 12px;
            }
        }
        @media (max-width:680px) {
            header {
                height: auto;
                min-height: 57px;
                flex-wrap: wrap;
                padding: 8px;
                gap: 6px;
            }
            h1 {
                font-size: 15px;
            }
            .brand {
                width: 27px;
                height: 27px;
            }
            .file-info {
                border: 0;
                padding: 0;
            }
            .header-actions {
                gap: 1px;
            }
            .header-actions button {
                min-height: 28px;
                padding: 3px 5px;
                font-size: 12px;
            }
            .header-actions .divider {
                display: none;
            }
        }
    }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    let unavailable = $derived(!editor.files.supported || !!editor.busy || !!editor.draft);
</script>
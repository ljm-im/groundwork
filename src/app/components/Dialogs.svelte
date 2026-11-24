<dialog bind:this={remove} id="remove-dialog" class="dialog" aria-labelledby="remove-heading" onclose={() => {
    const pending = editor.removal;
    editor.removal = null;
    if (remove.returnValue === "remove") pending?.perform?.();
}}>
    <h2 id="remove-heading">{editor.removal?.title ?? ""}</h2>
    <div class="sub">{editor.removal?.detail ?? ""}</div>
    {#if editor.removal?.items?.length}
        <ul id="affected-items">
            {#each editor.removal.items as item, i (i)}
                <li><button onclick={() => {
                    remove.close("reference"); item.locate();
                }}>{item.text}</button></li>
            {/each}
        </ul>
    {/if}
    <form method="dialog"><button value="cancel">{editor.removal?.perform ? "取消" : "关闭"}</button>{#if editor.removal?.perform}<button class="confirm-danger" value="remove">{editor.removal.action ?? "确认删除"}</button>{/if}</form>
</dialog>
<dialog bind:this={discard} id="discard-changes" class="dialog" aria-labelledby="discard-title" onclose={() => editor.fileRequest = null}>
    <h2 id="discard-title">放弃未保存的修改？</h2>
    <form method="dialog">
        <button value="cancel">取消</button>
        <button class="danger" value="discard" onclick={() => {
            if (editor.fileRequest) void editor.files.choose(editor.fileRequest, true);
        }}>放弃修改</button>
    </form>
</dialog>
<div class="draft" id="draft-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-title" hidden={!editor.draft}>
    <section class="dialog">
        <h2 id="draft-title">恢复未保存的草稿？</h2>
        <div class="sub" id="draft-date">{editor.draft ? "上次编辑于 " + new Date(editor.draft.date).toLocaleString() + "。" : ""}</div>
        <div class="draft-actions"><button id="discard" onclick={() => editor.files.discard()}>放弃草稿</button><button id="restore" onclick={() => editor.files.restore()}>恢复草稿</button></div>
    </section>
</div>

<style>
    :global {
        .draft {
            position: fixed;
            inset: 0;
            background: var(--backdrop);
            display: grid;
            place-items: center;
            z-index: var(--z-dialog);
        }
        .draft[hidden] {
            display: none;
        }
        .dialog {
            width: min(350px, 90vw);
            background: var(--bg-panel);
            color: var(--text);
            border: 1px solid var(--border);
            padding: var(--space-6);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-pop);
        }
        dialog.dialog form {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin: var(--space-2) 0 0;
        }
        dialog.dialog {
            margin: auto;
            max-height: 80vh;
            overflow: auto;
        }
        dialog.dialog::backdrop {
            background: var(--backdrop);
        }
        dialog.dialog form {
            justify-content: flex-end;
        }
        #affected-items {
            padding: 0;
            list-style: none;
        }
        #affected-items button { border: 0; width: 100%; justify-content: start; text-align: start; }
        .draft-actions {
            display: flex;
            justify-content: flex-end;
            gap: var(--space-2);
            margin-top: var(--space-4);
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    let remove: HTMLDialogElement, discard: HTMLDialogElement;
    $effect(() => {
        if (editor.fileRequest && !discard.open) discard.showModal();
    });
    $effect(() => {
        if (editor.removal && !remove.open) {
            remove.returnValue = "cancel";
            remove.showModal();
        }
    });
</script>
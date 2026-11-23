<dialog bind:this={remove} id="remove-dialog" class="dialog" onclose={() => {
    const pending = editor.removal;
    editor.removal = null;
    if (remove.returnValue === "remove") pending?.perform?.();
}}>
    <h2 id="remove-heading">{editor.removal?.title ?? ""}</h2><div class="sub">{editor.removal?.detail ?? "确认后，以下道路的门节点将转为原地的自由端点。"}</div>
    <ul id="affected-items">{#each editor.removal?.items ?? [] as item, i (i)}<li>{item}</li>{/each}</ul>
    <form method="dialog"><button value="cancel">{editor.removal?.perform ? "取消" : "关闭"}</button>{#if editor.removal?.perform}<button class="confirm-danger" value="remove">{editor.removal.action ?? "确认删除"}</button>{/if}</form>
</dialog>
<dialog bind:this={convert} id="convert-dialog" class="dialog" onclose={() => {
    const pending = editor.conversion;
    editor.conversion = null;
    pending?.finish(convert.returnValue === "convert");
}}>
    <h2>转换为门？</h2><div id="convert-detail" class="sub">{editor.conversion?.text ?? ""}</div>
    <form method="dialog"><button value="keep">保留节点</button><button value="convert">转换为门</button></form>
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
            padding-left: var(--space-6);
        }
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
    let remove: HTMLDialogElement, convert: HTMLDialogElement, discard: HTMLDialogElement;
    $effect(() => {
        if (editor.fileRequest && !discard.open) discard.showModal();
    });
    $effect(() => {
        if (editor.removal && !remove.open) {
            remove.returnValue = "cancel";
            remove.showModal();
        }
    });
    $effect(() => {
        if (editor.conversion && !convert.open) {
            convert.returnValue = "keep";
            convert.showModal();
        }
    });
</script>
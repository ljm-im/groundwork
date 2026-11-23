<div bind:this={toast} id="toast" class="toast" class:near={!!editor.toast?.point} role="status" hidden={!editor.toast}>{editor.toast?.text ?? ""}</div>

<style>
    :global {
        .toast {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            z-index: var(--z-pop);
            background: var(--bg-panel);
            color: var(--text);
            padding: var(--space-1) var(--space-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-pop);
            font-size: var(--text-sm);
            line-height: var(--leading-sm);
        }
        .toast {
            white-space: pre-line;
            max-width: calc(100% - 30px);
            bottom: calc(var(--status-h) + var(--space-2));
            pointer-events: none;
        }
        .toast.near {
            bottom: auto;
            width: max-content;
            max-width: calc(100% - 8px);
            transform: none;
        }
        .toast[hidden] {
            display: none;
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    let toast: HTMLDivElement;
    $effect(() => {
        const point = editor.toast?.point;
        toast.style.left = point ? Math.max(4, Math.min(editor.map.width - toast.offsetWidth - 4, point[0] + 12)) + "px" : "";
        toast.style.top = point ? Math.max(4, Math.min(editor.map.height - toast.offsetHeight - 4, point[1] + 12)) + "px" : "";
    });
</script>
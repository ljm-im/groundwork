<div bind:this={toast} id="toast" class="toast" class:near={!!editor.toast?.point} class:waiting
    role="status" aria-hidden={waiting || undefined} hidden={!text}>{text}</div>

<style>
    :global {
        .toast {
            grid-area: 3 / 2;
            justify-self: center;
            z-index: var(--z-pop);
            background: var(--bg-panel);
            color: var(--text);
            padding: var(--space-1) var(--space-2);
            border: 1px solid var(--border-region);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-pop);
            font-size: var(--text-sm);
            line-height: var(--leading-sm);
            white-space: pre-line;
            overflow-wrap: anywhere;
            max-width: 40cqw;
            pointer-events: none;
        }
        .toast.waiting { animation: show-busy 200ms steps(1, end) both; will-change: opacity; }
        @keyframes show-busy {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        .toast.near {
            position: absolute;
            grid-area: auto;
            width: max-content;
            max-width: calc(100% - 8px);
        }
        .toast[hidden] {
            display: none;
        }
        @container map-column (max-width: 680px) {
            .toast:not(.near) { grid-area: 2 / 1 / 3 / 3; max-width: 100%; }
            .map-wrap.empty .toast:not(.near) { grid-row: 4; }
        }
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    let { editor }: { editor: session.Editor } = $props();
    let toast: HTMLDivElement;
    let busyReady = $state(false);
    let waiting = $derived(!editor.toast && !!editor.busyText && !busyReady);
    let busyText = $derived(editor.busyText === "正在生成地形…" || editor.busyText === "正在更新地件…" ? "计算中" : editor.busyText ?? "");
    let text = $derived(editor.toast?.text ?? busyText);
    $effect(() => {
        busyReady = false;
        if (!editor.busyText) return;
        const timer = setTimeout(() => busyReady = true, 200);
        return () => clearTimeout(timer);
    });
    $effect(() => {
        const point = editor.toast?.point;
        toast.style.left = point ? Math.max(4, Math.min(editor.map.width - toast.offsetWidth - 4, point[0] + 12)) + "px" : "";
        toast.style.top = point ? Math.max(4, Math.min(editor.map.height - toast.offsetHeight - 4, point[1] + 12)) + "px" : "";
    });
</script>
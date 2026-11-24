<Part title="描述">
    <textarea rows="4" aria-label="描述" value={editor.description(target)} use:pendingInput={commit}
        bind:this={field} onfocus={() => group = Symbol()} oninput={input}
        oncompositionstart={() => {
            beforeComposition = field.value;
            composing = true; clearTimeout(timer);
        }} oncompositionend={() => {
            composing = false; schedule();
        }} onblur={() => {
            composing = false; commit(); group = undefined;
        }}></textarea>
</Part>

<style>
    textarea { display: block; width: 100%; height: auto; min-height: calc(4lh + 2 * var(--space-2)); resize: vertical; padding: var(--space-2); }
</style>

<script lang="ts">
    import { onDestroy } from "svelte";
    import * as session from "../state/session.svelte.ts";
    import { pendingInput } from "../state/pendingInput.ts";
    import Part from "./Part.svelte";

    let { editor, target }: { editor: session.Editor; target: session.DescriptionTarget } = $props();
    let field: HTMLTextAreaElement, group: symbol | undefined, composing = false, beforeComposition = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    function commit() {
        clearTimeout(timer);
        if (field) editor.describe(target, composing ? beforeComposition : field.value, group);
    }
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(commit, 500);
    }
    function input(e: Event) {
        if (!composing && !(e instanceof InputEvent && e.isComposing)) schedule();
    }
    onDestroy(() => clearTimeout(timer));
</script>
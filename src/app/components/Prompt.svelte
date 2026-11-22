<Part {title}>
    <textarea rows="4" aria-label={title} data-prompt={target.group} value={promptOwner(editor.island.design, target).prompt ?? ""}
        onblur={event => editor.describe(target, event.currentTarget.value)}></textarea>
</Part>

<style>
    textarea {
        display: block;
        width: 100%;
        min-height: calc(4lh + 14px);
        field-sizing: content;
        resize: vertical;
        padding: 6px 8px;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: white;
        line-height: 1.5;
    }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { promptOwner, type PromptTarget } from "../../core/edit/history.ts";
    import Part from "./Part.svelte";

    let { editor, target, title = "描述" }: { editor: session.Editor; target: PromptTarget; title?: string } = $props();
</script>
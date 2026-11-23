<textarea rows="4" aria-label="描述" {placeholder} data-prompt={target.group} value={descriptionOwner(editor.island.design, target).prompt ?? ""}
    onblur={event => editor.describe(target, event.currentTarget.value)}></textarea>

<style>
    textarea { display: block; width: 100%; height: auto; min-height: calc(4lh + 2 * var(--space-2)); resize: vertical; padding: var(--space-2); }
</style>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { descriptionOwner, type DescriptionTarget } from "../state/descriptions.ts";

    let { editor, target, placeholder }: { editor: session.Editor; target: DescriptionTarget; placeholder?: string } = $props();
</script>
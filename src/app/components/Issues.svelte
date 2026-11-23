{#if editor.candidates?.length}
    <Part title="此处的问题" count={editor.candidates.length}><IssueRows {editor} issues={editor.candidates} /></Part>
{:else}
    <Part title="问题" count={errors.length}>{#if errors.length}<IssueRows {editor} issues={errors} />{:else}<div class="sub panel-inset">通过全部检查</div>{/if}</Part>
    <Part title="提示" count={warnings.length}>{#if warnings.length}<IssueRows {editor} issues={warnings} />{:else}<div class="sub panel-inset">无提示</div>{/if}</Part>
{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import IssueRows from "./IssueRows.svelte";
    import Part from "./Part.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let errors = $derived(editor.island.issues.filter(i => i.severity === "error"));
    let warnings = $derived(editor.island.issues.filter(i => i.severity === "notice"));
</script>
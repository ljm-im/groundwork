{#if errors.length || warnings.length}
    <Part title="问题">{#if errors.length}<IssueRows {editor} issues={errors} />{:else}<div class="list-empty">没有匹配的结果</div>{/if}</Part>
    <Part title="提示">{#if warnings.length}<IssueRows {editor} issues={warnings} />{:else}<div class="list-empty">没有匹配的结果</div>{/if}</Part>
{:else}<div class="list-empty">没有匹配的结果</div>{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import IssueRows from "./IssueRows.svelte";
    import Part from "./Part.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let errors = $derived(editor.project.issues.filter(i => i.severity === "error"));
    let warnings = $derived(editor.project.issues.filter(i => i.severity === "notice"));
</script>
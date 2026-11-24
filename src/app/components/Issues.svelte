{#if errors.length}<Part title="错误"><IssueRows {editor} issues={errors} /></Part>{/if}
{#if warnings.length}<Part title="警告"><IssueRows {editor} issues={warnings} /></Part>{/if}
{#if !errors.length && !warnings.length}<EmptyState text="没有问题" />{/if}

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import IssueRows from "./IssueRows.svelte";
    import Part from "./Part.svelte";
    import EmptyState from "./EmptyState.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let errors = $derived(editor.project.issues.filter(i => i.severity === "error"));
    let warnings = $derived(editor.project.issues.filter(i => i.severity === "warning"));
</script>
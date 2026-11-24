<Part>
    {#if issues.length}<IssueRows {editor} {issues} />{:else}<EmptyState text="没有问题" />{/if}
</Part>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { objectIssues } from "../../core/checks/issues.ts";
    import Part from "./Part.svelte";
    import IssueRows from "./IssueRows.svelte";
    import EmptyState from "./EmptyState.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let issues = $derived(objectIssues(editor.project, editor.selection));
</script>
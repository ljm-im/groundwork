{#if issues.length}<Part title="对象校验" count={issues.length}><IssueRows {editor} {issues} /></Part>{/if}

<script lang="ts">
    import * as session from "../state/session.svelte";
    import { objectIssues } from "../../core/checks/issues.js";
    import Part from "./Part.svelte";
    import IssueRows from "./IssueRows.svelte";
    let { editor }: { editor: session.Editor } = $props();
    let issues = $derived(objectIssues(editor.island, editor.selection));
</script>
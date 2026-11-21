{#each issues as issue (issue)}
    <button class="issue-row" class:is-selected={editor.issue === issue} data-issue={editor.island.issues.indexOf(issue)} onclick={() => editor.issueAt(issue)}>
        <i class={"diamond " + issue.severity}></i><span><b>{issue.label ?? editor.island.routes.find(r => r.id === issue.road)?.edge.name ?? issue.road}</b><small>{issue.message}</small></span>
    </button>
{/each}

<script lang="ts">
    import * as session from "./session.svelte";
    import { type Issue } from "./types";
    let { editor, issues }: { editor: session.Editor; issues: Issue[] } = $props();
</script>
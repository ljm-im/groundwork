<section class="part"><div class="part-title"><h3>{title}</h3><span class="number">{count}</span></div>{@render children()}</section>

<script lang="ts">
    import { type Snippet } from "svelte";
    let { title, count = "", children }: { title: string; count?: number | string; children: Snippet } = $props();
</script>
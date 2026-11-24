<section class="part">
    {#if title || actions}
        <Heading kind="part-title" {title} {actions} />
    {/if}
    {@render children()}
</section>

<script lang="ts">
    import { type Snippet } from "svelte";
    import Heading from "./Heading.svelte";
    let { title, children, actions }: {
        title?: string; children: Snippet; actions?: Snippet;
    } = $props();
</script>
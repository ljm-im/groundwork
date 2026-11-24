<section class="part">
    {#if title || actions}
        <div class="part-title">
            {#if title}<h3>{title}</h3>{/if}
            {#if actions}<div class="row-actions">{@render actions()}</div>{/if}
        </div>
    {/if}
    {@render children()}
</section>

<script lang="ts">
    import { type Snippet } from "svelte";
    let { title, children, actions }: {
        title?: string; children: Snippet; actions?: Snippet;
    } = $props();
</script>
<section class="part">
    {#if title || actions}
        <div class="part-title">
            {#if title}<h3>{#if icon}<Icon name={icon} />{/if}{title}</h3>{/if}
            <div class="row-actions">
                {#if count !== ""}<span class="number">{count}</span>{/if}
                {#if actions}{@render actions()}{/if}
            </div>
        </div>
    {/if}
    {@render children()}
</section>

<script lang="ts">
    import { type Snippet } from "svelte";
    import Icon, { type IconName } from "./Icon.svelte";
    let { title, icon, count = "", children, actions }: {
        title?: string; icon?: IconName; count?: number | string; children: Snippet; actions?: Snippet;
    } = $props();
</script>
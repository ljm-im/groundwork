<section class="part"><div class="part-title"><h3>{#if icon}<Icon name={icon} />{/if}{title}</h3>{#if count !== ""}<span class="number">{count}</span>{/if}</div>{@render children()}</section>

<style>
    h3 { display: flex; align-items: center; gap: 5px; }
</style>

<script lang="ts">
    import { type Snippet } from "svelte";
    import Icon from "./Icon.svelte";
    let { title, icon, count = "", children }: { title: string; icon?: "inputs" | "field"; count?: number | string; children: Snippet } = $props();
</script>
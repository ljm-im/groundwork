<div class={"heading " + kind} role={onmouseenter ? "group" : undefined} {onmouseenter} {onmouseleave}>
    {#if children}{@render children()}
    {:else if title}
        <svelte:element this={kind === "part-title" ? "h3" : "h2"}>{title}</svelte:element>
    {/if}
    {#if actions}<div class="row-actions">{@render actions()}</div>{/if}
</div>

<script lang="ts">
    import { type Snippet } from "svelte";
    let { kind, title, children, actions, onmouseenter, onmouseleave }: {
        kind: "panel-heading" | "part-title" | "property-title" | "subitem-heading" | "bottom-heading";
        title?: string; children?: Snippet; actions?: Snippet; onmouseenter?: () => void; onmouseleave?: () => void;
    } = $props();
</script>
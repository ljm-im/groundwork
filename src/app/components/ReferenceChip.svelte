<span class="ref-chip" data-ref={refKey} contenteditable="false"><Icon name={info.icon} builtin={info.builtin} /><span>{info.name}{info.property ? "." + info.property : ""}</span></span>

<style>
    .ref-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        min-height: var(--leading-md);
        vertical-align: top;
        border-radius: var(--radius-chip);
        padding: 0 var(--space-1);
        background: var(--bg-chip);
        color: var(--text);
        white-space: nowrap;
        user-select: none;
        font-size: var(--text-md);
        line-height: var(--leading-md);
    }
    .ref-chip :global(.icon) { width: var(--icon-chip); height: var(--icon-chip); }
    .ref-chip:global([data-selected]) { background: var(--bg-selected); box-shadow: inset 0 0 0 1px var(--accent); }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import { referenceLabel } from "../state/numbers.ts";
    import { type Design } from "../../core/design/v5.ts";
    import { type Slot } from "../../core/design/parameters.ts";
    let { refKey, design, slots }: { refKey: string; design: Design; slots: Map<string, Slot> } = $props();
    let info = $derived(referenceLabel(refKey, design, slots));
</script>
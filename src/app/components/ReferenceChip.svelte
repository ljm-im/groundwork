<span class="ref-chip" data-ref={refKey} contenteditable="false"><Icon name={info.icon} /><span>{info.name}</span>{#if info.property}<span class="dot">·</span><Icon name="property" /><span>{info.property}</span>{/if}</span>

<style>
    .ref-chip { display: inline-flex; align-items: center; vertical-align: middle; gap: 3px; border-radius: 3px; padding: 1px 4px; background: #e6eee8; color: #265453; white-space: nowrap; font-size: 11px; line-height: 16px; }
    .ref-chip :global(.icon) { width: 13px; height: 13px; }
    .dot { opacity: .7; }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import { referenceLabel } from "../state/numbers.ts";
    import { type Design } from "../../core/design/v5.ts";
    import { type Slot } from "../../core/design/parameters.ts";
    let { refKey, design, slots }: { refKey: string; design: Design; slots: Map<string, Slot> } = $props();
    let info = $derived(referenceLabel(refKey, design, slots));
</script>
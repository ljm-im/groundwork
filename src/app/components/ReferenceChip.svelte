<span class="ref-chip" data-ref={refKey} contenteditable="false"><Icon name={info.icon} /><span>{info.name}</span>{#if info.property}<span class="dot">·</span><Icon name="property" /><span>{info.property}</span>{/if}</span>

<style>
    .ref-chip { display: inline; vertical-align: baseline; border-radius: 3px; padding: 0 4px; background: #e6eee8; color: #265453; white-space: nowrap; font: inherit; line-height: inherit; }
    .ref-chip :global(.icon) { display: inline-block; width: 12px; height: 12px; vertical-align: -.1em; margin-right: 2px; }
    .dot { margin: 0 2px; opacity: .7; }
</style>

<script lang="ts">
    import Icon from "./Icon.svelte";
    import { referenceLabel } from "../state/numbers.ts";
    import { type Design } from "../../core/design/v5.ts";
    import { type Slot } from "../../core/design/parameters.ts";
    let { refKey, design, slots }: { refKey: string; design: Design; slots: Map<string, Slot> } = $props();
    let info = $derived(referenceLabel(refKey, design, slots));
</script>
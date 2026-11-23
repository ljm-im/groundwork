<div class="parameter-row">
    <span class="param-name">{label}</span>
    {@render children()}
    <small class="unit control-unit">{unit}</small>
</div>

<script lang="ts">
    import { type Snippet } from "svelte";
    let { label, unit = "", children }: { label: string; unit?: string; children: Snippet } = $props();
</script>
<div class="panel-inset"><input class="search" type="search" {id} placeholder={label} aria-label={label} {value}
    oninput={e => {
        if (!(e instanceof InputEvent && e.isComposing)) change(e.currentTarget.value);
    }} oncompositionend={e => change(e.currentTarget.value)} /></div>

<style>
    input { width: 100%; }
</style>

<script lang="ts">
    let { id, label, value, change }: { id: string; label: string; value: string; change: (value: string) => void } = $props();
</script>
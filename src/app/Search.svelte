<div class="part"><input class="search" type="search" {id} placeholder={label} aria-label={label} {value}
    oninput={e => {
        if (!(e instanceof InputEvent && e.isComposing)) value = e.currentTarget.value;
    }} /></div>

<script lang="ts">
    let { id, label, value = $bindable("") }: { id: string; label: string; value: string } = $props();
</script>
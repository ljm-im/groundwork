<FieldRow {label} forInput={id} {disabled}>
    <input {id} type="checkbox" {checked} {disabled} {...attributes} onchange={e => change(e.currentTarget.checked)} />
</FieldRow>

<style>
    input:enabled { cursor: pointer; }
</style>

<script lang="ts">
    import FieldRow from "./FieldRow.svelte";
    const id = $props.id();
    let { label, checked, disabled = false, change, attributes }: {
        label: string; checked: boolean; disabled?: boolean; change: (checked: boolean) => void; attributes?: Record<string, string>;
    } = $props();
</script>
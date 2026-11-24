<FieldRow {label}>
    <button class="input-box choice-face" aria-label={label} aria-expanded={open} aria-haspopup="listbox" {...attributes}
        bind:this={anchor} onclick={() => open = !open} onkeydown={key}>
        {#if icon}<Icon name={icon} builtin={selected?.builtin} />{/if}
        <span>{selected?.name ?? value}</span>
        <Icon name="collapse" />
    </button>
</FieldRow>
{#if open}
    <Menu {label} kind="listbox" variant="choices" {anchor} {openingKey} {close}
        groups={[{ title: group, items: options.map(item => ({ ...item, icon, selected: item.id === value })) }]}
        choose={id => {
            close(true); if (id !== value) choose(id);
        }} />
{/if}

<style>
    .choice-face { justify-content: flex-start; }
    .choice-face span { min-width: 0; flex: 1; text-align: start; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>

<script lang="ts">
    import { menuDirection } from "../state/popup.ts";
    import FieldRow from "./FieldRow.svelte";
    import Icon, { type IconName } from "./Icon.svelte";
    import Menu from "./Menu.svelte";
    let { label, group, icon, value, options, choose, attributes }: {
        label: string; group?: string; icon?: IconName; value: string;
        options: { id: string; name: string; builtin?: boolean }[];
        choose: (v: string) => void; attributes?: Record<string, string>;
    } = $props();
    let anchor = $state<HTMLButtonElement>(null!), open = $state(false), openingKey = $state<string>();

    let selected = $derived(options.find(item => item.id === value));

    function close(focus = false) {
        open = false; openingKey = undefined;
        if (focus) anchor.focus({ preventScroll: true });
    }
    function key(e: KeyboardEvent) {
        if (!open && menuDirection(e)) {
            e.preventDefault();
            openingKey = e.key; open = true;
        }
    }
</script>
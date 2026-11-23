<FieldRow {label}>
    <button class="input-box choice-face" aria-label={label} aria-expanded={open} aria-haspopup="listbox" {...attributes}
        bind:this={anchor} onclick={() => open = !open}>
        <Icon name={selected?.icon ?? icon} />
        <span>{selected?.name ?? value}</span>
        <Icon name="collapse" />
    </button>
</FieldRow>
{#if open}
    <div class="popup menu choices" role="listbox" tabindex="-1" aria-label={label}
        popover="manual" bind:this={menu} use:anchoredPopup={{ anchor, close: () => open = false }}>
        {#if group}<div class="group-name">{group}</div>{/if}
        {#each options as item (item.id)}
            <button role="option" aria-selected={item.id === value} onclick={() => {
                close(); if (item.id !== value) choose(item.id);
            }}>
                <Icon name={item.icon ?? icon} />{item.name}
            </button>
        {/each}
        {#if create}
            <button role="option" aria-selected="false" class="create-option" onclick={() => {
                close(); create?.();
            }}><Icon name="plus" />{newLabel}</button>
        {/if}
    </div>
{/if}
<svelte:window onkeydowncapture={keyboard} />

<style>
    .choice-face { justify-content: flex-start; }
    .choice-face span { min-width: 0; flex: 1; text-align: start; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>

<script lang="ts">
    import { tick } from "svelte";
    import { anchoredPopup } from "../state/popup.ts";
    import FieldRow from "./FieldRow.svelte";
    import Icon, { type IconName } from "./Icon.svelte";
    let { label, group, icon = "property", value, options, newLabel, choose, create, attributes }: {
        label: string; group?: string; icon?: IconName; value: string;
        options: { id: string; name: string; icon?: IconName }[]; newLabel?: string;
        choose: (v: string) => void; create?: () => void; attributes?: Record<string, string>;
    } = $props();
    let anchor = $state<HTMLButtonElement>(null!), menu = $state<HTMLElement>(), open = $state(false);

    let selected = $derived(options.find(item => item.id === value));

    function close() {
        open = false;
        anchor.focus({ preventScroll: true });
    }
    async function keyboard(event: KeyboardEvent) {
        if (event.key === "Escape" && open) {
            close();
            event.preventDefault();
            event.stopPropagation();
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
            event.target !== anchor && !(event.target instanceof Node && menu?.contains(event.target))) return;
        event.preventDefault();
        open = true;
        await tick();
        const buttons = [...(menu?.querySelectorAll("button") ?? [])];
        const active = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const selected = buttons.findIndex(button => button.getAttribute("aria-selected") === "true");
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : active < 0 ? Math.max(selected, 0)
            : (active + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[index]?.focus();
    }
</script>
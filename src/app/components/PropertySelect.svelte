<FieldRow {label}>
    <button class="input-box choice-face" aria-label={label} aria-expanded={open} aria-haspopup="listbox" {...attributes}
        bind:this={anchor} onclick={() => open = !open}>
        {#if icon}<Icon name={icon} builtin={selected?.builtin} />{/if}
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
                {#if icon}<Icon name={icon} builtin={item.builtin} />{/if}{item.name}
            </button>
        {/each}
    </div>
{/if}
<svelte:window onkeydowncapture={keyboard} />

<style>
    .choice-face { justify-content: flex-start; }
    .choice-face span { min-width: 0; flex: 1; text-align: start; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>

<script lang="ts">
    import { composingKey } from "../state/numbers.ts";
    import { tick } from "svelte";
    import { anchoredPopup } from "../state/popup.ts";
    import FieldRow from "./FieldRow.svelte";
    import Icon, { type IconName } from "./Icon.svelte";
    let { label, group, icon, value, options, choose, attributes }: {
        label: string; group?: string; icon?: IconName; value: string;
        options: { id: string; name: string; builtin?: boolean }[];
        choose: (v: string) => void; attributes?: Record<string, string>;
    } = $props();
    let anchor = $state<HTMLButtonElement>(null!), menu = $state<HTMLElement>(), open = $state(false);

    let selected = $derived(options.find(item => item.id === value));

    function close() {
        open = false;
        anchor.focus({ preventScroll: true });
    }
    async function keyboard(event: KeyboardEvent) {
        if (composingKey(event)) return;
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
<button class="icon-button" data-tip={label} aria-label={label} aria-pressed={active || open}
    aria-haspopup={options ? "menu" : undefined} aria-expanded={options ? open : undefined}
    {...attributes} bind:this={anchor} onclick={activate} onkeydown={key}>
    <Icon name="plus" />
</button>
{#if open && options}
    <Menu {label} groups={[{ items: options }]} {anchor} viewport variant="creation-menu" {openingKey} {pointerOpened} {close}
        choose={id => {
            close(); choose?.(id);
        }} />
{/if}

<script lang="ts">
    import { menuDirection } from "../state/popup.ts";
    import Icon from "./Icon.svelte";
    import Menu, { type MenuItem } from "./Menu.svelte";
    let { label, options, choose, action, active = false, attributes }: {
        label: string; options?: readonly MenuItem[]; choose?: (id: string) => void;
        action?: () => void; active?: boolean; attributes?: Record<string, string>;
    } = $props();
    let anchor = $state<HTMLButtonElement>(null!), open = $state(false), openingKey = $state<string>();
    let pointerOpened = $state(false);
    function activate(e: MouseEvent) {
        if (!options) {
            action?.(); return;
        }
        pointerOpened = e.detail > 0; openingKey = undefined; open = !open;
    }
    function close(focus = false) {
        open = false; openingKey = undefined;
        if (focus) anchor.focus({ preventScroll: true });
    }
    function key(e: KeyboardEvent) {
        if (!open && options && menuDirection(e)) {
            e.preventDefault();
            pointerOpened = false; openingKey = e.key; open = true;
        }
    }
</script>
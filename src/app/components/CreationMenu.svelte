<button class="icon-button" data-tip={label} aria-label={label} aria-haspopup="menu" aria-expanded={open}
    bind:this={anchor} onclick={toggle} onkeydown={key}><Icon name="plus" /></button>
{#if open}
    <div class="popup menu creation-menu" role="menu" tabindex="-1" aria-label={label}
        popover="manual" bind:this={menu} use:anchoredPopup={{ anchor, close: () => open = false, viewport: true }} onkeydown={key}>
        {#each options as [tool, name, icon] (tool)}
            <button role="menuitem" onclick={() => {
                open = false;
                choose(tool);
            }}><Icon name={icon} />{name}</button>
        {/each}
    </div>
{/if}

<style>
    .creation-menu { min-width: calc(var(--name-w) + 2 * var(--space-3)); }
</style>

<script lang="ts">
    import { composingKey } from "../state/numbers.ts";
    import { tick } from "svelte";
    import Icon, { type IconName } from "./Icon.svelte";
    import { type Tool } from "../types.ts";
    import { anchoredPopup } from "../state/popup.ts";

    let { label, options, choose }: {
        label: string; options: readonly (readonly [Tool, string, IconName])[]; choose: (tool: Tool) => void;
    } = $props();
    let anchor = $state<HTMLButtonElement>(null!), menu = $state<HTMLElement>(), open = $state(false);
    async function toggle() {
        open = !open;
        if (open) {
            await tick();
            menu?.querySelector("button")?.focus({ preventScroll: true });
        }
    }
    async function key(e: KeyboardEvent) {
        if (composingKey(e)) return;
        if (e.key === "Escape" && open) {
            e.preventDefault(); e.stopPropagation();
            open = false; anchor.focus();
            return;
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        open = true;
        await tick();
        const buttons = Array.from(menu?.querySelectorAll("button") ?? []);
        const active = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : active < 0 ? 0 :
            (active + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
        buttons[index]?.focus({ preventScroll: true });
    }
</script>
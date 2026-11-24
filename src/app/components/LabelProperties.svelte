<section class="part">
    <label class="toggle"><input type="checkbox" checked={showLabel} onchange={e => setLabelVisibility(e.currentTarget.checked)} />显示标签</label>
    <Prompt {editor} {target} placeholder="描述" />
</section>

<script lang="ts">
    import * as session from "../state/session.svelte.ts";
    import { type PromptTarget } from "../../core/edit/history.ts";
    import Prompt from "./Prompt.svelte";

    let { editor, target, showLabel, setLabelVisibility }: {
        editor: session.Editor; target: PromptTarget; showLabel: boolean; setLabelVisibility: (visible: boolean) => void;
    } = $props();
</script>
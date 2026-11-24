<div class="list-empty">{search ? "没有匹配的结果" : text}</div>

<script lang="ts">
    let { text, search = false }: { text?: string; search?: boolean } = $props();
</script>
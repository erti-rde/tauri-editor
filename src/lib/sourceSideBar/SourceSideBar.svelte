<script lang="ts">
	import Tree from '$lib/tree/Index.svelte';
</script>

<div class="explorer-scroll flex flex-col justify-between px-2">
	<Tree />
</div>

<style>
	.explorer-scroll {
		overflow: scroll;
	}
</style>

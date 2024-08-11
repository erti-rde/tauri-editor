<script lang="ts">
	import { Icon } from '$lib';
	let current = 'Files';
</script>

<div class="mt-2 flex w-full justify-center">
	<button class="p-2" on:click={() => (current = 'Files')}>
		<Icon icon="Files" />
	</button>
</div>

<style>
	button:hover {
		background-color: var(--hover-color);
	}
</style>

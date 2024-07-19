<script lang="ts">
	import { createSeparator, melt, type CreateSeparatorProps } from '@melt-ui/svelte';

	export let orientation: CreateSeparatorProps['orientation'] = 'vertical';

	const {
		elements: { root: vertical }
	} = createSeparator({
		orientation
	});

	const {
		elements: { root: horizontal }
	} = createSeparator({
		orientation: 'horizontal',
		decorative: true
	});
</script>

{#if orientation === 'vertical'}
	<div use:melt={$vertical} class="bg-orange-600 h-full w-[2px]" />
{:else}
	<div use:melt={$horizontal} class="bg-orange-600 h-[2px] w-full" />
{/if}


<style>
  div {
    margin: 10px;
  }
</style>
<script lang="ts">
	import { Tooltip as BitsTooltip } from 'bits-ui';

	import Tooltip from './Tooltip.svelte';

	/** Renders a tooltipped button with or without the app's provider. */
	const { withProvider = true }: { withProvider?: boolean } = $props();
</script>

{#snippet control()}
	<Tooltip label="Insert a page break" shortcut="Mod Enter">
		<span>icon</span>
	</Tooltip>
{/snippet}

{#if withProvider}
	<BitsTooltip.Provider>
		{@render control()}
	</BitsTooltip.Provider>
{:else}
	{@render control()}
{/if}
